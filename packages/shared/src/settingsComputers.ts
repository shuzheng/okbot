/** Computer / sandbox registry schema + normalize helpers (split from settings.ts). */

import { createId } from './text.js';
import { randomGatewayTokenSecret } from './settingsGatewayHttpApi.js';

/** Built-in always-on local desktop computer id. */
export const LOCAL_COMPUTER_ID = 'local';

/**
 * Named remote cloud computer (Docker sandbox) registered in settings.
 * Local is always available as `LOCAL_COMPUTER_ID` and is not stored in this list.
 */
export interface ComputerEntry {
  id: string;
  name: string;
  /** Hostname or IP (e.g. 127.0.0.1 or LAN IP of Mac mini). */
  host: string;
  /** Sandbox HTTP port. Default 18790. */
  port: number;
  /** Bearer token matching SANDBOX_TOKEN. */
  token: string;
  /** When false, not offered as a default and not used for routing. Default true. */
  enabled: boolean;
}

export const DEFAULT_SANDBOX_PORT = 18790;

export function generateComputerId(): string {
  return createId('computer');
}

export function generateComputerToken(): string {
  return randomGatewayTokenSecret();
}

export function normalizeComputerEntry(raw: unknown): ComputerEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<ComputerEntry>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const host = typeof o.host === 'string' ? o.host.trim() : '';
  let port =
    typeof o.port === 'number' && Number.isFinite(o.port) ? Math.floor(o.port) : DEFAULT_SANDBOX_PORT;
  if (port < 1 || port > 65535) port = DEFAULT_SANDBOX_PORT;
  const token = typeof o.token === 'string' ? o.token.trim() : '';
  if (!id || id === LOCAL_COMPUTER_ID) return null;
  // name+host required; token may be empty when gateway/WebUI projects blanked secrets.
  // Empty-token rows must survive hydrate → autosave so carryOverSecrets can refill by id.
  if (!name || !host) return null;
  if (token && !/^[A-Za-z0-9._~+/=-]+$/.test(token)) return null;
  const enabled = (o as { enabled?: unknown }).enabled === false ? false : true;
  return { id, name, host, port, token, enabled };
}

export function normalizeComputers(raw: unknown): ComputerEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ComputerEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const c = normalizeComputerEntry(item);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/**
 * Default shell/fs computer. Empty, `local`, or an id that is not in `computers`
 * becomes `local`. Callers do not have to pick one before chat works.
 */
export function normalizeDefaultComputerId(raw: unknown, computers: ComputerEntry[]): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id || id === LOCAL_COMPUTER_ID) return LOCAL_COMPUTER_ID;
  if (computers.some((c) => c.id === id && c.enabled !== false)) return id;
  return LOCAL_COMPUTER_ID;
}
