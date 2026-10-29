/** Security settings schema + normalize helpers (split from settings.ts). */

/** How tool input guardrails short-circuit a blocked call. */
export type SecurityBlockMode = 'reject' | 'tripwire';

/** One dangerous-shell denylist entry (`settings.security.shellPatterns`). */
export interface DangerousShellPattern {
  id: string;
  /** JavaScript RegExp source (no delimiters). Compiled with the `i` flag. */
  pattern: string;
  /** Short label for block messages / Settings UI. */
  label?: string;
}

/**
 * Built-in dangerous shell patterns (case-insensitive).
 * Used when `security.shellPatterns` is absent/undefined.
 */
export const DEFAULT_DANGEROUS_SHELL_PATTERNS: DangerousShellPattern[] = [
  {
    id: 'rm_rf_root',
    pattern: String.raw`\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|-[a-zA-Z]*\s+)*\/\s*($|&&|\||;)`,
    label: 'rm -rf /',
  },
  {
    id: 'rm_rf_star',
    pattern: String.raw`\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+(\/\*|~\/\*|\$HOME\/\*)`,
    label: 'rm -rf /*',
  },
  {
    id: 'rm_rf_ssh',
    pattern: String.raw`\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+(~|\$HOME|\$\{HOME\})\/\.ssh\b`,
    label: 'rm -rf ~/.ssh',
  },
  {
    id: 'rm_rf_home',
    // Bare home only (~ / $HOME / ${HOME}, optional trailing / or /., optional quotes).
    // NOT ~/subdir (node_modules etc.). Also long-option --recursive --force (either order).
    pattern: String.raw`\brm\s+(?:(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)|(?:--recursive\s+--force|--force\s+--recursive))\s+["']?(~|\$HOME|\$\{HOME\})(?:\/\.?)?["']?(?=\s|$)`,
    label: 'rm -rf ~',
  },
  {
    id: 'rm_rf_no_preserve_root',
    pattern: String.raw`\brm\s+[^\n]*--no-preserve-root[^\n]*\s+\/\s*($|&&|\||;)`,
    label: 'rm --no-preserve-root /',
  },
  {
    id: 'sudo',
    // Path-qualified, `command sudo`, `env … sudo`, and VAR=val sudo prefixes.
    pattern: String.raw`(^|[;&|\`\n]|\$\()\s*(?:command\s+)?(?:env\s+(?:-[a-zA-Z]+\s+)*(?:[A-Za-z_][\w]*=\S*\s+)*)?(?:\/[^\s]+\/)?sudo\b|(?:^|[;&|\`\n]|\$\()\s*(?:[A-Za-z_][\w]*=\S*\s+)+sudo\b`,
    label: 'sudo',
  },
  {
    id: 'mkfs',
    pattern: String.raw`\bmkfs(\.\w+)?\b`,
    label: 'mkfs',
  },
  {
    id: 'dd_if',
    pattern: String.raw`\bdd\s+.*\bif=`,
    label: 'dd if=',
  },
  {
    id: 'curl_pipe_sh',
    pattern: String.raw`\b(curl|wget)\b[^|\n]*\|\s*(ba)?sh\b`,
    label: 'curl|sh / wget|sh',
  },
  {
    id: 'chmod_777_root',
    pattern: String.raw`\bchmod\s+(-R\s+)?777\s+\/(\s|$)`,
    label: 'chmod 777 /',
  },
  {
    id: 'diskutil_erase',
    pattern: String.raw`\bdiskutil\s+erase`,
    label: 'diskutil erase',
  },
  {
    id: 'shutdown',
    pattern: String.raw`\b(shutdown|reboot|halt|poweroff)\b`,
    label: 'shutdown/reboot',
  },
  {
    id: 'fork_bomb',
    pattern: String.raw`:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:`,
    label: 'fork bomb',
  },
  {
    id: 'write_disk',
    pattern: String.raw`>\s*\/dev\/(sd|disk|rdisk|nvme)`,
    label: 'write to /dev/disk',
  },
];

/**
 * Local-tool safety knobs (`settings.json` root key `security`).
 * Guardrails run before needsApproval / HITL. No migration shims for older shapes.
 */
/**
 * Agent-level + tool-output guardrails (`settings.security.agent`).
 * Gated by master `security.enabled`. Defaults prefer off / soft for a trusted personal desktop.
 */
export interface SecurityAgentSettings {
  /** Reject user text longer than {@link maxInputChars}. Default false. */
  maxInputCharsEnabled: boolean;
  /** Cap when maxInputCharsEnabled (clamped 1_000..2_000_000). Default 100_000. */
  maxInputChars: number;
  /** Reject empty / whitespace-only agent input. Default false. */
  rejectEmptyInput: boolean;
  /** Heuristic jailbreak / instruction-override detection (tripwire). Default false. */
  jailbreakEnabled: boolean;
  /** Soft injection markers (system/assistant tags, etc.). Default false. */
  injectionHygiene: boolean;
  /** Tripwire when input looks like pasted secrets / phone-like PII. Default false. */
  piiPasteWarn: boolean;
  /** Tripwire when final agent reply contains suspected secrets / phones. Default false. */
  outputSecretsEnabled: boolean;
  /**
   * Redact suspected secrets in tool results (shell / file-read / …) before model context.
   * Uses tool output guardrail rejectContent (redacted) or throwException per blockMode.
   * Default false.
   */
  toolOutputSecretsEnabled: boolean;
}

export interface SecuritySettings {
  /** Master switch. When false, no tool / agent guardrails are attached. Default true. */
  enabled: boolean;
  /**
   * When true, file paths and shell cwd must resolve under the tool root (~ / homedir)
   * or under an entry in allowedPathPrefixes.
   */
  restrictToHome: boolean;
  /** Extra allowed absolute/~ path prefixes (one per line in UI). */
  allowedPathPrefixes: string[];
  /** Always-denied path prefixes (checked before allowlist). */
  deniedPathPrefixes: string[];
  /** Scan run_shell commands for dangerous patterns. */
  shellPatternsEnabled: boolean;
  /**
   * Custom dangerous-shell regex list.
   * Absent/undefined → {@link DEFAULT_DANGEROUS_SHELL_PATTERNS}.
   * Explicit `[]` → clear denylist (no patterns).
   * Non-empty raw that normalizes to zero valid rows → fall back to defaults
   * (never silently disable the denylist due to typos / malformed rows).
   */
  shellPatterns?: DangerousShellPattern[];
  /**
   * reject = rejectContent (Chinese reason to the model);
   * tripwire = throwException (abort the run).
   * Also used by tool-output secret redaction when enabled.
   */
  blockMode: SecurityBlockMode;
  /** Agent input/output + tool-output guardrail knobs. */
  agent: SecurityAgentSettings;
}

export const DEFAULT_DENIED_PATH_PREFIXES = [
  '~/.ssh',
  '~/.gnupg',
  '/etc',
  '/private/etc',
  '/System',
] as const;

export const DEFAULT_SECURITY_AGENT: SecurityAgentSettings = {
  maxInputCharsEnabled: false,
  maxInputChars: 100_000,
  rejectEmptyInput: false,
  jailbreakEnabled: false,
  injectionHygiene: false,
  piiPasteWarn: false,
  // Opt-in: over-broad redaction corrupts ordinary logs that flow back to the model.
  outputSecretsEnabled: false,
  toolOutputSecretsEnabled: false,
};

export const DEFAULT_SECURITY: SecuritySettings = {
  enabled: true,
  restrictToHome: true,
  allowedPathPrefixes: [],
  deniedPathPrefixes: [...DEFAULT_DENIED_PATH_PREFIXES],
  shellPatternsEnabled: true,
  blockMode: 'reject',
  agent: { ...DEFAULT_SECURITY_AGENT },
};

function normalizePathPrefixList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeShellPatternList(raw: unknown): DangerousShellPattern[] {
  if (!Array.isArray(raw)) return [];
  const out: DangerousShellPattern[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const pattern = typeof o.pattern === 'string' ? o.pattern.trim() : '';
    if (!pattern) continue;
    let id = typeof o.id === 'string' ? o.id.trim() : '';
    if (!id) {
      // Stable-enough fallback for malformed rows; UI always assigns ids on create.
      id = `sp_${out.length}_${pattern.slice(0, 32).replace(/[^a-zA-Z0-9]+/g, '_')}`;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    out.push(label ? { id, pattern, label } : { id, pattern });
  }
  return out;
}

/** Compile a shell denylist pattern; returns null when the source is empty or invalid. */
export function tryCompileShellPattern(pattern: string): RegExp | null {
  const src = pattern.trim();
  if (!src) return null;
  try {
    return new RegExp(src, 'i');
  } catch {
    return null;
  }
}

/**
 * Effective denylist: custom list when `shellPatterns` is set (including explicit
 * `[]`), otherwise built-in defaults. Callers must go through
 * {@link normalizeSecuritySettings} so malformed non-empty input does not become `[]`.
 */
export function resolveShellPatterns(security: SecuritySettings): DangerousShellPattern[] {
  if (security.shellPatterns !== undefined) {
    return security.shellPatterns.map((p) => ({ ...p }));
  }
  return DEFAULT_DANGEROUS_SHELL_PATTERNS.map((p) => ({ ...p }));
}

function clampInt(n: unknown, fallback: number, min: number, max: number): number {
  const v = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : NaN;
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

/** Clamp / fill agent guardrail knobs. Missing fields → DEFAULT_SECURITY_AGENT. */
export function normalizeSecurityAgentSettings(raw: unknown): SecurityAgentSettings {
  const src =
    raw && typeof raw === 'object'
      ? (raw as Partial<Record<keyof SecurityAgentSettings, unknown>>)
      : {};
  return {
    maxInputCharsEnabled: src.maxInputCharsEnabled === true,
    maxInputChars: clampInt(
      src.maxInputChars,
      DEFAULT_SECURITY_AGENT.maxInputChars,
      1_000,
      2_000_000,
    ),
    rejectEmptyInput: src.rejectEmptyInput === true,
    jailbreakEnabled: src.jailbreakEnabled === true,
    injectionHygiene: src.injectionHygiene === true,
    piiPasteWarn: src.piiPasteWarn === true,
    // Opt-in only — missing / undefined stays off (do not silently redact tool logs).
    outputSecretsEnabled: src.outputSecretsEnabled === true,
    toolOutputSecretsEnabled: src.toolOutputSecretsEnabled === true,
  };
}

/** Clamp / fill security from disk or UI. Missing fields → DEFAULT_SECURITY. */
export function normalizeSecuritySettings(raw: unknown): SecuritySettings {
  const src =
    raw && typeof raw === 'object' ? (raw as Partial<Record<keyof SecuritySettings, unknown>>) : {};
  const blockMode: SecurityBlockMode = src.blockMode === 'tripwire' ? 'tripwire' : 'reject';
  const out: SecuritySettings = {
    enabled: src.enabled !== false,
    restrictToHome: src.restrictToHome !== false,
    allowedPathPrefixes: normalizePathPrefixList(src.allowedPathPrefixes),
    deniedPathPrefixes: (() => {
      // Missing / null / '' → defaults. Non-array or empty-after-normalize must NOT
      // fail-open to [] (same spirit as shellPatterns malformed → keep defaults).
      if (src.deniedPathPrefixes == null || src.deniedPathPrefixes === '') {
        return [...DEFAULT_DENIED_PATH_PREFIXES];
      }
      if (!Array.isArray(src.deniedPathPrefixes)) {
        return [...DEFAULT_DENIED_PATH_PREFIXES];
      }
      if (src.deniedPathPrefixes.length === 0) {
        return []; // explicit clear
      }
      const normalized = normalizePathPrefixList(src.deniedPathPrefixes);
      return normalized.length > 0 ? normalized : [...DEFAULT_DENIED_PATH_PREFIXES];
    })(),
    shellPatternsEnabled: src.shellPatternsEnabled !== false,
    blockMode,
    agent: normalizeSecurityAgentSettings(src.agent),
  };
  if (Array.isArray(src.shellPatterns)) {
    // Literal [] = explicit clear. Non-empty raw that yields 0 valid
    // (structurally or compilable) patterns must NOT become [] (fail-open).
    if (src.shellPatterns.length === 0) {
      out.shellPatterns = [];
    } else {
      const normalized = normalizeShellPatternList(src.shellPatterns).filter((p) =>
        tryCompileShellPattern(p.pattern),
      );
      if (normalized.length > 0) {
        out.shellPatterns = normalized;
      }
      // else: omit shellPatterns → resolveShellPatterns uses defaults
    }
  }
  return out;
}
