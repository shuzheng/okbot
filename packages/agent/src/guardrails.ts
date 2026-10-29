import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  defineToolInputGuardrail,
  defineToolOutputGuardrail,
  ToolGuardrailFunctionOutputFactory,
  type InputGuardrail,
  type OutputGuardrail,
  type ToolInputGuardrailDefinition,
  type ToolOutputGuardrailDefinition,
} from '@openai/agents';
import {
  DEFAULT_DANGEROUS_SHELL_PATTERNS,
  normalizeSecuritySettings,
  redactSensitiveText,
  resolveShellPatterns,
  tryCompileShellPattern,
  type DangerousShellPattern,
  type SecuritySettings,
  LOCAL_COMPUTER_ID,
} from '@okbot/shared';
import {
  selectComputerForTool,
  type ComputerRoute,
} from './computerSelection.js';

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

/** Absolute or home-relative (`~/…`) — user named an explicit location. */
export function isAbsoluteOrHomePath(p: string): boolean {
  const t = (p || '').trim();
  if (!t) return false;
  if (t === '~' || t.startsWith('~/')) return true;
  return path.isAbsolute(t);
}

/**
 * Resolve a tool fs path for the owner work root.
 * Relative paths land under `resourcesDir` (`~/.okbot/<owner>/resources/`) when set;
 * absolute / `~/…` paths keep their explicit location.
 */
export function resolveOwnerWorkPath(
  filePath: string,
  resourcesDir?: string | null,
): string {
  const raw = (filePath || '').trim();
  if (!raw) return raw;
  if (isAbsoluteOrHomePath(raw)) return expandHome(raw);
  const root = (resourcesDir || '').trim();
  if (root) return path.join(root, raw);
  return raw;
}

function resolvePathish(p: string, resourcesDir?: string | null): string {
  return path.resolve(resolveOwnerWorkPath(p, resourcesDir));
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
  resourcesDir?: string | null,
  opts?: { remote?: boolean },
): PathCheckResult {
  if (!filePath?.trim()) {
    return { ok: false, reason: '路径为空，已拦截。' };
  }

  // Remote sandbox: do not resolve against the gateway host home/realpath.
  // Still enforce deny prefixes via string/home-expanded matching; restrictToHome
  // is the sandbox boundary, not the host filesystem.
  if (opts?.remote) {
    const expanded = resolvePathish(filePath); // ~ → host home only for deny string compare
    const candidates = [filePath.trim(), expanded];
    for (const denied of security.deniedPathPrefixes) {
      if (!denied.trim()) continue;
      const deniedExp = resolvePathish(denied);
      for (const c of candidates) {
        if (
          c === denied ||
          c === deniedExp ||
          c.startsWith(denied.endsWith('/') || denied.endsWith('\\') ? denied : denied + '/') ||
          c.startsWith(deniedExp.endsWith('/') || deniedExp.endsWith('\\') ? deniedExp : deniedExp + '/') ||
          c.startsWith(denied + '\\') ||
          c.startsWith(deniedExp + '\\')
        ) {
          return {
            ok: false,
            reason: `路径「${filePath}」命中禁止前缀「${denied}」，安全防护已拦截。请改用允许范围内的路径。`,
          };
        }
      }
    }
    return { ok: true };
  }

  let resolved: string;
  try {
    resolved = tryRealpath(resolvePathish(filePath, resourcesDir));
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
  opts?: { resourcesDir?: string | null; computerRoute?: ComputerRoute | null },
): ToolInputGuardrailDefinition[] {
  const security = normalizeSecuritySettings(securityRaw ?? undefined);
  if (!security.enabled) return [];
  const resourcesDir = opts?.resourcesDir;
  const route = opts?.computerRoute ?? null;

  function isRemoteToolCall(args: Record<string, unknown>): boolean {
    if (!route) return false;
    const requested = typeof args.computer === 'string' ? args.computer : undefined;
    const picked = selectComputerForTool(route, requested);
    if (!picked.ok) return false;
    return picked.id !== LOCAL_COMPUTER_ID;
  }

  const pathGuard = defineToolInputGuardrail({
    name: 'okbot_path_scope',
    run: async ({ toolCall }) => {
      const name = toolCall.name || '';
      const args = parseArgsJson(toolCall.arguments);
      const remote = isRemoteToolCall(args);
      if (name === 'read_file' || name === 'write_file' || name === 'edit_file') {
        const p = typeof args.path === 'string' ? args.path : '';
        const check = checkPathAllowed(p, security, resourcesDir, { remote });
        if (!check.ok) return blockOutput(security, check.reason);
      }
      if (name === 'run_shell') {
        // Remote default cwd is the sandbox home — do not substitute host toolRootDir.
        if (remote && !(typeof args.cwd === 'string' && args.cwd.trim())) {
          return ToolGuardrailFunctionOutputFactory.allow();
        }
        const cwd =
          typeof args.cwd === 'string' && args.cwd.trim()
            ? args.cwd
            : toolRootDir();
        const check = checkPathAllowed(cwd, security, undefined, { remote });
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


/** Extract plain text from one message-like item. */
function messageItemToText(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  const o = item as Record<string, unknown>;
  if (typeof o.content === 'string') return o.content;
  const parts: string[] = [];
  if (Array.isArray(o.content)) {
    for (const c of o.content) {
      if (typeof c === 'string') parts.push(c);
      else if (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string') {
        parts.push((c as { text: string }).text);
      }
    }
  }
  if (typeof o.text === 'string') parts.push(o.text);
  return parts.join('\n');
}

/**
 * Extract plain text from agent-run input (string or message items).
 * When given a full conversation array, only the **last user** turn is used —
 * input guardrails must not trip forever on secrets that appeared in earlier turns.
 */
export function agentInputToText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (!Array.isArray(input)) return '';
  // Prefer last user message (current turn). Fall back to last item if roles absent.
  let lastUser: unknown = null;
  let lastAny: unknown = null;
  for (const item of input) {
    lastAny = item;
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: unknown }).role;
    if (role === 'user') lastUser = item;
  }
  const target = lastUser ?? lastAny;
  return target == null ? '' : messageItemToText(target);
}

export function agentOutputToText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output == null) return '';
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

const JAILBREAK_RE =
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|prompts)|disregard\s+(your|all|the)\s+(instructions|rules|guidelines|safety)|you\s+are\s+now\s+(dan|unrestricted|jailbroken)|jailbreak\b|system\s*prompt\s*override|忽略\s*(以上|之前|先前|全部|所有)?\s*(指令|规则|设定|提示)|越狱/i;

const INJECTION_HYGIENE_RE =
  /<\/?(?:system|assistant|developer)\b|\[SYSTEM\]|\[INST\]|<<SYS>>|\[\/INST\]/i;

/**
 * Chinese mobile (+86 optional) and NA-style xxx-xxx-xxxx with separators.
 * Avoid bare 10–16 digit runs (timestamps / order ids).
 */
const PHONE_LIKE_RE =
  /(?<!\d)(?:\+?86[-.\s]?)?1[3-9]\d{9}(?!\d)|(?<!\d)\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/g;

/**
 * API keys / tokens. Require a non-letter boundary before `sk-` so words like
 * `sk-learn` / `monkey-business-model` are not redacted.
 */
const SECRET_LIKE_RE =
  /(?:(?<![A-Za-z0-9])sk-(?:or-)?[A-Za-z0-9_\-]{16,}|(?<![A-Za-z0-9])key-[A-Za-z0-9_\-]{16,}|Bearer\s+[A-Za-z0-9._\-+/=]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g;

export function hasSuspectedSecretsOrPii(text: string): boolean {
  const s = text || '';
  if (!s.trim()) return false;
  SECRET_LIKE_RE.lastIndex = 0;
  if (SECRET_LIKE_RE.test(s)) return true;
  PHONE_LIKE_RE.lastIndex = 0;
  if (PHONE_LIKE_RE.test(s)) return true;
  // redactSensitiveText shortens when it hits sk-/Bearer — compare before/after without length cap
  const red = redactSensitiveText(s, undefined, Number.MAX_SAFE_INTEGER);
  return red !== s;
}

/** Redact secrets / phone-like spans without truncating (for tool context). */
export function redactSuspectedSecrets(text: string): string {
  let s = String(text ?? '');
  s = redactSensitiveText(s, undefined, Number.MAX_SAFE_INTEGER);
  s = s.replace(SECRET_LIKE_RE, (m) => {
    if (m.toLowerCase().startsWith('bearer')) return 'Bearer ***';
    const prefix = m.slice(0, Math.min(4, m.length));
    return `${prefix}***`;
  });
  s = s.replace(PHONE_LIKE_RE, '[phone-redacted]');
  return s;
}

function toolOutputToText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output == null) return '';
  try {
    return typeof output === 'object' ? JSON.stringify(output) : String(output);
  } catch {
    return String(output);
  }
}

/**
 * Agent-level input guardrails (`defineInputGuardrail` shape via InputGuardrail).
 * Note: `@openai/agents@0.18` re-exports `defineOutputGuardrail` but not
 * `defineInputGuardrail`; Agent accepts `{ name, execute, runInParallel }` and the
 * runner wraps them. Agent-level checks only support tripwire (no rejectContent).
 */
export function buildAgentInputGuardrails(
  securityRaw: SecuritySettings | undefined | null,
): InputGuardrail[] {
  const security = normalizeSecuritySettings(securityRaw ?? undefined);
  if (!security.enabled) return [];
  const agent = security.agent;
  const list: InputGuardrail[] = [];

  if (agent.rejectEmptyInput) {
    list.push({
      name: 'okbot_input_empty',
      runInParallel: false,
      execute: async ({ input }) => {
        const text = agentInputToText(input).trim();
        if (!text) {
          return {
            tripwireTriggered: true,
            outputInfo: { message: '输入为空或仅空白，安全防护已拦截本轮。' },
          };
        }
        return { tripwireTriggered: false, outputInfo: { ok: true } };
      },
    });
  }

  if (agent.maxInputCharsEnabled) {
    const max = agent.maxInputChars;
    list.push({
      name: 'okbot_input_max_chars',
      runInParallel: false,
      execute: async ({ input }) => {
        const text = agentInputToText(input);
        if (text.length > max) {
          return {
            tripwireTriggered: true,
            outputInfo: {
              message: `输入过长（${text.length} 字符，上限 ${max}），安全防护已拦截本轮。`,
              length: text.length,
              max,
            },
          };
        }
        return { tripwireTriggered: false, outputInfo: { ok: true } };
      },
    });
  }

  if (agent.jailbreakEnabled) {
    list.push({
      name: 'okbot_input_jailbreak',
      runInParallel: false,
      execute: async ({ input }) => {
        const text = agentInputToText(input);
        if (JAILBREAK_RE.test(text)) {
          return {
            tripwireTriggered: true,
            outputInfo: {
              message: '输入疑似越狱 / 指令覆盖尝试，安全防护已拦截本轮。',
            },
          };
        }
        return { tripwireTriggered: false, outputInfo: { ok: true } };
      },
    });
  }

  if (agent.injectionHygiene) {
    list.push({
      name: 'okbot_input_injection_hygiene',
      runInParallel: false,
      execute: async ({ input }) => {
        const text = agentInputToText(input);
        if (INJECTION_HYGIENE_RE.test(text)) {
          return {
            tripwireTriggered: true,
            outputInfo: {
              message: '输入含可疑角色注入标记（如 system/assistant 标签），安全防护已拦截本轮。',
            },
          };
        }
        return { tripwireTriggered: false, outputInfo: { ok: true } };
      },
    });
  }

  if (agent.piiPasteWarn) {
    list.push({
      name: 'okbot_input_pii_paste',
      runInParallel: false,
      execute: async ({ input }) => {
        const text = agentInputToText(input);
        if (hasSuspectedSecretsOrPii(text)) {
          return {
            tripwireTriggered: true,
            outputInfo: {
              message:
                '输入疑似含密钥 / Token / 手机号等敏感内容，安全防护已拦截。请去掉敏感信息后重试，或在设置 → 安全防护 → Agent 中关闭此项。',
            },
          };
        }
        return { tripwireTriggered: false, outputInfo: { ok: true } };
      },
    });
  }

  return list;
}

/**
 * Agent-level output guardrails (`OutputGuardrail` / `defineOutputGuardrail` shape).
 * Pass `{ name, execute }` to Agent; the runner wraps them with `defineOutputGuardrail`.
 * (Do not attach Definition objects — a second wrap would drop `execute`.)
 */
export function buildAgentOutputGuardrails(
  securityRaw: SecuritySettings | undefined | null,
): OutputGuardrail[] {
  const security = normalizeSecuritySettings(securityRaw ?? undefined);
  if (!security.enabled) return [];
  if (!security.agent.outputSecretsEnabled) return [];

  return [
    {
      name: 'okbot_output_secrets',
      execute: async ({ agentOutput }) => {
        const text = agentOutputToText(agentOutput);
        if (hasSuspectedSecretsOrPii(text)) {
          return {
            tripwireTriggered: true,
            outputInfo: {
              message: '最终回复疑似含密钥 / Token / 手机号，安全防护已中断输出。',
            },
          };
        }
        return { tripwireTriggered: false, outputInfo: { ok: true } };
      },
    },
  ];
}

/**
 * Tool-output guardrails via `defineToolOutputGuardrail`.
 * When secrets found: reject mode → rejectContent(redacted); tripwire → throwException.
 */
export function buildToolOutputGuardrails(
  securityRaw: SecuritySettings | undefined | null,
): ToolOutputGuardrailDefinition[] {
  const security = normalizeSecuritySettings(securityRaw ?? undefined);
  if (!security.enabled) return [];
  if (!security.agent.toolOutputSecretsEnabled) return [];

  return [
    defineToolOutputGuardrail({
      name: 'okbot_tool_output_secrets',
      run: async ({ toolCall, output }) => {
        const name = toolCall.name || '';
        // Focus on shell / file-read style tools that commonly leak env secrets.
        if (name !== 'run_shell' && name !== 'read_file') {
          return ToolGuardrailFunctionOutputFactory.allow();
        }
        const raw = toolOutputToText(output);
        if (!hasSuspectedSecretsOrPii(raw)) {
          return ToolGuardrailFunctionOutputFactory.allow();
        }
        const redacted = redactSuspectedSecrets(raw);
        if (security.blockMode === 'tripwire') {
          return ToolGuardrailFunctionOutputFactory.throwException({
            message: `工具「${name}」输出疑似含密钥/敏感信息，安全防护已中断。`,
            tool: name,
          });
        }
        return ToolGuardrailFunctionOutputFactory.rejectContent(redacted, {
          message: `工具「${name}」输出已脱敏（疑似密钥/手机号）。`,
          tool: name,
          redacted: true,
        });
      },
    }),
  ];
}

/** Spread onto `new Agent({ ... })` when any agent-level guardrails are enabled. */
export function agentGuardrailsFromSecurity(
  securityRaw: SecuritySettings | undefined | null,
): {
  inputGuardrails?: InputGuardrail[];
  outputGuardrails?: OutputGuardrail[];
} {
  const inputGuardrails = buildAgentInputGuardrails(securityRaw);
  const outputGuardrails = buildAgentOutputGuardrails(securityRaw);
  return {
    ...(inputGuardrails.length ? { inputGuardrails } : {}),
    ...(outputGuardrails.length ? { outputGuardrails } : {}),
  };
}
