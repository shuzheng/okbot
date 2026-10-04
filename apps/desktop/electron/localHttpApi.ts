import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeUsageStats, type AppSettings, type RuntimeEvent, type LocalHttpApiSettings } from '@okbot/shared';
import { acceptRuntimeEventForSseTurn, encodeRuntimeEventSse, isRuntimeEventTurnTerminal } from '@okbot/agent';
import type { IpcContext } from './ipc/context';
import { abortChatOwner } from './ipc/chatControl';
import { gatewayBootJs, gatewayLoginHtml, injectGatewayBoot, shouldServeGatewayLogin } from './gatewayLoginPage';
import { runtimeEventChannel } from './sessionEvents';
import { respondToToolApproval, startChatTurn } from './ipc/registerChat';
import { persistAppSettings } from './ipc/registerEntity';
import { parseMessagesLimit, resolveGatewaySettingsWrite } from './gatewaySettingsWrite';

const LOOPBACK_HOST = '127.0.0.1';
const LAN_HOST = '0.0.0.0';

type LocalHttpApiDeps = {
  ctx: IpcContext;
  /** Absolute path to renderer build (electron-vite out/renderer). Optional. */
  uiRoot?: string | null;
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
    localHttpApi: { ...settings.localHttpApi, token: '' },
    computers: Array.isArray(settings.computers)
      ? settings.computers.map((computer) => ({ ...computer, token: '' }))
      : [],
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

function extractToken(req: IncomingMessage): string {
  const x = req.headers['x-okbot-token'];
  if (typeof x === 'string' && x.trim()) return x.trim();
  if (Array.isArray(x) && x[0]) return String(x[0]).trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m?.[1]) return m[1].trim();
  }
  return cookieGatewayToken(req);
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
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return name === '127.0.0.1' || name === 'localhost' || name === '::1';
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

function requestGatewayAuthed(req: IncomingMessage, urlObj: URL, token: string): boolean {
  if (!token) return false;
  const header = extractToken(req);
  if (header && header === token) return true;
  const qToken = (urlObj.searchParams.get('token') || '').trim();
  if (qToken && qToken === token) return true;
  const cookie = cookieGatewayToken(req);
  return Boolean(cookie && cookie === token);
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
export function createLocalHttpApi(deps: LocalHttpApiDeps): {
  sync: (settings: LocalHttpApiSettings) => void;
  /**
   * Bind using port / token / bindLan / serveUi even when the desktop switch is off.
   * `okbot serve` and an Electron launch that owns the gateway both use this.
   * Rejects if the port cannot be bound (for example EADDRINUSE).
   */
  listen: (settings: LocalHttpApiSettings) => Promise<void>;
  stop: () => void;
  /** Fan-in from main sendRuntimeEvent → active SSE subscribers. */
  bridgeRuntimeEvent: (event: RuntimeEvent) => void;
} {
  let server: http.Server | null = null;
  let listeningPort: number | null = null;
  let currentToken = '';
  let bindLan = false;
  let serveUi = false;
  let starting: Promise<void> | null = null;
  const runtimeListeners = new Set<RuntimeEventListener>();
  /** Long-lived GET /v1/events subscribers (session list only). */
  const sessionListeners = new Set<RuntimeEventListener>();
  const sessionPings = new Set<ReturnType<typeof setInterval>>();
  const sockets = new Set<Socket>();
  const rateHits: number[] = [];

  const subscribeRuntimeEvent = (listener: RuntimeEventListener): (() => void) => {
    runtimeListeners.add(listener);
    return () => {
      runtimeListeners.delete(listener);
    };
  };

  const stopSync = () => {
    runtimeListeners.clear();
    sessionListeners.clear();
    for (const ping of sessionPings) clearInterval(ping);
    sessionPings.clear();
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
      console.error('[okbot] localHttpApi close failed', err);
    }
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

    // Browser GET of the gateway URL shows the token form. /v1 stays JSON.
    if (method === 'GET') {
      const entryUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const entryPath = entryUrl.pathname || '/';
      if (shouldServeGatewayLogin(method, entryPath, requestGatewayAuthed(req, entryUrl, currentToken))) {
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
      const headerToken = extractToken(req);
      const cookieHeader = String(req.headers.cookie || '');
      const cookieToken = (() => {
        const m = /(?:^|;\s*)okbot_gateway_token=([^;]+)/.exec(cookieHeader);
        if (!m?.[1]) return '';
        try {
          return decodeURIComponent(m[1].trim());
        } catch {
          return m[1].trim();
        }
      })();
      const okAuth =
        (headerToken && headerToken === currentToken) ||
        (qToken && qToken === currentToken) ||
        (cookieToken && cookieToken === currentToken) ||
        false;
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
        if (qToken && qToken === currentToken) {
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

    const token = extractToken(req);
    if (!currentToken || token !== currentToken) {
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
      // GET /v1/events — stay open and forward sessions_changed (not chat deltas).
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
          sessionListeners.delete(onSession);
          clearInterval(ping);
          sessionPings.delete(ping);
          req.off('close', onClientClose);
          try {
            if (!res.writableEnded) res.end();
          } catch {
            /* ignore */
          }
        };
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

      // GET /v1/gateway-token — the credential this process is checking.
      // Bootstrap and settings responses keep the token blank. This route is the
      // only JSON that returns it, and only after the auth gate above.
      if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'gateway-token') {
        sendJson(res, 200, { ok: true, token: currentToken });
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
      if (
        method === 'POST' &&
        parts.length === 2 &&
        parts[0] === 'v1' &&
        parts[1] === 'settings'
      ) {
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
          const decision = resolveGatewaySettingsWrite(current, settings as Record<string, unknown>);
          if (!decision.ok) {
            sendJson(res, 409, {
              ok: false,
              error: 'settings_not_allowed',
              rejectedKeys: decision.rejectedKeys,
            });
            return;
          }
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

        const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
        if (!text) {
          sendJson(res, 400, { ok: false, error: 'text_required' });
          return;
        }
        if (text.length > MAX_CHAT_TEXT_CHARS) {
          sendJson(res, 413, { ok: false, error: 'text_too_long' });
          return;
        }
        if (!allowRate()) {
          sendJson(res, 429, { ok: false, error: 'rate_limited' });
          return;
        }
        const computerId =
          typeof parsed.computerId === 'string' && parsed.computerId.trim()
            ? parsed.computerId.trim()
            : undefined;

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
        const payload = isBotMsg
          ? { botId: id, text, computerId }
          : { squadId: id, text, computerId };

        // SSE: Accept: text/event-stream → stream RuntimeEvent for this session until done/error.
        if (wantsSse(req)) {
          openSse(res);

          let closed = false;
          const finish = () => {
            if (closed) return;
            closed = true;
            unsubscribe();
            req.off('close', onClientClose);
            try {
              if (!res.writableEnded) res.end();
            } catch {
              /* ignore */
            }
          };

          const sseGate = { seenUserMessage: false };
          const onChat = (event: RuntimeEvent) => {
            if (closed || event.botId !== sessionId) return;
            // Previous steer's aborted done arrives before this turn's user_message.
            if (!acceptRuntimeEventForSseTurn(sseGate, event)) return;
            if (!writeSseEvent(res, event)) {
              finish();
              return;
            }
            if (isRuntimeEventTurnTerminal(event)) {
              finish();
            }
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
            console.error('[okbot] localHttpApi SSE chat turn failed', err);
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
            // Superseded steers may omit done/error — still end the stream.
            finish();
          }
          return;
        }

        // Default: async 202 — same startChatTurn path as UI IPC; persistence + chat events update UI live.
        void startChatTurn(deps.ctx, payload).catch((err) => {
          console.error('[okbot] localHttpApi chat turn failed', err);
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
      console.error('[okbot] localHttpApi request failed', err);
      sendJson(res, 500, { ok: false, error: 'internal_error' });
    }
  };

  const start = (port: number, token: string, lan: boolean, ui: boolean): Promise<void> => {
    stopSync();
    currentToken = token;
    bindLan = lan;
    serveUi = ui;
    const host = lan ? LAN_HOST : LOOPBACK_HOST;
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        void handle(req, res);
      });
      s.on('connection', (sock) => {
        sockets.add(sock);
        sock.on('close', () => sockets.delete(sock));
      });
      s.on('error', (err) => {
        console.error('[okbot] localHttpApi listen error', err);
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
          `[okbot] localHttpApi listening on http://${host}:${port}` +
            (lan ? ' (LAN gateway)' : '') +
            (ui ? ' (UI)' : ''),
        );
        resolve();
      });
    });
  };

  const listen = (settings: LocalHttpApiSettings): Promise<void> => {
    const port = settings.port;
    const token = settings.token;
    const lan = settings.bindLan === true;
    const ui = settings.serveUi === true;
    if (!token) return Promise.reject(new Error('missing_token'));
    if (server && listeningPort === port && currentToken === token && bindLan === lan && serveUi === ui) {
      return Promise.resolve();
    }
    const run = start(port, token, lan, ui);
    starting = run;
    return run.finally(() => {
      if (starting === run) starting = null;
    });
  };

  return {
    sync(settings: LocalHttpApiSettings) {
      if (!settings.enabled) {
        if (server) console.info('[okbot] localHttpApi stopped');
        stopSync();
        currentToken = '';
        bindLan = false;
        serveUi = false;
        starting = null;
        return;
      }
      void listen(settings).catch((err) => {
        console.error('[okbot] localHttpApi failed to start', err);
      });
    },
    listen,
    stop() {
      stopSync();
      currentToken = '';
      starting = null;
      runtimeListeners.clear();
    },
    bridgeRuntimeEvent(event: RuntimeEvent) {
      const listeners =
        runtimeEventChannel(event) === 'sessions' ? sessionListeners : runtimeListeners;
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (err) {
          console.error('[okbot] localHttpApi chat listener failed', err);
        }
      }
    },
  };
}
