import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  defineToolInputGuardrail,
  ToolGuardrailFunctionOutputFactory,
  type ToolInputGuardrailDefinition,
} from '@openai/agents';
import {
  DEFAULT_DANGEROUS_SHELL_PATTERNS,
  normalizeSecuritySettings,
  resolveShellPatterns,
  tryCompileShellPattern,
  type DangerousShellPattern,
  type SecuritySettings,
} from '@okbot/shared';

export type CompiledShellPattern = { id: string; re: RegExp; label: string };

function compileShellPatterns(list: DangerousShellPattern[]): CompiledShellPattern[] {
  const out: CompiledShellPattern[] = [];
  for (const p of list) {
    const re = tryCompileShellPattern(p.pattern);
    if (!re) continue;
    const label = (p.label?.trim() || p.pattern).trim();
    out.push({ id: p.id, re, label });
  }
  return out;
}

/**
 * Built-in dangerous shell patterns (compiled). Prefer settings.security.shellPatterns
 * via findDangerousShellPattern / buildToolInputGuardrails for live scans.
 */
export const DANGEROUS_SHELL_PATTERNS: CompiledShellPattern[] = compileShellPatterns(
  DEFAULT_DANGEROUS_SHELL_PATTERNS,
);

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

/**
 * Scan a shell command against the effective denylist.
 * Invalid regex entries are skipped (never throw).
 * When `security` is omitted, built-in defaults are used.
 */
export function findDangerousShellPattern(
  command: string,
  security?: SecuritySettings | null,
): string | null {
  const cmd = command ?? '';
  const settings = security
    ? normalizeSecuritySettings(security)
    : normalizeSecuritySettings(undefined);
  const compiled = compileShellPatterns(resolveShellPatterns(settings));
  for (const p of compiled) {
    try {
      if (p.re.test(cmd)) return p.label;
    } catch {
      /* ignore pathological regex runtime errors */
    }
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
          const hit = findDangerousShellPattern(command, security);
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
