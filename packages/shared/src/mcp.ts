/**
 * MCP (Model Context Protocol) servers — optional "advanced extensions".
 * Off by default. Every MCP tool call asks for approval (same HITL card as shell).
 */

export type McpTransport = 'stdio' | 'http';

export interface McpServerEntry {
  id: string;
  /** Display name; also the tool-name prefix (`mcp_<name>_<tool>`). */
  name: string;
  enabled: boolean;
  transport: McpTransport;
  /** stdio: executable. */
  command?: string;
  /** stdio: arguments, one per item. */
  args?: string[];
  /** stdio: extra environment (KEY=value). Treated as a secret in backups. */
  env?: Record<string, string>;
  /** http: streamable-HTTP endpoint URL. */
  url?: string;
  /** http: extra request headers (for example Authorization). Treated as a secret. */
  headers?: Record<string, string>;
}

export interface McpSettings {
  /** Master switch. Default false. */
  enabled: boolean;
  servers: McpServerEntry[];
}

export const DEFAULT_MCP_SETTINGS: McpSettings = { enabled: false, servers: [] };

const MAX_MCP_SERVERS = 20;

function normalizeStringMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim();
    if (!key || typeof v !== 'string') continue;
    out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function normalizeMcpServerEntry(raw: unknown): McpServerEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  if (!id) return null;
  const name = (typeof r.name === 'string' ? r.name.trim() : '') || id;
  const transport: McpTransport = r.transport === 'http' ? 'http' : 'stdio';
  const entry: McpServerEntry = { id, name, enabled: r.enabled !== false, transport };
  if (transport === 'stdio') {
    const command = typeof r.command === 'string' ? r.command.trim() : '';
    if (command) entry.command = command;
    if (Array.isArray(r.args)) {
      const args = r.args.filter((a): a is string => typeof a === 'string');
      if (args.length) entry.args = args;
    }
    const env = normalizeStringMap(r.env);
    if (env) entry.env = env;
  } else {
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    if (url) entry.url = url;
    const headers = normalizeStringMap(r.headers);
    if (headers) entry.headers = headers;
  }
  return entry;
}

export function normalizeMcpSettings(raw: unknown): McpSettings {
  if (!raw || typeof raw !== 'object') return { enabled: false, servers: [] };
  const r = raw as Record<string, unknown>;
  const servers: McpServerEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(r.servers)) {
    for (const item of r.servers) {
      const s = normalizeMcpServerEntry(item);
      if (!s || seen.has(s.id)) continue;
      seen.add(s.id);
      servers.push(s);
      if (servers.length >= MAX_MCP_SERVERS) break;
    }
  }
  return { enabled: r.enabled === true, servers };
}

/** True when the entry has what its transport needs to connect. */
export function isMcpServerConnectable(s: McpServerEntry): boolean {
  if (!s.enabled) return false;
  if (s.transport === 'stdio') return Boolean(s.command);
  return /^https?:\/\//i.test(s.url || '');
}

/** Parse `KEY=value` lines (env / headers editors). Blank and `#` lines are skipped. */
export function parseKeyValueLines(text: string, sep: '=' | ':' = '='): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf(sep);
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    if (k) out[k] = t.slice(i + 1).trim();
  }
  return out;
}

export function formatKeyValueLines(map: Record<string, string> | undefined, sep: '=' | ':' = '='): string {
  if (!map) return '';
  return Object.entries(map)
    .map(([k, v]) => `${k}${sep === ':' ? ': ' : '='}${v}`)
    .join('\n');
}

/** Every MCP tool exposed to the agent starts with this prefix. */
export const MCP_TOOL_PREFIX = 'mcp_';

export function isMcpToolName(toolName: string): boolean {
  return typeof toolName === 'string' && toolName.trim().toLowerCase().startsWith(MCP_TOOL_PREFIX);
}

function nameWords(name: string): string[] {
  return name
    .replace(/^-+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[-_.]+/)
    .filter(Boolean);
}

/**
 * Whole words that mark a name (flag, query key, env) as holding a secret.
 * Shared by URL query redaction and command-arg redaction.
 */
const SECRET_WORDS: ReadonlySet<string> = new Set([
  'token',
  'secret',
  'password',
  'passwd',
  'pass',
  'pwd',
  'apikey',
  'key',
  'bearer',
  'auth',
  'authorization',
  'credential',
  'credentials',
  'cookie',
  'session',
  'sig',
  'signature',
]);

/** A name with one of these words names a place or a kind, not a secret value. */
const NOT_A_VALUE_WORDS: ReadonlySet<string> = new Set([
  'file',
  'path',
  'dir',
  'directory',
  'env',
  'mode',
  'type',
  'url',
  'uri',
  'endpoint',
  'method',
  'flow',
  'scheme',
  'provider',
  'name',
  'header',
  'headers',
  'through', // `--pass-through` is a mode, not a password
  'sort', // `--sort-key` is a sort field
]);

/** True when a flag or variable name (for example `--api-key`, `API_TOKEN`) holds a secret value. */
export function isSecretName(name: string): boolean {
  // `apiKey` / `api-key` split into api + key, and `key` is in the list.
  const words = nameWords(name);
  if (!words.some((w) => SECRET_WORDS.has(w))) return false;
  return !words.some((w) => NOT_A_VALUE_WORDS.has(w));
}

/**
 * URL query keys: whole-word match, then plural (`tokens` → `token`), then a
 * substring stem (`passphrase`, `apikeys`). Place/mode words (`through`, `sort`,
 * `file`, …) still exempt so `pass_through` / `sort_key` stay — same exemptions
 * as args, without loosening `--pass-through` whole-word checks.
 */
export function isSecretQueryKey(name: string): boolean {
  const words = nameWords(name);
  if (words.some((w) => NOT_A_VALUE_WORDS.has(w))) return false;
  const stemOf = (w: string) => {
    if (SECRET_WORDS.has(w)) return true;
    if (w.endsWith('ies') && SECRET_WORDS.has(`${w.slice(0, -3)}y`)) return true;
    if (w.endsWith('es') && SECRET_WORDS.has(w.slice(0, -2))) return true;
    if (w.endsWith('s') && SECRET_WORDS.has(w.slice(0, -1))) return true;
    return false;
  };
  if (words.some(stemOf)) return true;
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const stem of SECRET_WORDS) {
    if (compact.includes(stem)) return true;
  }
  return false;
}

/**
 * URL with credentials removed: user:password and the values of query parameters
 * whose names look like secrets. Used in gateway responses and secret-free backups.
 * Query names use `isSecretQueryKey` (plurals / compounds); args stay whole-word
 * via `isSecretName`.
 */
export function redactSecretUrl(raw: string): string {
  if (!raw) return raw;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  let changed = false;
  if (u.username || u.password) {
    u.username = '';
    u.password = '';
    changed = true;
  }
  for (const key of [...u.searchParams.keys()]) {
    if (isSecretQueryKey(key) && u.searchParams.get(key)) {
      u.searchParams.set(key, '');
      changed = true;
    }
  }
  return changed ? u.toString() : raw;
}

/** HTTP MCP over plain http is allowed only to this machine (loopback). */
export function isInsecureRemoteMcpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:') return false;
    return !isLoopbackHostname(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Strict loopback check on a URL hostname (already normalized by `new URL`):
 * exactly `localhost`, IPv6 `::1`, an IPv4 address in 127.0.0.0/8, or the
 * IPv4-mapped form of one (`[::ffff:127.0.0.1]`, which `new URL` writes as
 * `[::ffff:7f00:1]`). A name such as `127.evil.com` is not loopback.
 */
export function isLoopbackHostname(hostname: string): boolean {
  let h = hostname.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  const mapped = /^(?:0{1,4}:){0,4}:?(?:0{0,4}:)?ffff:(.+)$/.exec(h);
  if (mapped) {
    const rest = mapped[1]!;
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
    if (hex) return parseInt(hex[1]!, 16) >> 8 === 127;
    h = rest;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) && parts[0] === 127;
}

/** Values that look like well-known API tokens or JWTs, even without a flag name. */
const TOKEN_LIKE_VALUE =
  /^(sk-|sk_|rk_|pk_live_|ghp_|gho_|ghs_|github_pat_|xox[abposr]-|glpat-|AKIA[0-9A-Z]{12}|eyJ[A-Za-z0-9_-]{8,}\.)/;

/** HTTP header names whose values are credentials. */
const SECRET_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
]);

/** Flags whose value is an HTTP header (`Name: value`). */
const HEADER_FLAGS: ReadonlySet<string> = new Set(['--header', '-H', '--headers']);

/** Short flags that take a password (exact). `-p 8080` (a port) is kept. */
const SHORT_SECRET_FLAGS: ReadonlySet<string> = new Set(['-p']);

/** `Authorization: Bearer x` → `Authorization: `; token-like values blanked on any header. */
export function redactHeaderLine(line: string): string {
  const m = /^(\s*)([A-Za-z0-9-]+)(\s*:\s*)([\s\S]*)$/.exec(line);
  if (!m) return line;
  const name = m[2]!.toLowerCase();
  const value = m[4]!;
  if (!value) return line;
  if (SECRET_HEADERS.has(name) || isSecretName(name)) return `${m[1]}${m[2]}${m[3]}`;
  const blanked = redactValue(value);
  return blanked === value ? line : `${m[1]}${m[2]}${m[3]}${blanked}`;
}

function redactValue(value: string): string {
  if (/^bearer\s+\S/i.test(value)) return value.replace(/^(bearer)\s+[\s\S]*$/i, '$1 ');
  if (TOKEN_LIKE_VALUE.test(value)) return '';
  // A URL with embedded credentials / secret query keys.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    const u = redactSecretUrl(value);
    if (u !== value) return u;
  }
  return value;
}

/**
 * Command arguments with secret values blanked. One function for secret-free
 * backups and for gateway settings responses.
 * - `--token=abc`, `--api-key abc`, `--bearer=…`, `--pass=…`, `--session=…`,
 *   `--sig=…`, `API_KEY=abc`: the value is blanked. Names match whole words
 *   (same list as URL query keys), so `--monkey`, `--pass-through` stay;
 *   names about a place (`--credentials-file`, `--token-env`, `--sort-key`) stay.
 * - `--header "Authorization: Bearer x"`, `-H …`, `--header=Cookie: …`: the header
 *   value is blanked when the header is a credential header; token-like values on
 *   any header are blanked.
 * - `-p <value>`, `-p=…`, `-phunter2`: blanked unless the value is a port number.
 * - A bare value that looks like a known token (`sk-…`, `ghp_…`, a JWT), `Bearer x`,
 *   or a URL with credentials is blanked / scrubbed.
 */
export function redactSecretArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  let next: 'secret' | 'header' | 'short' | null = null;
  for (const arg of args) {
    if (next && !arg.startsWith('-')) {
      if (next === 'header') out.push(redactHeaderLine(arg));
      else if (next === 'short') out.push(/^\d+$/.test(arg) ? arg : '');
      else out.push('');
      next = null;
      continue;
    }
    next = null;

    // Short password glued to the value: `-phunter2` or `-p=hunter2` (port digits kept).
    const shortEq = /^-p=(.*)$/.exec(arg);
    if (shortEq) {
      out.push(/^\d+$/.test(shortEq[1]!) ? arg : '-p=');
      continue;
    }
    const shortGlue = /^-p([^-=].*)$/.exec(arg);
    if (shortGlue) {
      // `-phunter2` → keep the flag letter only (value was glued; cannot round-trip).
      out.push(/^\d+$/.test(shortGlue[1]!) ? arg : '-p');
      continue;
    }

    const eq = arg.indexOf('=');
    const isFlag = /^-{1,2}[A-Za-z]/.test(arg);
    if (isFlag && eq < 0) {
      if (HEADER_FLAGS.has(arg)) next = 'header';
      else if (SHORT_SECRET_FLAGS.has(arg)) next = 'short';
      else if (isSecretName(arg)) next = 'secret';
      out.push(arg);
      continue;
    }
    if (eq > 0) {
      const name = arg.slice(0, eq);
      const value = arg.slice(eq + 1);
      if (isFlag && HEADER_FLAGS.has(name)) {
        out.push(`${name}=${redactHeaderLine(value)}`);
        continue;
      }
      if (/^-{0,2}[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) && isSecretName(name) && value) {
        out.push(`${name}=`);
        continue;
      }
      if (/^-{0,2}[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) && value) {
        out.push(`${name}=${redactValue(value)}`);
        continue;
      }
      out.push(isFlag ? `${name}=${redactValue(value)}` : redactValue(arg));
      continue;
    }
    const header = redactHeaderLine(arg);
    out.push(header !== arg ? header : redactValue(arg));
  }
  return out;
}
