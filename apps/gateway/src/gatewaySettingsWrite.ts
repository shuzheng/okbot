import { redactSecretArgs, redactSecretUrl, isClientSettingsKey, type AppSettings } from '@okbot/shared';
import { carryOverSecrets } from './backup';

/**
 * MCP settings for a gateway response: env / header values blank, URL and args secrets removed.
 */
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
 * Gateway settings write for POST /v1/settings (admin Bearer only — auth gate
 * rejects access/user tokens with 403 `admin_required` before this runs).
 *
 * Applies every non-client key, then refills blanked secrets from the live host
 * config (same rules as backup restore carry-over). Client chrome keys
 * (`isClientSettingsKey`) stay on the client and are ignored here — that is the
 * client vs gateway split, not a legacy permission whitelist.
 */
export function resolveGatewaySettingsWrite(
  current: AppSettings,
  patch: Record<string, unknown>,
): { ok: true; next: AppSettings } {
  const currentBag = current as unknown as Record<string, unknown>;
  const nextBag: Record<string, unknown> = { ...currentBag };
  for (const key of Object.keys(patch)) {
    if (isClientSettingsKey(key)) continue;
    nextBag[key] = patch[key];
  }
  const merged = carryOverSecrets(nextBag, currentBag);
  return { ok: true, next: (merged && typeof merged === 'object' ? merged : nextBag) as AppSettings };
}

/** Missing or invalid ?limit defaults to 50. Number(null) is 0, so it must not clamp to 1. */
export function parseMessagesLimit(raw: string | null): number {
  if (raw == null || raw.trim() === '') return 50;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(200, Math.max(1, Math.floor(n)));
}
