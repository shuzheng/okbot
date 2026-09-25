import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  defineToolInputGuardrail,
  ToolGuardrailFunctionOutputFactory,
  type ToolInputGuardrailDefinition,
} from '@openai/agents';
import {
  normalizeSecuritySettings,
  type SecuritySettings,
} from '@okbot/shared';

/**
 * Dangerous shell patterns (case-insensitive). Documented for Settings UI / README.
 * Not a full sandbox — complementary to path scope + HITL approval.
 */
export const DANGEROUS_SHELL_PATTERNS: { id: string; re: RegExp; label: string }[] = [
  { id: 'rm_rf_root', re: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|-[a-zA-Z]*\s+)*\/\s*($|&&|\||;)/i, label: 'rm -rf /' },
  { id: 'rm_rf_star', re: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+(\/\*|~\/\*|\$HOME\/\*)/i, label: 'rm -rf /*' },
  { id: 'sudo', re: /(^|[;&|`\n]|\$\()\s*sudo\b/i, label: 'sudo' },
  { id: 'mkfs', re: /\bmkfs(\.\w+)?\b/i, label: 'mkfs' },
  { id: 'dd_if', re: /\bdd\s+.*\bif=/i, label: 'dd if=' },
  { id: 'curl_pipe_sh', re: /\b(curl|wget)\b[^|\n]*\|\s*(ba)?sh\b/i, label: 'curl|sh / wget|sh' },
  { id: 'chmod_777_root', re: /\bchmod\s+(-R\s+)?777\s+\/(\s|$)/i, label: 'chmod 777 /' },
  { id: 'diskutil_erase', re: /\bdiskutil\s+erase/i, label: 'diskutil erase' },
  { id: 'shutdown', re: /\b(shutdown|reboot|halt|poweroff)\b/i, label: 'shutdown/reboot' },
  { id: 'fork_bomb', re: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/, label: 'fork bomb' },
  { id: 'write_disk', re: />\s*\/dev\/(sd|disk|rdisk|nvme)/i, label: 'write to /dev/disk' },
];

export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
  return p;
}

function resolvePathish(p: string): string {
  return path.resolve(expandHome(p.trim()));
}

/** Case-fold path compare on APFS/Windows (case-insensitive FS). */
function pathEquals(a: string, b: string): boolean {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

function pathHasPrefix(resolved: string, prefixWithSep: string): boolean {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return resolved.toLowerCase().startsWith(prefixWithSep.toLowerCase());
  }
  return resolved.startsWith(prefixWithSep);
}

/**
 * Resolve symlinks for an existing path, or for the nearest existing ancestor
 * (so `/tmp/nope` → `/private/tmp/nope` on macOS when only `/tmp` exists).
 */
function tryRealpath(p: string): string {
  try {
    if (fs.existsSync(p)) return fs.realpathSync(p);
    const parts: string[] = [];
    let cur = p;
    for (;;) {
      const parent = path.dirname(cur);
      if (parent === cur) break;
      parts.push(path.basename(cur));
      cur = parent;
      if (fs.existsSync(cur)) {
        return path.join(fs.realpathSync(cur), ...parts.reverse());
      }
    }
  } catch {
    /* ignore */
  }
  return p;
}

function prefixMatches(resolvedRaw: string, prefixRaw: string): boolean {
  const resolved = tryRealpath(resolvedRaw);
  const prefix = tryRealpath(resolvePathish(prefixRaw));
  if (pathEquals(resolved, prefix)) return true;
  const withSep = prefix.endsWith(path.sep) ? prefix : prefix + path.sep;
  return pathHasPrefix(resolved, withSep);
}

/** Tool root for path scope: user home (same default cwd as run_shell). */
export function toolRootDir(): string {
  return path.resolve(homedir());
}

export type PathCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

export function checkPathAllowed(
  filePath: string,
  security: SecuritySettings,
): PathCheckResult {
  if (!filePath?.trim()) {
    return { ok: false, reason: '路径为空，已拦截。' };
  }
  let resolved: string;
  try {
    resolved = tryRealpath(resolvePathish(filePath));
  } catch {
    return { ok: false, reason: `无法解析路径「${filePath}」，已拦截。` };
  }

  for (const denied of security.deniedPathPrefixes) {
    if (!denied.trim()) continue;
    if (prefixMatches(resolved, denied)) {
      return {
        ok: false,
        reason: `路径「${resolved}」命中禁止前缀「${denied}」，安全防护已拦截。请改用允许范围内的路径。`,
      };
    }
  }

  if (!security.restrictToHome) return { ok: true };

  const root = toolRootDir();
  if (prefixMatches(resolved, root)) return { ok: true };
  for (const allowed of security.allowedPathPrefixes) {
    if (!allowed.trim()) continue;
    if (prefixMatches(resolved, allowed)) return { ok: true };
  }

  return {
    ok: false,
    reason: `路径「${resolved}」超出允许范围（当前工具根目录为 ${root}，以及设置中的额外允许前缀）。安全防护已拦截。`,
  };
}

export function findDangerousShellPattern(command: string): string | null {
  const cmd = command ?? '';
  for (const p of DANGEROUS_SHELL_PATTERNS) {
    if (p.re.test(cmd)) return p.label;
  }
  return null;
}

function parseArgsJson(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

function blockOutput(security: SecuritySettings, message: string) {
  if (security.blockMode === 'tripwire') {
    return ToolGuardrailFunctionOutputFactory.throwException({ message });
  }
  return ToolGuardrailFunctionOutputFactory.rejectContent(message, { message });
}

/**
 * Build tool-input guardrails from live security settings.
 * Returns [] when master switch is off.
 */
export function buildToolInputGuardrails(
  securityRaw: SecuritySettings | undefined | null,
): ToolInputGuardrailDefinition[] {
  const security = normalizeSecuritySettings(securityRaw ?? undefined);
  if (!security.enabled) return [];

  const pathGuard = defineToolInputGuardrail({
    name: 'okbot_path_scope',
    run: async ({ toolCall }) => {
      const name = toolCall.name || '';
      const args = parseArgsJson(toolCall.arguments);
      if (name === 'read_file' || name === 'write_file' || name === 'edit_file') {
        const p = typeof args.path === 'string' ? args.path : '';
        const check = checkPathAllowed(p, security);
        if (!check.ok) return blockOutput(security, check.reason);
      }
      if (name === 'run_shell') {
        const cwd =
          typeof args.cwd === 'string' && args.cwd.trim()
            ? args.cwd
            : toolRootDir();
        const check = checkPathAllowed(cwd, security);
        if (!check.ok) {
          return blockOutput(
            security,
            `run_shell 工作目录${check.reason.replace(/^路径/, '')}`,
          );
        }
      }
      return ToolGuardrailFunctionOutputFactory.allow();
    },
  });

  const list: ToolInputGuardrailDefinition[] = [pathGuard];

  if (security.shellPatternsEnabled) {
    list.push(
      defineToolInputGuardrail({
        name: 'okbot_shell_patterns',
        run: async ({ toolCall }) => {
          if ((toolCall.name || '') !== 'run_shell') {
            return ToolGuardrailFunctionOutputFactory.allow();
          }
          const args = parseArgsJson(toolCall.arguments);
          const command = typeof args.command === 'string' ? args.command : '';
          const hit = findDangerousShellPattern(command);
          if (hit) {
            return blockOutput(
              security,
              `Shell 命令命中危险模式「${hit}」，安全防护已拦截。请改用更安全的命令，或在设置 → 安全中调整策略。`,
            );
          }
          return ToolGuardrailFunctionOutputFactory.allow();
        },
      }),
    );
  }

  return list;
}
