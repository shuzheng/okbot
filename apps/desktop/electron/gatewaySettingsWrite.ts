import { redactSecretArgs, redactSecretUrl, TOOL_IDS, type AppSettings, type AutoApprovalRule } from '@okbot/shared';

/**
 * Keys a gateway client (attach window / Web UI) may write freely: UI prefs and
 * run tuning. `autoApprovalEnabled` / `autoApprovalRules` are checked separately
 * (see checkGatewayApprovalWrite): the gateway may only do what the tool card
 * 「总是允许」 does, scoped to one exact built-in tool name.
 *
 * Still desktop-only: model keys, `tools` (enable / per-tool approval), `security`
 * (path and shell guards), `computers`, `localHttpApi`, `mcp` (starts
 * processes on this host), and `web` (search API key / fetch private-network flag).
 */
export const GATEWAY_SETTINGS_PATCH_KEYS = [
  'theme',
  'language',
  'microphoneId',
  'hardwareAcceleration',
  'autoUpdate',
  'sidebarDockMagnify',
  'developerMode',
  'contextCompression',
  'maxTurns',
  'instructions',
  'memory',
  'maintenance',
  'squad',
  'toolRun',
  'notifications',
  'showAdvancedSettings',
] as const;

const SECRET_FIELD = new Set(['token', 'apiKey']);
/** Maps whose values are secrets (MCP env / headers); gateway responses blank each value. */
const SECRET_MAP_FIELD = new Set(['env', 'headers']);

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null || typeof a !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
}

/** MCP settings for a gateway response: env / header values blank, URL and args secrets removed. */
export function blankMcpSecrets(mcp: AppSettings['mcp']): AppSettings['mcp'] {
  const blank = (m?: Record<string, string>) =>
    m ? Object.fromEntries(Object.keys(m).map((k) => [k, ''])) : undefined;
  return {
    enabled: mcp?.enabled === true,
    servers: (mcp?.servers ?? []).map((server) => ({
      ...server,
      ...(server.env ? { env: blank(server.env) } : {}),
      ...(server.headers ? { headers: blank(server.headers) } : {}),
      ...(server.url ? { url: redactSecretUrl(server.url) } : {}),
      ...(Array.isArray(server.args) ? { args: redactSecretArgs(server.args) } : {}),
    })),
  };
}

/**
 * True when `incoming` is the stored value, or the same value with secrets blanked
 * the way bootstrap/settings responses blank them. A real edit is not an echo.
 */
export function isBlankedSettingsEcho(
  incoming: unknown,
  stored: unknown,
  secretValues = false,
): boolean {
  if (deepEqual(incoming, stored)) return true;
  if (Array.isArray(incoming) && Array.isArray(stored)) {
    if (incoming.length !== stored.length) return false;
    return incoming.every((item, i) => isBlankedSettingsEcho(item, stored[i]));
  }
  if (
    incoming &&
    stored &&
    typeof incoming === 'object' &&
    typeof stored === 'object' &&
    !Array.isArray(incoming) &&
    !Array.isArray(stored)
  ) {
    const inObj = incoming as Record<string, unknown>;
    const stObj = stored as Record<string, unknown>;
    const keys = new Set([...Object.keys(inObj), ...Object.keys(stObj)]);
    for (const key of keys) {
      if (deepEqual(inObj[key], stObj[key])) continue;
      if (
        (secretValues || SECRET_FIELD.has(key)) &&
        (inObj[key] === '' || inObj[key] == null) &&
        typeof stObj[key] === 'string'
      ) {
        continue;
      }
      // MCP URL echo: responses strip URL credentials (redactSecretUrl).
      if (
        key === 'url' &&
        typeof inObj[key] === 'string' &&
        typeof stObj[key] === 'string' &&
        inObj[key] === redactSecretUrl(stObj[key] as string)
      ) {
        continue;
      }
      // MCP args echo: responses blank secret args (redactSecretArgs).
      if (
        key === 'args' &&
        Array.isArray(inObj[key]) &&
        Array.isArray(stObj[key]) &&
        (stObj[key] as unknown[]).every((v) => typeof v === 'string') &&
        deepEqual(inObj[key], redactSecretArgs(stObj[key] as string[]))
      ) {
        continue;
      }
      if (!(key in inObj) || !(key in stObj)) return false;
      if (!isBlankedSettingsEcho(inObj[key], stObj[key], SECRET_MAP_FIELD.has(key))) return false;
    }
    return true;
  }
  return false;
}

/** Auto-approval keys: accepted from the gateway only when checkGatewayApprovalWrite allows the change. */
export const GATEWAY_APPROVAL_KEYS = ['autoApprovalEnabled', 'autoApprovalRules'] as const;

const BUILT_IN_TOOLS: ReadonlySet<string> = new Set<string>(TOOL_IDS);

function isToolNameAllowRule(rule: AutoApprovalRule): boolean {
  return rule.action === 'allow' && BUILT_IN_TOOLS.has(rule.description.trim().toLowerCase());
}

function sameRuleExceptTime(a: AutoApprovalRule, b: AutoApprovalRule): boolean {
  return a.id === b.id && a.description === b.description && a.action === b.action;
}

function asRules(raw: unknown): AutoApprovalRule[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AutoApprovalRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') return null;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.description !== 'string') return null;
    if (o.action !== 'allow' && o.action !== 'ask') return null;
    out.push(r as AutoApprovalRule);
  }
  return out;
}

/**
 * The gateway may change auto-approval only in ways that are no broader than the
 * tool card 「总是允许」 for one built-in tool:
 * - add an allow rule whose text is exactly a built-in tool id (it matches that tool
 *   name only, see resolveAutoApproval), or turn an ask rule with that exact text to allow;
 * - add ask rules, remove allow rules, or turn auto-approval off (these only ask more).
 * Turning auto-approval on is allowed only when every allow rule is a tool-name rule.
 * Broad keyword allow rules (for example `a`) and edits of desktop rules stay desktop-only.
 */
export function checkGatewayApprovalWrite(
  current: Pick<AppSettings, 'autoApprovalEnabled' | 'autoApprovalRules'>,
  patch: Record<string, unknown>,
): boolean {
  const hasRules = Object.prototype.hasOwnProperty.call(patch, 'autoApprovalRules');
  const hasEnabled = Object.prototype.hasOwnProperty.call(patch, 'autoApprovalEnabled');
  const prevRules = current.autoApprovalRules ?? [];
  const nextRules = hasRules ? asRules(patch.autoApprovalRules) : prevRules;
  if (!nextRules) return false;
  const prevById = new Map(prevRules.map((r) => [r.id, r]));
  const nextIds = new Set(nextRules.map((r) => r.id));
  for (const prev of prevRules) {
    if (!nextIds.has(prev.id) && prev.action !== 'allow') return false; // removing an ask rule loosens
  }
  for (const next of nextRules) {
    const prev = prevById.get(next.id);
    if (prev && sameRuleExceptTime(prev, next)) continue;
    if (next.action === 'ask' && (!prev || prev.description === next.description)) continue;
    if (isToolNameAllowRule(next) && (!prev || prev.description === next.description)) continue;
    return false;
  }
  const prevEnabled = current.autoApprovalEnabled === true;
  const nextEnabled = hasEnabled ? patch.autoApprovalEnabled === true : prevEnabled;
  if (hasEnabled && typeof patch.autoApprovalEnabled !== 'boolean') return false;
  if (nextEnabled && !prevEnabled && !nextRules.every((r) => r.action !== 'allow' || isToolNameAllowRule(r))) {
    return false;
  }
  return true;
}

export function mergeGatewaySettingsPatch(current: AppSettings, patch: Record<string, unknown>): AppSettings {
  const next: AppSettings = { ...current };
  const bag = next as unknown as Record<string, unknown>;
  for (const key of [...GATEWAY_SETTINGS_PATCH_KEYS, ...GATEWAY_APPROVAL_KEYS]) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) bag[key] = patch[key];
  }
  return next;
}

/**
 * Allowed keys are applied. Any other key that is not just the blanked echo of
 * the saved value rejects the whole write so the client cannot treat it as saved.
 */
export function resolveGatewaySettingsWrite(
  current: AppSettings,
  patch: Record<string, unknown>,
): { ok: true; next: AppSettings } | { ok: false; rejectedKeys: string[] } {
  const allowed = new Set<string>(GATEWAY_SETTINGS_PATCH_KEYS);
  const currentBag = current as unknown as Record<string, unknown>;
  const rejectedKeys: string[] = [];
  const approvalOk = checkGatewayApprovalWrite(current, patch);
  for (const key of Object.keys(patch)) {
    if (allowed.has(key)) continue;
    if ((GATEWAY_APPROVAL_KEYS as readonly string[]).includes(key) && approvalOk) continue;
    if (isBlankedSettingsEcho(patch[key], currentBag[key])) continue;
    rejectedKeys.push(key);
  }
  if (rejectedKeys.length) return { ok: false, rejectedKeys };
  return { ok: true, next: mergeGatewaySettingsPatch(current, patch) };
}

/** Missing or invalid ?limit defaults to 50. Number(null) is 0, so it must not clamp to 1. */
export function parseMessagesLimit(raw: string | null): number {
  if (raw == null || raw.trim() === '') return 50;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(200, Math.max(1, Math.floor(n)));
}
