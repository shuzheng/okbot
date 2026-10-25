import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { isLoopbackHostname, normalizeChatStartPayload, normalizeUsageStats, normalizeMcpServerEntry, resolveGatewayAuth, checkGatewayApiTokenQuota, type AppSettings, type RuntimeEvent, type GatewayHttpApiSettings, type GatewayAuthRole, type GatewayAuthMatch } from '@okbot/shared';
import { acceptRuntimeEventForSseTurn, encodeRuntimeEventSse } from '@okbot/agent';
import type { IpcContext } from './ipc/context';
import { abortChatOwner } from './ipc/chatControl';
import { gatewayBootJs, gatewayLoginHtml, injectGatewayBoot, shouldServeGatewayLogin } from './gatewayLoginPage';
import { runtimeEventSinks } from './sessionEvents';
import { respondToToolApproval, startChatTurn } from './ipc/registerChat';
import { normalizeMessageAttachments } from './storage/sessionJsonl';
import { persistAppSettings } from './ipc/registerEntity';
import { blankMcpSecrets, parseMessagesLimit, resolveGatewaySettingsWrite } from './gatewaySettingsWrite';
import { isProbeNonce, probeChallengeMac } from './authChallenge';
import { readDesktopAppVersion } from './appVersion';
import { createEntityOps } from './entityOps';
import { isGatewayRpcAdminOp, runGatewayRpc } from './gatewayRpc';
import { claimNotify, notifyDeviceKey } from './notifyClaim';
import { exportDataBackup, restoreDataBackup } from './backup';
import { mcpStatus, mcpTest } from './mcpRuntime';
import os from 'node:os';

const LOOPBACK_HOST = '127.0.0.1';
const LAN_HOST = '0.0.0.0';

type GatewayHttpApiDeps = {
  ctx: IpcContext;
  /** Absolute path to renderer build (electron-vite out/renderer). Optional. */
  uiRoot?: string | null;
  /** Desktop package / Electron app version for gateway getAppInfo. */
  appVersion?: string;
  /**
   * After an admin HTTP backup restore replaces ~/.okbot, reload the host process.
   * Electron owner: relaunch the app. `okbot serve`: exit so the operator restarts.
   * Default: `process.exit(0)` after a short delay (response already flushed).
   */
  onHostDataRestored?: () => void;
};

type JsonBody = Record<string, unknown>;

type RuntimeEventListener = (event: RuntimeEvent) => void;

/** Sidebar maps `squad.members`; a stripped `{id,name}` row crashes the Sept 30 renderer. */
function gatewaySquadsForUi<T extends { members?: unknown }>(squads: T[]): T[] {
  return squads.map((squad) =>
    Array.isArray(squad.members) ? squad : { ...squad, members: [] },
  );
}


/** Strip credentials and the absolute data directory before a gateway response. */
function projectSettingsForGateway(settings: AppSettings): AppSettings {
  const model = settings.model;
  return {
    ...settings,
    model: {
      ...model,
      providers: Array.isArray(model?.providers)
        ? model.providers.map((provider) => ({ ...provider, apiKey: '' }))
        : [],
    },
    gatewayHttpApi: {
      ...settings.gatewayHttpApi,
      token: '',
      adminToken: '',
      apiTokens: Array.isArray(settings.gatewayHttpApi?.apiTokens)
        ? settings.gatewayHttpApi.apiTokens.map((t) => ({ ...t, token: '' }))
        : [],
    },
    computers: Array.isArray(settings.computers)
      ? settings.computers.map((computer) => ({ ...computer, token: '' }))
      : [],
    mcp: blankMcpSecrets(settings.mcp),
    web: {
      ...settings.web,
      search: {
        ...(settings.web?.search ?? { provider: 'tavily', apiKey: '', baseURL: '', compat: 'tavily' }),
        apiKey: '',
      },
      fetch: {
        allowPrivateNetwork: settings.web?.fetch?.allowPrivateNetwork === true,
      },
    },
  };
}




function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readBodyBuffer(req: IncomingMessage, limit = 1_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function backupFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `okbot-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
}

/** A run or waiting approval writes session / pending files: no backup or restore then. */
function gatewayDataBusy(ctx: IpcContext): boolean {
  return ctx.abortControllers.size > 0 || ctx.pendingToolApprovals.size > 0;
}

function scheduleHostDataRestored(deps: GatewayHttpApiDeps): void {
  const run = () => {
    try {
      if (deps.onHostDataRestored) deps.onHostDataRestored();
      else process.exit(0);
    } catch (err) {
      console.error('[okbot] onHostDataRestored failed', err);
      process.exit(1);
    }
  };
  setTimeout(run, 600);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.writableEnded) return;
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(raw),
    'Cache-Control': 'no-store',
  });
  res.end(raw);
}

/** Explicit Authorization / x-okbot-token only (no cookie, no query). */
function extractHeaderToken(req: IncomingMessage): string {
  const x = req.headers['x-okbot-token'];
  if (typeof x === 'string' && x.trim()) return x.trim();
  if (Array.isArray(x) && x[0]) return String(x[0]).trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

function extractToken(req: IncomingMessage): string {
  return extractHeaderToken(req) || cookieGatewayToken(req);
}


/** MIME for owner resources served at GET /v1/media/… */
function mediaMimeForExt(ext: string): string {
  const e = (ext || '').toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  if (e === '.svg') return 'image/svg+xml';
  if (e === '.png') return 'image/png';
  return 'application/octet-stream';
}

/**
 * Resolve ~/.okbot/<ownerId>/{resources|uploads}/<file> for the media gateway.
 * Same path rules as IPC readGeneratedAssetDataUrl.
 */
function resolveOwnerMediaFile(
  /** Durable data root (`~/.okbot/data`), not the okbot config root. */
  dataRootRaw: string,
  ownerId: string,
  subdir: 'resources' | 'uploads',
  fileName: string,
): { ok: true; filePath: string } | { ok: false; error: string } {
  const id = (ownerId || '').trim();
  const name = (fileName || '').trim();
  if (subdir !== 'resources' && subdir !== 'uploads') {
    return { ok: false, error: 'invalid asset path' };
  }
  if (!id || !name || id.includes('..') || name.includes('..')) {
    return { ok: false, error: 'invalid asset path' };
  }
  if (id.includes('/') || id.includes('\\') || id.includes('\0')) {
    return { ok: false, error: 'invalid asset path' };
  }
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return { ok: false, error: 'invalid asset path' };
  }
  const okbotRoot = path.resolve(dataRootRaw);
  const mediaDir = path.resolve(okbotRoot, id, subdir);
  const filePath = path.resolve(mediaDir, name);
  if (filePath !== mediaDir && !filePath.startsWith(mediaDir + path.sep)) {
    return { ok: false, error: 'path outside owner media' };
  }
  if (filePath !== okbotRoot && !filePath.startsWith(okbotRoot + path.sep)) {
    return { ok: false, error: 'path outside okbot data root' };
  }
  return { ok: true, filePath };
}

function matchPath(url: string): { pathname: string; parts: string[] } {
  let pathname = url.split('?')[0] || '/';
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    /* keep raw */
  }
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  return { pathname, parts };
}

/** Prefer Accept: text/event-stream as the SSE switch (not a bare wildcard). */
function wantsSse(req: IncomingMessage): boolean {
  const raw = req.headers.accept;
  const accept = Array.isArray(raw) ? raw.join(',') : raw || '';
  return accept.includes('text/event-stream');
}

function writeSseEvent(res: ServerResponse, event: RuntimeEvent): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    // false means backpressure, not a failed write — the chunk is still queued.
    res.write(encodeRuntimeEventSse(event));
    return true;
  } catch {
    return false;
  }
}

/** Loopback clients must not be reachable via a foreign Host (DNS rebinding). */
function isLoopbackHost(req: IncomingMessage): boolean {
  const raw = req.headers.host;
  const host = String(Array.isArray(raw) ? raw[0] : raw || '').trim().toLowerCase();
  if (!host) return false;
  let name = host;
  if (name.startsWith('[')) {
    const end = name.indexOf(']');
    if (end > 0) name = name.slice(0, end + 1);
  } else {
    name = name.replace(/:\d+$/, '');
  }
  return isLoopbackHostname(name) || name === 'localhost';
}


function cookieGatewayToken(req: IncomingMessage): string {
  const cookieHeader = String(req.headers.cookie || '');
  const m = /(?:^|;\s*)okbot_gateway_token=([^;]+)/.exec(cookieHeader);
  if (!m?.[1]) return '';
  try {
    return decodeURIComponent(m[1].trim());
  } catch {
    return m[1].trim();
  }
}

/**
 * Presented credential for media / login-gate checks.
 * Order: Authorization / x-okbot-token → ?token= → cookie.
 * Query must beat a stale cookie so <img src="…?token=new"> still works after regenerate.
 */
function presentedGatewayToken(req: IncomingMessage, urlObj?: URL): string {
  const header = extractHeaderToken(req);
  if (header) return header;
  if (urlObj) {
    const qToken = (urlObj.searchParams.get('token') || '').trim();
    if (qToken) return qToken;
  }
  return cookieGatewayToken(req);
}

function resolveRequestGatewayAuth(
  req: IncomingMessage,
  urlObj: URL,
  api: Pick<GatewayHttpApiSettings, 'token' | 'adminToken' | 'apiTokens'>,
): GatewayAuthMatch | null {
  return resolveGatewayAuth(presentedGatewayToken(req, urlObj), api);
}

function requestGatewayAuthed(
  req: IncomingMessage,
  urlObj: URL,
  api: Pick<GatewayHttpApiSettings, 'token' | 'adminToken' | 'apiTokens'>,
): boolean {
  return resolveRequestGatewayAuth(req, urlObj, api) != null;
}

const MAX_CHAT_TEXT_CHARS = 100_000;
const RATE_WINDOW_MS = 1000;
const RATE_MAX = 60;

function openSse(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Flush so proxies/clients see headers before the first RuntimeEvent.
  if (typeof (res as ServerResponse & { flushHeaders?: () => void }).flushHeaders === 'function') {
    (res as ServerResponse & { flushHeaders: () => void }).flushHeaders();
  }
  try {
    res.write(': connected\n\n');
  } catch {
    /* ignore */
  }
}

/**
 * Loopback-only HTTP API controller.
 * Binds 127.0.0.1; restarts when settings change; no-op when disabled.
 */
/** Settings passed to listen/sync; `apiTokens` optional (auth reads live storage). */
export type GatewayHttpApiListenSettings = Omit<GatewayHttpApiSettings, 'apiTokens'> & {
  apiTokens?: GatewayHttpApiSettings['apiTokens'];
};

export function createGatewayHttpApi(deps: GatewayHttpApiDeps): {
  sync: (settings: GatewayHttpApiListenSettings) => void;
  /**
   * Bind using port / token / bindLan / serveUi even when the desktop switch is off.
   * `okbot serve` and an Electron launch that owns the gateway both use this.
   * Rejects if the port cannot be bound (for example EADDRINUSE).
   */
  listen: (settings: GatewayHttpApiListenSettings) => Promise<void>;
  stop: () => void;
  /** Fan-in from main sendRuntimeEvent → active SSE subscribers. */
  bridgeRuntimeEvent: (event: RuntimeEvent) => void;
} {
  let server: http.Server | null = null;
  let listeningPort: number | null = null;
  let currentToken = '';
  let currentAdminToken = '';
  let bindLan = false;
  let serveUi = false;

  /**
   * Auth secrets: prefer disk (`server.json`) so a local Electron attach that writes
   * tokens via IPC is honored by `okbot serve` without a listener restart. Fall back
   * to the listen()-bound pair when storage is unavailable.
   */
  const liveAuthApi = (): Pick<GatewayHttpApiSettings, 'token' | 'adminToken' | 'apiTokens'> => {
    try {
      const api = deps.ctx.storage.getSettings().gatewayHttpApi;
      const access = typeof api?.token === 'string' ? api.token.trim() : '';
      const admin = typeof api?.adminToken === 'string' ? api.adminToken.trim() : '';
      return {
        token: access || currentToken,
        adminToken: admin || currentAdminToken,
        apiTokens: Array.isArray(api?.apiTokens) ? api.apiTokens : [],
      };
    } catch {
      return { token: currentToken, adminToken: currentAdminToken, apiTokens: [] };
    }
  };
  let starting: Promise<void> | null = null;
  const runtimeListeners = new Set<RuntimeEventListener>();
  /** Long-lived GET /v1/events subscribers (roster/settings + turn fan-out for attach/WebUI). */
  const sessionListeners = new Set<RuntimeEventListener>();
  const sessionPings = new Set<ReturnType<typeof setInterval>>();
  /** Long-lived SSE finish() hooks — called before stopSync destroys sockets. */
  const openSseFinishes = new Set<() => void>();
  const sockets = new Set<Socket>();
  const rateHits: number[] = [];
  const entityOps = createEntityOps(deps.ctx);

  const subscribeRuntimeEvent = (listener: RuntimeEventListener): (() => void) => {
    runtimeListeners.add(listener);
    return () => {
      runtimeListeners.delete(listener);
    };
  };

  const hardCloseServer = (): void => {
    for (const sock of sockets) {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
    }
    sockets.clear();
    if (!server) {
      listeningPort = null;
      return;
    }
    const s = server;
    server = null;
    listeningPort = null;
    try {
      s.close();
    } catch (err) {
      console.error('[okbot] gatewayHttpApi close failed', err);
    }
  };

  /**
   * Stop accepting traffic. Ends long-lived SSE first and briefly waits so the
   * chunked trailer can flush — otherwise Chrome logs
   * net::ERR_INCOMPLETE_CHUNKED_ENCODING on GET /v1/events when bindLan rebinds.
   */
  const stopSync = (): Promise<void> => {
    const hadSse = openSseFinishes.size > 0;
    for (const finish of [...openSseFinishes]) {
      try {
        finish();
      } catch {
        /* ignore */
      }
    }
    openSseFinishes.clear();
    runtimeListeners.clear();
    sessionListeners.clear();
    for (const ping of sessionPings) clearInterval(ping);
    sessionPings.clear();
    if (!hadSse) {
      hardCloseServer();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      setTimeout(() => {
        hardCloseServer();
        resolve();
      }, 40);
    });
  };

  const allowRate = () => {
    const now = Date.now();
    while (rateHits.length && now - rateHits[0]! >= RATE_WINDOW_MS) rateHits.shift();
    if (rateHits.length >= RATE_MAX) return false;
    rateHits.push(now);
    return true;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const method = (req.method || 'GET').toUpperCase();
    const { parts } = matchPath(req.url || '/');

    // Loopback-only mode rejects non-local peers; LAN gateway allows intranet.
    if (!bindLan) {
      const remote = req.socket.remoteAddress || '';
      if (remote && remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
        sendJson(res, 403, { ok: false, error: 'forbidden' });
        return;
      }
      if (!isLoopbackHost(req)) {
        sendJson(res, 403, { ok: false, error: 'forbidden_host' });
        return;
      }
    }

    // CORS for LAN browser / phone UI
    if (bindLan && method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-OkBot-Token',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end();
      return;
    }

    // GET /v1/health — no auth (existence only; no secrets).
    if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'health') {
      sendJson(res, 200, { ok: true, service: 'okbot-local-http-api' });
      return;
    }

    // GET /v1/auth-challenge?nonce= — prove we know access or admin token without receiving it.
    if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'auth-challenge') {
      const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
      const nonce = (urlObj.searchParams.get('nonce') || '').trim();
      const live = liveAuthApi();
      const secrets = [
        ...((live.apiTokens || []).map((e) => e.token).filter(Boolean)),
        live.token,
        live.adminToken,
      ].filter((t, i, arr) => t && arr.indexOf(t) === i);
      if (!isProbeNonce(nonce) || secrets.length === 0) {
        sendJson(res, 400, { ok: false, error: 'invalid_nonce' });
        return;
      }
      const accessMac = live.token ? probeChallengeMac(live.token, nonce) : '';
      const adminMac = live.adminToken ? probeChallengeMac(live.adminToken, nonce) : '';
      const macs = secrets.map((t) => probeChallengeMac(t, nonce));
      sendJson(res, 200, {
        ok: true,
        service: 'okbot-local-http-api',
        // `mac` stays the access token MAC for older clients; adminMac is optional.
        mac: accessMac || adminMac || macs[0] || '',
        ...(adminMac ? { adminMac } : {}),
        macs,
      });
      return;
    }

    // Boot script must exist before the renderer module. No secrets.
    if (method === 'GET' && parts.length === 1 && parts[0] === 'gateway-boot.js') {
      const js = gatewayBootJs();
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(js);
      return;
    }

    // POST /gateway-login — set HttpOnly cookie, never put the token in the URL.
    if (method === 'POST' && parts.length === 1 && parts[0] === 'gateway-login') {
      const raw = await readBody(req, 8_000);
      let token = '';
      const ctype = String(req.headers['content-type'] || '');
      if (ctype.includes('application/json')) {
        try {
          const json = JSON.parse(raw || '{}') as { token?: unknown };
          token = typeof json.token === 'string' ? json.token.trim() : '';
        } catch {
          token = '';
        }
      } else {
        const params = new URLSearchParams(raw);
        token = (params.get('token') || '').trim();
      }
      const liveLogin = liveAuthApi();
      const loginRole = resolveGatewayAuth(token, liveLogin)?.role ?? null;
      if (!loginRole) {
        res.writeHead(401, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(gatewayLoginHtml('令牌不正确 / Invalid token'));
        return;
      }
      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': `okbot_gateway_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    // Browser GET of the gateway URL shows the token form. /v1 stays JSON.
    if (method === 'GET') {
      const entryUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const entryPath = entryUrl.pathname || '/';
      const liveEntry = liveAuthApi();
      if (shouldServeGatewayLogin(method, entryPath, requestGatewayAuthed(req, entryUrl, liveEntry))) {
        const html = gatewayLoginHtml();
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(html);
        return;
      }
    }

    // Desktop gateway UI (LAN): login page is public; assets need token (header or ?token=).
    if (serveUi && method === 'GET' && deps.uiRoot && fs.existsSync(deps.uiRoot)) {
      const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = urlObj.pathname || '/';
      const qToken = (urlObj.searchParams.get('token') || '').trim();
      // Same order as presentedGatewayToken: header → query → cookie (query beats stale cookie).
      const presented =
        extractHeaderToken(req) || qToken || cookieGatewayToken(req) || '';
      const liveUi = liveAuthApi();
      const okAuth = resolveGatewayAuth(presented, liveUi) != null;
      // Static SPA assets (js/css/img/fonts) are not secret; browsers cannot attach Bearer on <script src>.
      const isStaticAsset = /\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|wasm)(\?|$)/i.test(pathname);
      // If browser asks for HTML without auth, send to login
      const accept = String(req.headers.accept || '');
      const wantsHtml = accept.includes('text/html') || pathname === '/' || pathname.endsWith('.html');
      if (!okAuth) {
        if (isStaticAsset) {
          // serve below without auth
        } else if (wantsHtml) {
          res.writeHead(302, { Location: '/gateway-login' });
          res.end();
          return;
        } else if (!pathname.startsWith('/v1/')) {
          sendJson(res, 401, { ok: false, error: 'unauthorized' });
          return;
        }
      }
      if ((okAuth || isStaticAsset) && !pathname.startsWith('/v1/')) {
        let rel = pathname === '/' ? '/index.html' : pathname;
        const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
        let filePath = path.join(deps.uiRoot, safe);
        const rootResolved = path.resolve(deps.uiRoot);
        if (!path.resolve(filePath).startsWith(rootResolved)) {
          sendJson(res, 403, { ok: false, error: 'forbidden' });
          return;
        }
        const requestedExt = path.extname(pathname).toLowerCase();
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          // Missing scripts must 404. Falling back to index.html makes the module
          // parser fail and leaves a blank page.
          if (requestedExt && requestedExt !== '.html') {
            sendJson(res, 404, { ok: false, error: 'not_found' });
            return;
          }
          filePath = path.join(deps.uiRoot, 'index.html');
        }
        if (!fs.existsSync(filePath)) {
          sendJson(res, 404, { ok: false, error: 'ui_not_built', hint: 'Run desktop build so out/renderer exists' });
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const types: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
          '.json': 'application/json',
          '.map': 'application/json',
          '.wasm': 'application/wasm',
        };
        const buf = fs.readFileSync(filePath);
        const headers: Record<string, string> = {
          'Content-Type': types[ext] || 'application/octet-stream',
          'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
        };
        if (qToken && resolveGatewayAuth(qToken, liveAuthApi())) {
          headers['Set-Cookie'] =
            `okbot_gateway_token=${encodeURIComponent(qToken)}; Path=/; HttpOnly; SameSite=Lax`;
        }
        if (ext === '.html') {
          res.writeHead(200, headers);
          res.end(injectGatewayBoot(buf.toString('utf8')));
          return;
        }
        res.writeHead(200, headers);
        res.end(buf);
        return;
      }
    }

    // GET /v1/media/:ownerId/{resources|uploads}/:file — chat images/files from ~/.okbot/…/resources/.
    // Auth accepts Bearer / cookie / ?token= because <img> cannot set Authorization.
    if (
      method === 'GET' &&
      parts.length === 5 &&
      parts[0] === 'v1' &&
      parts[1] === 'media' &&
      (parts[3] === 'resources' || parts[3] === 'uploads')
    ) {
      const mediaUrl = new URL(req.url || '/', 'http://127.0.0.1');
      if (!requestGatewayAuthed(req, mediaUrl, liveAuthApi())) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      let ownerId = parts[2] || '';
      let fileName = parts[4] || '';
      try {
        ownerId = decodeURIComponent(ownerId);
        fileName = decodeURIComponent(fileName);
      } catch {
        sendJson(res, 400, { ok: false, error: 'invalid asset path' });
        return;
      }
      const subdir = parts[3] === 'uploads' ? 'uploads' as const : 'resources' as const;
      const resolved = resolveOwnerMediaFile(deps.ctx.storage.dataRoot, ownerId, subdir, fileName);
      if (!resolved.ok) {
        sendJson(res, 400, { ok: false, error: resolved.error });
        return;
      }
      try {
        const st = fs.statSync(resolved.filePath);
        if (!st.isFile()) {
          sendJson(res, 404, { ok: false, error: 'not_found' });
          return;
        }
        if (st.size > 25 * 1024 * 1024) {
          sendJson(res, 413, { ok: false, error: 'asset too large' });
          return;
        }
        const buf = fs.readFileSync(resolved.filePath);
        const mime = mediaMimeForExt(path.extname(resolved.filePath));
        const headers: Record<string, string> = {
          'Content-Type': mime,
          'Content-Length': String(buf.byteLength),
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        };
        if (bindLan) {
          headers['Access-Control-Allow-Origin'] = '*';
        }
        res.writeHead(200, headers);
        res.end(buf);
      } catch {
        sendJson(res, 404, { ok: false, error: 'not_found' });
      }
      return;
    }

    const token = extractToken(req);
    const liveReq = liveAuthApi();
    const authMatch = resolveGatewayAuth(token, liveReq);
    const authRole = authMatch?.role ?? null;
    const authTokenId = authMatch?.tokenId ?? null;
    if (!authRole) {
      // A query token skips the login gate but is not an API credential.
      // When the built UI is not served, GET / would otherwise be this JSON,
      // which Electron shows as the whole window. Keep API routes JSON.
      const deniedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const deniedPath = deniedUrl.pathname || '/';
      if (method === 'GET' && (deniedPath === '/' || deniedPath === '/index.html')) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(gatewayLoginHtml());
        return;
      }
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    try {
      // GET /v1/events — durable stream: sessions_changed / settings_changed + turn events for non-initiator clients.
      if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'events') {
        openSse(res);
        let closed = false;
        const ping = setInterval(() => {
          if (closed || res.writableEnded || res.destroyed) {
            finish();
            return;
          }
          try {
            res.write(': ping\n\n');
          } catch {
            finish();
          }
        }, 25_000);
        ping.unref?.();
        sessionPings.add(ping);
        const finish = () => {
          if (closed) return;
          closed = true;
          openSseFinishes.delete(finish);
          sessionListeners.delete(onSession);
          clearInterval(ping);
          sessionPings.delete(ping);
          req.off('close', onClientClose);
          try {
            if (!res.writableEnded && !res.destroyed) {
              try {
                res.write(': shutdown\n\n');
              } catch {
                /* ignore */
              }
              res.end();
            }
          } catch {
            /* ignore */
          }
        };
        openSseFinishes.add(finish);
        const onSession = (event: RuntimeEvent) => {
          if (closed) return;
          if (!writeSseEvent(res, event)) finish();
        };
        const onClientClose = () => finish();
        sessionListeners.add(onSession);
        req.on('close', onClientClose);
        return;
      }

      // GET /v1/bots — same roster the desktop IPC returns (sidebar reads emoji, color, preview).
      if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'bots') {
        const bots = deps.ctx.storage.withReplyPreviews(deps.ctx.storage.listBots());
        sendJson(res, 200, { ok: true, bots });
        return;
      }

      // GET /v1/squads — full squad, members always an array (SessionSidebar maps squad.members).
      if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'squads') {
        const squads = gatewaySquadsForUi(
          deps.ctx.storage.withReplyPreviews(deps.ctx.storage.listSquads()),
        );
        sendJson(res, 200, { ok: true, squads });
        return;
      }

      // GET /v1/gateway-token — echo only the presented credential + its role.
      // Access never learns adminToken. Bootstrap/settings responses keep tokens blank.
      if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'gateway-token') {
        sendJson(res, 200, {
          ok: true,
          token,
          role: authRole,
          ...(authTokenId ? { tokenId: authTokenId } : {}),
        });
        return;
      }

      // GET /v1/api-tokens/:id/usage — per-token usage by assistant/squad.
      // Admin may read any token; access may read only its own entry.
      if (
        method === 'GET' &&
        parts.length === 4 &&
        parts[0] === 'v1' &&
        parts[1] === 'api-tokens' &&
        parts[3] === 'usage'
      ) {
        const id = (parts[2] || '').trim();
        if (!id) {
          sendJson(res, 400, { ok: false, error: 'missing_id' });
          return;
        }
        if (authRole !== 'admin' && authTokenId !== id) {
          sendJson(res, 403, { ok: false, error: 'forbidden', reason: 'admin_required' });
          return;
        }
        const entry = (deps.ctx.storage.getSettings().gatewayHttpApi.apiTokens || []).find(
          (e) => e.id === id,
        );
        if (!entry) {
          sendJson(res, 404, { ok: false, error: 'token_not_found' });
          return;
        }
        const usage = deps.ctx.storage.getApiTokenUsage(id);
        sendJson(res, 200, {
          ok: true,
          tokenId: id,
          name: entry.name,
          role: entry.role,
          limits: entry.limits,
          usage,
        });
        return;
      }

      // POST /v1/notify-claim — one system notification per event per device (see notifyClaim).
      if (method === 'POST' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'notify-claim') {
        let tag = '';
        try {
          const raw = await readBody(req);
          const body = raw.trim() ? (JSON.parse(raw) as { tag?: unknown }) : {};
          tag = typeof body.tag === 'string' ? body.tag : '';
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid_json' });
          return;
        }
        sendJson(res, 200, { ok: true, granted: claimNotify(notifyDeviceKey(req.socket.remoteAddress), tag) });
        return;
      }

      // GET /v1/app-info — version for attach/Web UI settings (no secrets).
      if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'app-info') {
        const version = (deps.appVersion || readDesktopAppVersion() || '').trim() || '0.0.0';
        sendJson(res, 200, {
          ok: true,
          name: 'OkBot',
          version,
          platform: process.platform,
          arch: process.arch,
        });
        return;
      }

      // GET /v1/bootstrap — same shape as desktop getBootstrap so the pre-bridge renderer can render.
      if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'bootstrap') {
        const settings = deps.ctx.storage.getSettings();
        const bots = deps.ctx.storage.withReplyPreviews(deps.ctx.storage.listBots());
        const squads = gatewaySquadsForUi(
          deps.ctx.storage.withReplyPreviews(deps.ctx.storage.listSquads()),
        );
        const runs = deps.ctx.snapshotActiveRuns();
        sendJson(res, 200, {
          ok: true,
          bots,
          squads,
          settings: projectSettingsForGateway(settings),
          hardwareAccelerationActive: deps.ctx.hardwareAccelerationActive,
          busyBotIds: runs.busyBotIds ?? [],
          pendingToolRequests: runs.pendingToolRequests ?? [],
          activeRuns: runs,
        });
        return;
      }

      // GET /v1/bots/:id/messages?limit=
      if (
        method === 'GET' &&
        parts.length === 4 &&
        parts[0] === 'v1' &&
        (parts[1] === 'bots' || parts[1] === 'squads') &&
        parts[3] === 'messages'
      ) {
        const id = parts[2] || '';
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const limit = parseMessagesLimit(url.searchParams.get('limit'));
        const before = (url.searchParams.get('beforeMessageId') || '').trim();
        const page = deps.ctx.storage.getMessagesPage(id, {
          limit,
          beforeMessageId: before || null,
        });
        sendJson(res, 200, { ok: true, ...page });
        return;
      }

      // GET /v1/bots/:id/tasks | GET /v1/squads/:id/tasks — open multi-task queue (?all=1 → history too)
      if (
        method === 'GET' &&
        parts.length === 4 &&
        parts[0] === 'v1' &&
        (parts[1] === 'bots' || parts[1] === 'squads') &&
        parts[3] === 'tasks'
      ) {
        const id = parts[2] || '';
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const all = url.searchParams.get('all') === '1' || url.searchParams.get('all') === 'true';
        try {
          const tasks = all
            ? [...deps.ctx.storage.loadTasks(id)].sort((a, b) => {
                const at = a.startedAt || a.updatedAt || a.id;
                const bt = b.startedAt || b.updatedAt || b.id;
                return bt.localeCompare(at) || b.id.localeCompare(a.id);
              })
            : deps.ctx.storage.loadOpenTasks(id);
          sendJson(res, 200, { ok: true, tasks });
        } catch (err) {
          console.error('[okbot] http getTasks failed', err);
          sendJson(res, 500, { ok: false, error: 'tasks_failed' });
        }
        return;
      }

      // GET /v1/bots/:id/resources | GET /v1/squads/:id/resources
      if (
        method === 'GET' &&
        parts.length === 4 &&
        parts[0] === 'v1' &&
        (parts[1] === 'bots' || parts[1] === 'squads') &&
        parts[3] === 'resources'
      ) {
        const id = parts[2] || '';
        try {
          const resources = deps.ctx.storage.listOwnerResources(id);
          sendJson(res, 200, { ok: true, resources });
        } catch (err) {
          console.error('[okbot] http listOwnerResources failed', err);
          sendJson(res, 500, { ok: false, error: 'resources_failed' });
        }
        return;
      }

      // POST /v1/bots/:id/uploads | POST /v1/squads/:id/uploads
      // Body: { name, dataBase64, mime? } → ~/.okbot/<ownerId>/uploads/ on the gateway host.
      const isBotUpload =
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'v1' &&
        parts[1] === 'bots' &&
        parts[3] === 'uploads';
      const isSquadUpload =
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'v1' &&
        parts[1] === 'squads' &&
        parts[3] === 'uploads';
      if (isBotUpload || isSquadUpload) {
        const id = parts[2] || '';
        if (!id) {
          sendJson(res, 400, { ok: false, error: 'missing_id' });
          return;
        }
        if (isBotUpload) {
          const bot = deps.ctx.storage.listBots().find((b) => b.id === id);
          if (!bot) {
            sendJson(res, 404, { ok: false, error: 'bot_not_found' });
            return;
          }
        } else {
          const squad = deps.ctx.storage.listSquads().find((s) => s.id === id);
          if (!squad) {
            sendJson(res, 404, { ok: false, error: 'squad_not_found' });
            return;
          }
        }
        let parsed: { name?: unknown; dataBase64?: unknown; mime?: unknown } = {};
        try {
          // Base64 of 25MB ≈ 34MB; leave headroom for JSON wrappers.
          const raw = await readBody(req, 40_000_000);
          parsed = raw.trim() ? (JSON.parse(raw) as typeof parsed) : {};
        } catch (err) {
          if (err instanceof Error && err.message === 'payload_too_large') {
            sendJson(res, 413, { ok: false, error: 'payload_too_large' });
            return;
          }
          sendJson(res, 400, { ok: false, error: 'invalid_json' });
          return;
        }
        const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
        const dataBase64 = typeof parsed.dataBase64 === 'string' ? parsed.dataBase64.trim() : '';
        const mime = typeof parsed.mime === 'string' ? parsed.mime.trim() : '';
        if (!dataBase64) {
          sendJson(res, 400, { ok: false, error: 'missing_data' });
          return;
        }
        let buffer: Buffer;
        try {
          buffer = Buffer.from(dataBase64, 'base64');
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid_base64' });
          return;
        }
        if (!buffer.length) {
          sendJson(res, 400, { ok: false, error: 'empty_upload' });
          return;
        }
        try {
          const saved = deps.ctx.storage.saveOwnerUpload(id, {
            name: name || 'file',
            buffer,
            mime: mime || null,
          });
          sendJson(res, 200, {
            ok: true,
            attachment: {
              kind: saved.kind,
              path: saved.path,
              name: saved.name,
              size: saved.size,
              mediaPath: saved.mediaPath,
              assetRel: saved.assetRel,
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === 'upload_too_large') {
            sendJson(res, 413, { ok: false, error: 'upload_too_large' });
            return;
          }
          if (msg === 'empty_upload') {
            sendJson(res, 400, { ok: false, error: 'empty_upload' });
            return;
          }
          console.error('[okbot] http upload failed', err);
          sendJson(res, 500, { ok: false, error: 'upload_failed' });
        }
        return;
      }

      // GET /v1/computers
      if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'computers') {
        const settings = deps.ctx.storage.getSettings();
        sendJson(res, 200, {
          ok: true,
          computers: [
            { id: 'local', name: 'Local', kind: 'local' },
            ...settings.computers.map((c) => ({
              id: c.id,
              name: c.name,
              host: c.host,
              port: c.port,
              kind: 'remote',
            })),
          ],
        });
        return;
      }

      // GET /v1/usage — same UsageStats shape as Electron getUsageStats.
      if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'usage') {
        const stats = normalizeUsageStats(deps.ctx.storage.getUsageStats());
        sendJson(res, 200, { ok: true, ...stats });
        return;
      }

      // POST /v1/settings — same persist path as Electron saveSettings (gateway Web UI).
      // Super-admin only; access token cannot modify gateway config.
      if (
        method === 'POST' &&
        parts.length === 2 &&
        parts[0] === 'v1' &&
        parts[1] === 'settings'
      ) {
        if (authRole !== 'admin') {
          sendJson(res, 403, { ok: false, error: 'forbidden', reason: 'admin_required' });
          return;
        }
        let parsed: unknown;
        try {
          const raw = await readBody(req);
          parsed = raw.trim() ? JSON.parse(raw) : null;
        } catch (err) {
          if (err instanceof Error && err.message === 'payload_too_large') {
            sendJson(res, 413, { ok: false, error: 'payload_too_large' });
            return;
          }
          sendJson(res, 400, { ok: false, error: 'invalid_json' });
          return;
        }
        const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
        const settings =
          body && body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)
            ? body.settings
            : body;
        if (!settings) {
          sendJson(res, 400, { ok: false, error: 'invalid_settings' });
          return;
        }
        try {
          const current = deps.ctx.storage.getSettings();
          // Admin Bearer only (auth already returned 403 admin_required for access).
          // Apply every non-client gateway-host key; blank secrets carry over from live config.
          const decision = resolveGatewaySettingsWrite(
            current,
            settings as Record<string, unknown>,
          );
          const saved = persistAppSettings(deps.ctx, decision.next, {
            deferListenerRestart: true,
          });
          sendJson(res, 200, { ok: true, settings: projectSettingsForGateway(saved) });
        } catch (err) {
          sendJson(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : 'save_failed',
          });
        }
        return;
      }

      // GET /v1/mcp/status — live MCP hub status (admin: starts/syncs host MCP processes).
      if (method === 'GET' && parts.length === 3 && parts[0] === 'v1' && parts[1] === 'mcp' && parts[2] === 'status') {
        if (authRole !== 'admin') {
          sendJson(res, 403, { ok: false, error: 'forbidden', reason: 'admin_required' });
          return;
        }
        try {
          const servers = await mcpStatus(deps.ctx.storage.getSettings());
          sendJson(res, 200, { ok: true, servers });
        } catch (err) {
          sendJson(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : 'mcp_status_failed',
          });
        }
        return;
      }

      // POST /v1/mcp/test — probe one MCP server entry without saving (admin).
      if (method === 'POST' && parts.length === 3 && parts[0] === 'v1' && parts[1] === 'mcp' && parts[2] === 'test') {
        if (authRole !== 'admin') {
          sendJson(res, 403, { ok: false, error: 'forbidden', reason: 'admin_required' });
          return;
        }
        let parsed: unknown;
        try {
          const raw = await readBody(req);
          parsed = raw.trim() ? JSON.parse(raw) : null;
        } catch (err) {
          if (err instanceof Error && err.message === 'payload_too_large') {
            sendJson(res, 413, { ok: false, error: 'payload_too_large' });
            return;
          }
          sendJson(res, 400, { ok: false, error: 'invalid_json' });
          return;
        }
        const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
        const rawEntry = body && body.server != null ? body.server : parsed;
        const entry = normalizeMcpServerEntry(rawEntry);
        if (!entry) {
          sendJson(res, 400, { ok: false, error: 'incomplete' });
          return;
        }
        try {
          const result = await mcpTest(entry);
          sendJson(res, 200, result);
        } catch (err) {
          sendJson(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : 'mcp_test_failed',
          });
        }
        return;
      }

      // POST /v1/backup/export — zip of gateway host data (admin). Returns application/zip.
      if (
        method === 'POST' &&
        parts.length === 3 &&
        parts[0] === 'v1' &&
        parts[1] === 'backup' &&
        parts[2] === 'export'
      ) {
        if (authRole !== 'admin') {
          sendJson(res, 403, { ok: false, error: 'forbidden', reason: 'admin_required' });
          return;
        }
        if (gatewayDataBusy(deps.ctx)) {
          sendJson(res, 409, { ok: false, error: 'busy' });
          return;
        }
        let excludeSecrets = true;
        try {
          const raw = await readBody(req);
          if (raw.trim()) {
            const parsed = JSON.parse(raw) as { excludeSecrets?: unknown };
            if (parsed && typeof parsed === 'object' && parsed.excludeSecrets === false) {
              excludeSecrets = false;
            }
          }
        } catch (err) {
          if (err instanceof Error && err.message === 'payload_too_large') {
            sendJson(res, 413, { ok: false, error: 'payload_too_large' });
            return;
          }
          sendJson(res, 400, { ok: false, error: 'invalid_json' });
          return;
        }
        if (gatewayDataBusy(deps.ctx)) {
          sendJson(res, 409, { ok: false, error: 'busy' });
          return;
        }
        const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-http-backup-'));
        const outFile = path.join(staging, backupFileName());
        try {
          exportDataBackup(deps.ctx.storage.root, outFile, { excludeSecrets });
          const buf = fs.readFileSync(outFile);
          const name = path.basename(outFile);
          if (res.headersSent || res.writableEnded) return;
          res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Length': String(buf.byteLength),
            'Content-Disposition': `attachment; filename="${name}"`,
            'Cache-Control': 'no-store',
            'X-OkBot-Backup': '1',
          });
          res.end(buf);
        } catch (err) {
          sendJson(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : 'backup_export_failed',
          });
        } finally {
          try {
            fs.rmSync(staging, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
        return;
      }

      // POST /v1/backup/restore — replace gateway host data from zip (admin), then restart host.
      if (
        method === 'POST' &&
        parts.length === 3 &&
        parts[0] === 'v1' &&
        parts[1] === 'backup' &&
        parts[2] === 'restore'
      ) {
        if (authRole !== 'admin') {
          sendJson(res, 403, { ok: false, error: 'forbidden', reason: 'admin_required' });
          return;
        }
        if (gatewayDataBusy(deps.ctx)) {
          sendJson(res, 409, { ok: false, error: 'busy' });
          return;
        }
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        let zipBuf: Buffer | null = null;
        try {
          // Zip archives can be large (same order as chat uploads).
          if (contentType.includes('application/zip') || contentType.includes('application/octet-stream')) {
            zipBuf = await readBodyBuffer(req, 100_000_000);
          } else {
            const raw = await readBody(req, 140_000_000);
            const parsed = raw.trim() ? (JSON.parse(raw) as { dataBase64?: unknown }) : null;
            const b64 = typeof parsed?.dataBase64 === 'string' ? parsed.dataBase64.trim() : '';
            if (!b64) {
              sendJson(res, 400, { ok: false, error: 'missing_data' });
              return;
            }
            zipBuf = Buffer.from(b64, 'base64');
          }
        } catch (err) {
          if (err instanceof Error && err.message === 'payload_too_large') {
            sendJson(res, 413, { ok: false, error: 'payload_too_large' });
            return;
          }
          sendJson(res, 400, { ok: false, error: 'invalid_body' });
          return;
        }
        if (!zipBuf?.length) {
          sendJson(res, 400, { ok: false, error: 'empty_upload' });
          return;
        }
        if (gatewayDataBusy(deps.ctx)) {
          sendJson(res, 409, { ok: false, error: 'busy' });
          return;
        }
        const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-http-restore-'));
        const zipPath = path.join(staging, 'restore.zip');
        try {
          fs.writeFileSync(zipPath, zipBuf);
          const { previousDir } = restoreDataBackup(deps.ctx.storage.root, zipPath);
          sendJson(res, 200, { ok: true, previousDir, restarting: true });
          scheduleHostDataRestored(deps);
        } catch (err) {
          sendJson(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : 'backup_restore_failed',
          });
        } finally {
          try {
            fs.rmSync(staging, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
        return;
      }

      // POST /v1/rpc/:op — bot / squad / memory / skill / model-probe ops (allowlist in gatewayRpc).
      if (method === 'POST' && parts.length === 3 && parts[0] === 'v1' && parts[1] === 'rpc') {
        if (!allowRate()) {
          sendJson(res, 429, { ok: false, error: 'rate_limited' });
          return;
        }
        const rpcOp = parts[2] || '';
        if (isGatewayRpcAdminOp(rpcOp) && authRole !== 'admin') {
          sendJson(res, 403, { ok: false, error: 'forbidden', reason: 'admin_required' });
          return;
        }
        let args: unknown = {};
        try {
          const raw = await readBody(req);
          args = raw.trim() ? JSON.parse(raw) : {};
        } catch (err) {
          if (err instanceof Error && err.message === 'payload_too_large') {
            sendJson(res, 413, { ok: false, error: 'payload_too_large' });
            return;
          }
          sendJson(res, 400, { ok: false, error: 'invalid_json' });
          return;
        }
        const out = await runGatewayRpc(entityOps, rpcOp, args, deps.ctx.storage.getSettings());
        sendJson(res, out.status, out.body);
        return;
      }

      // POST /v1/bots/:id/messages | POST /v1/squads/:id/messages
      const isBotMsg =
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'v1' &&
        parts[1] === 'bots' &&
        parts[3] === 'messages';
      const isSquadMsg =
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'v1' &&
        parts[1] === 'squads' &&
        parts[3] === 'messages';

      if (isBotMsg || isSquadMsg) {
        const id = parts[2] || '';
        if (!id) {
          sendJson(res, 400, { ok: false, error: 'missing_id' });
          return;
        }

        let parsed: JsonBody = {};
        try {
          const raw = await readBody(req);
          parsed = raw.trim() ? (JSON.parse(raw) as JsonBody) : {};
        } catch (err) {
          if (err instanceof Error && err.message === 'payload_too_large') {
            sendJson(res, 413, { ok: false, error: 'payload_too_large' });
            return;
          }
          sendJson(res, 400, { ok: false, error: 'invalid_json' });
          return;
        }

        const normalized = normalizeChatStartPayload(parsed);
        if ('error' in normalized) {
          sendJson(res, 400, { ok: false, error: normalized.error });
          return;
        }
        const text = normalized.text;
        if (text.length > MAX_CHAT_TEXT_CHARS) {
          sendJson(res, 413, { ok: false, error: 'text_too_long' });
          return;
        }
        if (!allowRate()) {
          sendJson(res, 429, { ok: false, error: 'rate_limited' });
          return;
        }

        // Per-token quotas (0 = unlimited). Checked before starting the turn.
        if (authTokenId && authMatch?.entry) {
          const snap = deps.ctx.storage.getApiTokenQuotaSnapshot(authTokenId);
          const gate = checkGatewayApiTokenQuota({
            limits: authMatch.entry.limits,
            ...snap,
            pendingMessages: 1,
          });
          if (!gate.ok) {
            sendJson(res, 429, {
              ok: false,
              error: 'quota_exceeded',
              reason: gate.reason,
            });
            return;
          }
        }

        const computerId = normalized.computerId;
        const clientTurnId = normalized.clientTurnId;
        const quoteMessageId = normalized.quoteMessageId;
        const attachments = normalizeMessageAttachments(parsed.attachments);

        if (isBotMsg) {
          const bot = deps.ctx.storage.listBots().find((b) => b.id === id);
          if (!bot) {
            sendJson(res, 404, { ok: false, error: 'bot_not_found' });
            return;
          }
        } else {
          const squad = deps.ctx.storage.listSquads().find((s) => s.id === id);
          if (!squad) {
            sendJson(res, 404, { ok: false, error: 'squad_not_found' });
            return;
          }
        }

        const sessionId = id;
        const apiTokenFields = authTokenId ? { apiTokenId: authTokenId } : {};
        const payload = isBotMsg
          ? {
              botId: id,
              text,
              computerId,
              origin: 'api' as const,
              ...apiTokenFields,
              ...(clientTurnId ? { clientTurnId } : {}),
              ...(quoteMessageId ? { quoteMessageId } : {}),
              ...(attachments ? { attachments } : {}),
            }
          : {
              squadId: id,
              text,
              computerId,
              origin: 'api' as const,
              ...apiTokenFields,
              ...(clientTurnId ? { clientTurnId } : {}),
              ...(quoteMessageId ? { quoteMessageId } : {}),
              ...(attachments ? { attachments } : {}),
            };

        // SSE: Accept: text/event-stream → stream RuntimeEvent for this session until done/error.
        if (wantsSse(req)) {
          openSse(res);

          let closed = false;
          const finish = () => {
            if (closed) return;
            closed = true;
            openSseFinishes.delete(finish);
            unsubscribe();
            req.off('close', onClientClose);
            try {
              if (!res.writableEnded && !res.destroyed) {
                try {
                  res.write(': shutdown\n\n');
                } catch {
                  /* ignore */
                }
                res.end();
              }
            } catch {
              /* ignore */
            }
          };
          openSseFinishes.add(finish);

          const sseGate = { runId: null as string | null, ...(clientTurnId ? { clientTurnId } : {}) };
          const onChat = (event: RuntimeEvent) => {
            if (closed) return;
            if (!('botId' in event) || event.botId !== sessionId) return;
            // Bind on turn_started / runId; ignore sibling parallel turns.
            if (!acceptRuntimeEventForSseTurn(sseGate, event)) return;
            if (!writeSseEvent(res, event)) {
              finish();
              return;
            }
            // Do not finish() on done/error here: a parallel sibling terminal
            // must not close this SSE. startChatTurn finally ends the stream.
          };

          const unsubscribe = subscribeRuntimeEvent(onChat);
          const onClientClose = () => {
            // Stop writing only; chat turn continues for the UI / persistence.
            if (closed) return;
            closed = true;
            unsubscribe();
          };
          req.on('close', onClientClose);

          try {
            await startChatTurn(deps.ctx, payload);
          } catch (err) {
            console.error('[okbot] gatewayHttpApi SSE chat turn failed', err);
            if (!closed) {
              const message = err instanceof Error ? err.message : String(err);
              writeSseEvent(res, {
                type: 'error',
                botId: sessionId,
                messageId: '',
                error: message,
              });
            }
          } finally {
            // Always end the stream when this turn startChatTurn settles.
            finish();
          }
          return;
        }

        // Default: async 202 — same startChatTurn path as UI IPC; persistence + chat events update UI live.
        void startChatTurn(deps.ctx, payload).catch((err) => {
          console.error('[okbot] gatewayHttpApi chat turn failed', err);
        });

        sendJson(res, 202, { ok: true, sessionId });
        return;
      }

      // POST /v1/tool-respond — same decision path as the desktop approval card.
      if (method === 'POST' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'tool-respond') {
        if (!allowRate()) {
          sendJson(res, 429, { ok: false, error: 'rate_limited' });
          return;
        }
        let parsed: JsonBody = {};
        try {
          const raw = await readBody(req);
          parsed = raw.trim() ? (JSON.parse(raw) as JsonBody) : {};
        } catch (err) {
          if (err instanceof Error && err.message === 'payload_too_large') {
            sendJson(res, 413, { ok: false, error: 'payload_too_large' });
            return;
          }
          sendJson(res, 400, { ok: false, error: 'invalid_json' });
          return;
        }
        const requestId = typeof parsed.requestId === 'string' ? parsed.requestId.trim() : '';
        const approved = parsed.approved === true;
        const message = typeof parsed.message === 'string' ? parsed.message : undefined;
        const result = await respondToToolApproval(deps.ctx, { requestId, approved, message });
        sendJson(res, result.ok ? 200 : 409, result);
        return;
      }

      // GET /v1/approvals — live + cold pending tool requests.
      if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'approvals') {
        const snap = deps.ctx.snapshotActiveRuns();
        sendJson(res, 200, { ok: true, ...snap });
        return;
      }

      // POST /v1/bots/:id/abort | POST /v1/squads/:id/abort
      const isAbort =
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'v1' &&
        (parts[1] === 'bots' || parts[1] === 'squads') &&
        parts[3] === 'abort';
      if (isAbort) {
        const id = parts[2] || '';
        if (parts[1] === 'bots') {
          const bot = deps.ctx.storage.listBots().find((b) => b.id === id);
          if (!bot) {
            sendJson(res, 404, { ok: false, error: 'bot_not_found' });
            return;
          }
        } else {
          const squad = deps.ctx.storage.listSquads().find((s) => s.id === id);
          if (!squad) {
            sendJson(res, 404, { ok: false, error: 'squad_not_found' });
            return;
          }
        }
        abortChatOwner(deps.ctx, id);
        sendJson(res, 200, { ok: true, sessionId: id });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      console.error('[okbot] gatewayHttpApi request failed', err);
      sendJson(res, 500, { ok: false, error: 'internal_error' });
    }
  };

  const start = (port: number, token: string, adminToken: string, lan: boolean, ui: boolean): Promise<void> => {
    return stopSync().then(() => {
    currentToken = token;
    currentAdminToken = adminToken;
    bindLan = lan;
    serveUi = ui;
    const host = lan ? LAN_HOST : LOOPBACK_HOST;
    return new Promise<void>((resolve, reject) => {
      const s = http.createServer((req, res) => {
        // Any throw in a route (bad body, oversize login form, storage error) must not
        // become an unhandled rejection: that ends `okbot serve`.
        handle(req, res).catch((err: unknown) => {
          const tooLarge = err instanceof Error && err.message === 'payload_too_large';
          if (!tooLarge) console.error('[okbot] gatewayHttpApi request failed', err);
          sendJson(res, tooLarge ? 413 : 500, { ok: false, error: tooLarge ? 'payload_too_large' : 'internal_error' });
        });
      });
      s.on('connection', (sock) => {
        sockets.add(sock);
        sock.on('close', () => sockets.delete(sock));
      });
      s.on('error', (err) => {
        console.error('[okbot] gatewayHttpApi listen error', err);
        if (server === s) {
          server = null;
          listeningPort = null;
        }
        reject(err);
      });
      s.listen(port, host, () => {
        server = s;
        listeningPort = port;
        console.info(
          `[okbot] gateway listening on http://${host}:${port}` +
            (lan ? ' (LAN gateway)' : '') +
            (ui ? ' (UI)' : ''),
        );
        resolve();
      });
    });
    });
  };

  const listen = (settings: GatewayHttpApiListenSettings): Promise<void> => {
    const port = settings.port;
    const token = settings.token;
    const adminToken = settings.adminToken || '';
    const lan = settings.bindLan === true;
    const ui = settings.serveUi === true;
    if (!token) return Promise.reject(new Error('missing_token'));
    if (
      server &&
      listeningPort === port &&
      currentToken === token &&
      currentAdminToken === adminToken &&
      bindLan === lan &&
      serveUi === ui
    ) {
      return Promise.resolve();
    }
    // Coalesce concurrent listen/sync so stopSync in start() cannot kill an in-flight bind
    // before its "gateway listening" log fires.
    if (starting) {
      return starting.then(() => listen(settings));
    }
    const run = start(port, token, adminToken, lan, ui);
    starting = run;
    return run.finally(() => {
      if (starting === run) starting = null;
    });
  };

  return {
    sync(settings: GatewayHttpApiListenSettings) {
      // HTTP API is always-on when the gateway owns the process; ignore enabled.
      void listen(settings).catch((err) => {
        console.error('[okbot] gatewayHttpApi failed to start', err);
      });
    },
    listen,
    stop() {
      void stopSync();
      currentToken = '';
      currentAdminToken = '';
      starting = null;
      runtimeListeners.clear();
    },
    bridgeRuntimeEvent(event: RuntimeEvent) {
      const sinks = runtimeEventSinks(event);
      for (const sink of sinks) {
        const listeners = sink === 'sessions' ? sessionListeners : runtimeListeners;
        for (const listener of [...listeners]) {
          try {
            listener(event);
          } catch (err) {
            console.error('[okbot] gatewayHttpApi chat listener failed', err);
          }
        }
      }
    },
  };
}
