/**
 * Full backup / restore of the gateway host tree (`~/.okbot`) as one zip archive.
 * Uses the system `zip` / `unzip` (same as assistant packages).
 *
 * Gateway payload is `data/` + `server.json` (legacy archives may still use flat
 * layout + `settings.json`). Machine-local client files (`client.json`, legacy
 * `gateways.json` / `window.json`) and the process lock (`runtime.json`) are skipped.
 *
 * - Export can strip secrets: model API keys, gateway token, computer tokens,
 *   MCP env / header values. A marker file records that choice.
 * - Restore validates the archive, moves the current directory aside
 *   (`<root>-before-restore-<time>`), then installs the backup. Current
 *   client files (`client.json`, etc.) and `runtime.json` are copied from the
 *   live tree into the restored tree so client chrome is not replaced. When the
 *   backup has no secrets, current secrets are carried over only to entries
 *   whose endpoint is exactly the same (so a backup cannot redirect a key
 *   elsewhere).
 * - MCP is turned off after a restore: the backup may bring commands that would
 *   run on the next chat. The user turns it on again in 设置 → 扩展.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { redactSecretArgs, redactSecretUrl } from '@okbot/shared';

export const BACKUP_FORMAT = 'okbot-backup' as const;
const MARKER = 'okbot-backup.json';
/** Runtime files that must not travel between machines / processes. */
const SKIP_NAMES = new Set([
  'runtime.json',
  'client.json',
  'gateways.json', // legacy client gateway list (now nested in client.json)
  'window.json', // legacy client window (now nested in client.json)
  'client-settings.json',
  'client-gateways.json',
  'restore-notice.json',
]);
const MAX_ENTRIES = 200_000;
/** Refuse archives that unpack to more than this (zip bomb guard). */
const MAX_UNPACKED_BYTES = 16 * 1024 ** 3;

type Marker = { format: typeof BACKUP_FORMAT; createdAt: string; excludeSecrets: boolean };


function resolveSettingsFile(dir: string): string | null {
  const server = path.join(dir, 'server.json');
  if (fs.existsSync(server)) return server;
  const legacy = path.join(dir, 'settings.json');
  if (fs.existsSync(legacy)) return legacy;
  return null;
}


type Json = Record<string, unknown>;

function asObj(v: unknown): Json | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
}

function blankMap(m: unknown): unknown {
  const o = asObj(m);
  return o ? Object.fromEntries(Object.keys(o).map((k) => [k, ''])) : m;
}

/** Gateway settings (server.json / legacy settings.json) without secrets. */
export function stripSettingsSecrets(raw: unknown): unknown {
  const s = asObj(raw);
  if (!s) return raw;
  const out: Json = { ...s };
  const model = asObj(s.model);
  if (model && Array.isArray(model.providers)) {
    out.model = { ...model, providers: model.providers.map((p) => ({ ...(asObj(p) ?? {}), apiKey: '' })) };
  }
  const api = asObj(s.gatewayHttpApi);
  if (api) {
    const nextApi: Json = { ...api, token: '', adminToken: '' };
    if (Array.isArray(api.apiTokens)) {
      nextApi.apiTokens = api.apiTokens.map((t) => {
        const o = asObj(t) ?? {};
        return { ...o, token: '' };
      });
    }
    out.gatewayHttpApi = nextApi;
  }
  if (Array.isArray(s.computers)) {
    out.computers = s.computers.map((c) => ({ ...(asObj(c) ?? {}), token: '' }));
  }
  const mcp = asObj(s.mcp);
  if (mcp && Array.isArray(mcp.servers)) {
    out.mcp = {
      ...mcp,
      servers: mcp.servers.map((srv) => {
        const o = { ...(asObj(srv) ?? {}) };
        if (o.env) o.env = blankMap(o.env);
        if (o.headers) o.headers = blankMap(o.headers);
        if (typeof o.url === 'string') o.url = redactSecretUrl(o.url);
        if (Array.isArray(o.args)) o.args = redactSecretArgs(o.args.map(String));
        return o;
      }),
    };
  }
  const web = asObj(s.web);
  if (web) {
    const search = asObj(web.search);
    out.web = {
      ...web,
      ...(search ? { search: { ...search, apiKey: '' } } : {}),
    };
  }
  return out;
}

function sameFields(a: Json | undefined, b: Json, keys: readonly string[]): boolean {
  if (!a) return false;
  return keys.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));
}

/** True when incoming URL equals old, or equals redactSecretUrl(old) (bootstrap round-trip). */
function sameEndpointUrl(incoming: unknown, old: unknown): boolean {
  if (typeof incoming !== 'string' || typeof old !== 'string') {
    return (incoming ?? null) === (old ?? null);
  }
  if (incoming === old) return true;
  return incoming === redactSecretUrl(old);
}

/**
 * Fill blank secrets in `restored` from `current`. An entry gets the old secret
 * only when its id and endpoint (provider baseURL, computer host/port, MCP
 * transport/command/args/url) match the current settings. Provider / web.search
 * baseURL and marketplace savedSources also match when `incoming ===
 * redactSecretUrl(old)` (gateway bootstrap projection), and then restore the
 * original URL plus secrets.
 *
 * `gatewayHttpApi.apiTokens`: non-empty list → refill blank tokens by id
 * (attach/WebUI placeholders). Explicit `[]` → intentional wipe (do not
 * resurrect). Omitted / non-array → keep current list (legacy backups).
 */
export function carryOverSecrets(restored: unknown, current: unknown): unknown {
  const r = asObj(restored);
  const c = asObj(current);
  if (!r || !c) return restored;
  const out: Json = { ...r };
  const byId = (list: unknown): Map<string, Json> => {
    const m = new Map<string, Json>();
    if (Array.isArray(list)) for (const item of list) {
      const o = asObj(item);
      if (o && typeof o.id === 'string') m.set(o.id, o);
    }
    return m;
  };
  const rModel = asObj(r.model);
  const cModel = asObj(c.model);
  if (rModel && Array.isArray(rModel.providers)) {
    const prev = byId(cModel?.providers);
    out.model = {
      ...rModel,
      providers: rModel.providers.map((p) => {
        const o = { ...(asObj(p) ?? {}) };
        const old = typeof o.id === 'string' ? prev.get(o.id) : undefined;
        // Match exact baseURL or bootstrap-redacted form; restore original URL + key.
        if (
          old &&
          !o.apiKey &&
          typeof old.apiKey === 'string' &&
          sameEndpointUrl(o.baseURL, old.baseURL)
        ) {
          o.apiKey = old.apiKey;
          if (typeof old.baseURL === 'string') o.baseURL = old.baseURL;
        }
        return o;
      }),
    };
  }
  const rApi = asObj(r.gatewayHttpApi);
  const cApi = asObj(c.gatewayHttpApi);
  if (rApi && cApi) {
    const nextApi = { ...rApi };
    let touched = false;
    // Explicit apiTokens: [] = intentional wipe (WebUI delete-all). Do not
    // resurrect the prior list or refill legacy dual fields — ensureGatewayToken
    // remints access+admin on next gateway start if both are gone.
    const intentionalClear =
      Array.isArray(rApi.apiTokens) && rApi.apiTokens.length === 0;
    if (!intentionalClear) {
      if (!rApi.token && typeof cApi.token === 'string') {
        nextApi.token = cApi.token;
        touched = true;
      }
      if (!rApi.adminToken && typeof cApi.adminToken === 'string') {
        nextApi.adminToken = cApi.adminToken;
        touched = true;
      }
    } else {
      // Keep restored blanks; do not copy current secrets back.
      nextApi.token = typeof rApi.token === 'string' ? rApi.token : '';
      nextApi.adminToken = typeof rApi.adminToken === 'string' ? rApi.adminToken : '';
      nextApi.apiTokens = [];
      touched = true;
    }
    if (Array.isArray(rApi.apiTokens) && rApi.apiTokens.length > 0) {
      // Attach/WebUI projection: empty-token placeholders → refill by id.
      const prevTok = byId(cApi.apiTokens);
      nextApi.apiTokens = rApi.apiTokens.map((t) => {
        const o = { ...(asObj(t) ?? {}) };
        const old = typeof o.id === 'string' ? prevTok.get(o.id) : undefined;
        if (!o.token && typeof old?.token === 'string') {
          o.token = old.token;
          touched = true;
        }
        return o;
      });
      touched = true;
    } else if (!Array.isArray(rApi.apiTokens) && Array.isArray(cApi.apiTokens) && cApi.apiTokens.length) {
      // Omitted apiTokens (legacy backup / partial patch) → keep current list.
      nextApi.apiTokens = cApi.apiTokens;
      touched = true;
    }
    if (touched) out.gatewayHttpApi = nextApi;
  }
  if (Array.isArray(r.computers)) {
    const prev = byId(c.computers);
    out.computers = r.computers.map((x) => {
      const o = { ...(asObj(x) ?? {}) };
      const old = typeof o.id === 'string' ? prev.get(o.id) : undefined;
      if (!o.token && sameFields(old, o, ['host', 'port']) && typeof old?.token === 'string') o.token = old.token;
      return o;
    });
  }
  const rMcp = asObj(r.mcp);
  if (rMcp && Array.isArray(rMcp.servers)) {
    const prev = byId(asObj(c.mcp)?.servers);
    out.mcp = {
      ...rMcp,
      servers: rMcp.servers.map((x) => {
        const o = { ...(asObj(x) ?? {}) };
        const candidate = typeof o.id === 'string' ? prev.get(o.id) : undefined;
        // Same server only: args and url must equal the current ones after redaction.
        const argsMatch =
          Array.isArray(o.args) === Array.isArray(candidate?.args) &&
          (!Array.isArray(o.args) ||
            JSON.stringify(o.args) === JSON.stringify(redactSecretArgs((candidate!.args as unknown[]).map(String))));
        const old = sameFields(candidate, o, ['transport', 'command']) &&
          argsMatch &&
          typeof o.url === typeof candidate?.url &&
          (typeof o.url !== 'string' || o.url === redactSecretUrl(String(candidate?.url)))
          ? candidate
          : undefined;
        if (old && typeof old.url === 'string') o.url = old.url;
        if (old && Array.isArray(old.args)) o.args = old.args;
        for (const key of ['env', 'headers'] as const) {
          const map = asObj(o[key]);
          const oldMap = asObj(old?.[key]);
          if (!map || !oldMap) continue;
          o[key] = Object.fromEntries(
            Object.entries(map).map(([k, v]) => [k, v === '' && typeof oldMap[k] === 'string' ? oldMap[k] : v]),
          );
        }
        return o;
      }),
    };
  }
  const rWeb = asObj(r.web);
  const cWeb = asObj(c.web);
  if (rWeb) {
    const rSearch = asObj(rWeb.search);
    const cSearch = asObj(cWeb?.search);
    if (rSearch && !rSearch.apiKey && cSearch && typeof cSearch.apiKey === 'string') {
      // Same provider/compat + baseURL (exact or bootstrap-redacted) before restoring.
      if (
        sameFields(cSearch, rSearch, ['provider', 'compat']) &&
        sameEndpointUrl(rSearch.baseURL, cSearch.baseURL)
      ) {
        const nextSearch: Json = { ...rSearch, apiKey: cSearch.apiKey };
        if (typeof cSearch.baseURL === 'string') nextSearch.baseURL = cSearch.baseURL;
        out.web = {
          ...rWeb,
          search: nextSearch,
        };
      }
    }
  }
  // assistantMarketplace.savedSources may arrive redacted from gateway projection.
  const rMarket = asObj(r.assistantMarketplace);
  const cMarket = asObj(c.assistantMarketplace);
  if (rMarket && Array.isArray(rMarket.savedSources) && cMarket && Array.isArray(cMarket.savedSources)) {
    const prevUrls = cMarket.savedSources.filter((u): u is string => typeof u === 'string');
    out.assistantMarketplace = {
      ...rMarket,
      savedSources: rMarket.savedSources.map((u) => {
        if (typeof u !== 'string') return u;
        const match = prevUrls.find((old) => sameEndpointUrl(u, old));
        return match ?? u;
      }),
    };
  }
  return out;
}

/** After a restore MCP starts off; servers stay listed so the user can review them. */
const RESTORE_NOTICE = 'restore-notice.json';

/** One-shot notice left by a restore: read it once on startup, then delete it. */
export function takeRestoreNotice(root: string): { mcpTurnedOff: boolean } | null {
  const file = path.join(root, RESTORE_NOTICE);
  if (!fs.existsSync(file)) return null;
  const data = asObj(readJsonFile(file));
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
  return { mcpTurnedOff: data?.mcpTurnedOff === true };
}

export function disableMcpAfterRestore(restored: unknown): unknown {
  const r = asObj(restored);
  const mcp = asObj(r?.mcp);
  if (!r || !mcp || mcp.enabled !== true) return restored;
  return { ...r, mcp: { ...mcp, enabled: false } };
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function writeJsonFile(file: string, data: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}


/** Runtime / HITL state that must not travel in backups (may hold tool args / tokens). */
function shouldSkipBackupSource(absRoot: string, src: string): boolean {
  const base = path.basename(src);
  if (path.dirname(src) === absRoot && SKIP_NAMES.has(base)) return true;
  if (base === 'run-checkpoint.json' || base === 'pending-hitl.json') return true;
  // data/<owner>/pending-hitl(/…) — tool args may include secrets
  const rel = path.relative(absRoot, src);
  if (rel.startsWith('..')) return false;
  return rel.split(path.sep).includes('pending-hitl');
}

/** Write the backup archive. Returns the archive path. */
export function exportDataBackup(root: string, outFile: string, opts: { excludeSecrets: boolean }): string {
  const absRoot = path.resolve(root);
  const absOut = path.resolve(outFile);
  if (absOut === absRoot || absOut.startsWith(absRoot + path.sep)) {
    throw new Error('备份文件不能放在数据目录里面');
  }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-backup-'));
  try {
    fs.cpSync(absRoot, staging, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (src) => !shouldSkipBackupSource(absRoot, src),
    });
    const settingsFile = resolveSettingsFile(staging);
    if (opts.excludeSecrets) {
      if (settingsFile) writeJsonFile(settingsFile, stripSettingsSecrets(readJsonFile(settingsFile)));
      // Old copies made by migrations / corrupt-file backups still hold keys.
      for (const name of fs.readdirSync(staging)) {
        if (name.startsWith('settings.json.') || name.startsWith('server.json.')) {
          fs.rmSync(path.join(staging, name), { force: true });
        }
      }
    }
    const marker: Marker = { format: BACKUP_FORMAT, createdAt: new Date().toISOString(), excludeSecrets: opts.excludeSecrets };
    writeJsonFile(path.join(staging, MARKER), marker);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    if (fs.existsSync(absOut)) fs.rmSync(absOut, { force: true });
    execFileSync('zip', ['-r', '-q', '-y', absOut, '.'], { cwd: staging, maxBuffer: 10_000_000 });
    fs.chmodSync(absOut, 0o600);
    return absOut;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * zipinfo -t prints "N file(s), X bytes uncompressed, Y bytes compressed: Z%".
 * Fail closed: if the total cannot be read, the backup is refused.
 */
/** Force C locale so `unzip -Z -t` totals parse the same on every machine. */
const UNZIP_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' };

export function parseUnpackedBytes(totals: string): number | null {
  const m = /([\d,]+) bytes uncompressed/.exec(totals);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function assertUnpackedSizeOk(file: string): void {
  let totals = '';
  try {
    totals = execFileSync('unzip', ['-Z', '-t', file], { encoding: 'utf8', maxBuffer: 1_000_000, env: UNZIP_ENV });
  } catch {
    throw new Error('无法确认备份文件解压后的大小');
  }
  const bytes = parseUnpackedBytes(totals);
  if (bytes == null) throw new Error('无法确认备份文件解压后的大小');
  if (bytes > MAX_UNPACKED_BYTES) throw new Error('备份文件解压后过大');
}

function assertSafeListing(file: string): void {
  let listing = '';
  try {
    listing = execFileSync('unzip', ['-Z', '-1', file], { encoding: 'utf8', maxBuffer: 200_000_000, env: UNZIP_ENV });
  } catch {
    throw new Error('无法读取备份文件（需要系统 unzip）');
  }
  const lines = listing.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length > MAX_ENTRIES) throw new Error('备份文件条目过多');
  if (!lines.includes(MARKER)) throw new Error('这不是 OkBot 备份文件');
  assertUnpackedSizeOk(file);
  for (const line of lines) {
    if (line.includes('\\') || line.startsWith('/') || /^[A-Za-z]:/.test(line)) throw new Error('备份文件路径不合法');
    const normalized = line.replace(/\/+$/, '');
    if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('备份文件路径不合法');
    }
  }
}

/** Reject symlinks that point outside the extracted tree. */
function assertNoEscapingLinks(dir: string): void {
  const base = path.resolve(dir);
  const walk = (current: string) => {
    for (const name of fs.readdirSync(current)) {
      const abs = path.join(current, name);
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) {
        const target = path.resolve(path.dirname(abs), fs.readlinkSync(abs));
        if (target !== base && !target.startsWith(base + path.sep)) throw new Error('备份文件包含指向外部的链接，已拒绝');
        continue;
      }
      if (st.isDirectory()) walk(abs);
    }
  };
  walk(base);
}

/**
 * Replace the data directory with the backup. The current directory is kept as
 * `<root>-before-restore-<time>`. Returns that path. Caller restarts the app.
 */
export function restoreDataBackup(root: string, archive: string): { previousDir: string } {
  const absRoot = path.resolve(root);
  const absArchive = path.resolve(archive);
  if (!fs.statSync(absArchive).isFile()) throw new Error('备份文件不存在');
  assertSafeListing(absArchive);
  const parent = path.dirname(absRoot);
  // Extract next to the data dir so the final rename stays on one filesystem.
  const staging = fs.mkdtempSync(path.join(parent, `.${path.basename(absRoot)}-restore-`));
  try {
    execFileSync('unzip', ['-q', '-o', absArchive, '-d', staging], { maxBuffer: 10_000_000, env: UNZIP_ENV });
    assertNoEscapingLinks(staging);
    const marker = readJsonFile(path.join(staging, MARKER)) as Partial<Marker> | null;
    if (!marker || marker.format !== BACKUP_FORMAT) throw new Error('这不是 OkBot 备份文件');
    const settingsFile = resolveSettingsFile(staging);
    const currentSettingsFile = resolveSettingsFile(absRoot);
    const currentSettings = currentSettingsFile ? readJsonFile(currentSettingsFile) : null;
    if (settingsFile) {
      let restored = readJsonFile(settingsFile);
      if (marker.excludeSecrets && currentSettings) restored = carryOverSecrets(restored, currentSettings);
      const mcpWasOn = asObj(asObj(restored)?.mcp)?.enabled === true;
      // Prefer canonical server.json in the restored tree.
      const destSettings = path.join(staging, 'server.json');
      if (settingsFile !== destSettings) {
        writeJsonFile(destSettings, disableMcpAfterRestore(restored));
        fs.rmSync(settingsFile, { force: true });
      } else {
        writeJsonFile(settingsFile, disableMcpAfterRestore(restored));
      }
      // Shown once after the relaunch (see `takeRestoreNotice`).
      if (mcpWasOn) writeJsonFile(path.join(staging, RESTORE_NOTICE), { mcpTurnedOff: true });
    }
    fs.rmSync(path.join(staging, MARKER), { force: true });
    // Runtime files of this machine stay.
    for (const name of SKIP_NAMES) {
      if (name === RESTORE_NOTICE) continue;
      const src = path.join(absRoot, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(staging, name));
    }
    const previousDir = `${absRoot}-before-restore-${timestamp()}`;
    if (fs.existsSync(absRoot)) fs.renameSync(absRoot, previousDir);
    try {
      fs.renameSync(staging, absRoot);
    } catch (err) {
      if (fs.existsSync(previousDir) && !fs.existsSync(absRoot)) fs.renameSync(previousDir, absRoot);
      throw err;
    }
    try {
      fs.chmodSync(absRoot, 0o700);
    } catch {
      /* ignore */
    }
    return { previousDir };
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  }
}
