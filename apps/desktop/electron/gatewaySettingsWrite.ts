import type { AppSettings } from '@okbot/shared';

/** Gateway clients may change UI prefs only. Secrets and execution policy stay on the desktop. */
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
  'squad',
  'toolRun',
] as const;

const SECRET_FIELD = new Set(['token', 'apiKey']);

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

/**
 * True when `incoming` is the stored value, or the same value with secrets blanked
 * the way bootstrap/settings responses blank them. A real edit is not an echo.
 */
export function isBlankedSettingsEcho(incoming: unknown, stored: unknown): boolean {
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
        SECRET_FIELD.has(key) &&
        (inObj[key] === '' || inObj[key] == null) &&
        typeof stObj[key] === 'string'
      ) {
        continue;
      }
      if (!(key in inObj) || !(key in stObj)) return false;
      if (!isBlankedSettingsEcho(inObj[key], stObj[key])) return false;
    }
    return true;
  }
  return false;
}

export function mergeGatewaySettingsPatch(current: AppSettings, patch: Record<string, unknown>): AppSettings {
  const next: AppSettings = { ...current };
  const bag = next as unknown as Record<string, unknown>;
  for (const key of GATEWAY_SETTINGS_PATCH_KEYS) {
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
  for (const key of Object.keys(patch)) {
    if (allowed.has(key)) continue;
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
