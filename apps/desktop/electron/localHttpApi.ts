import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChatEvent, LocalHttpApiSettings } from '@okbot/shared';
import type { IpcContext } from './ipc/context';
import { startChatTurn } from './ipc/registerChat';

const HOST = '127.0.0.1';

type LocalHttpApiDeps = {
  ctx: IpcContext;
};

type JsonBody = Record<string, unknown>;

type ChatEventListener = (event: ChatEvent) => void;

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
  return '';
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

function writeSseEvent(res: ServerResponse, event: ChatEvent): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    return res.write(payload);
  } catch {
    return false;
  }
}

function openSse(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Flush so proxies/clients see headers before the first ChatEvent.
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
  stop: () => void;
  /** Fan-in from main sendChatEvent → active SSE subscribers. */
  bridgeChatEvent: (event: ChatEvent) => void;
} {
  let server: http.Server | null = null;
  let listeningPort: number | null = null;
  let currentToken = '';
  let starting: Promise<void> | null = null;
  const chatListeners = new Set<ChatEventListener>();

  const subscribeChatEvent = (listener: ChatEventListener): (() => void) => {
    chatListeners.add(listener);
    return () => {
      chatListeners.delete(listener);
    };
  };

  const stopSync = () => {
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

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const method = (req.method || 'GET').toUpperCase();
    const { parts } = matchPath(req.url || '/');

    // CORS not needed for curl/scripts; reject non-loopback defensively.
    const remote = req.socket.remoteAddress || '';
    if (remote && remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      sendJson(res, 403, { ok: false, error: 'forbidden' });
      return;
    }

    // GET /v1/health — no auth (existence only; no secrets).
    if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'health') {
      sendJson(res, 200, { ok: true, service: 'okbot-local-http-api' });
      return;
    }

    const token = extractToken(req);
    if (!currentToken || token !== currentToken) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    try {
      // GET /v1/bots
      if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'bots') {
        const bots = deps.ctx.storage.listBots().map((b) => ({ id: b.id, name: b.name }));
        sendJson(res, 200, { ok: true, bots });
        return;
      }

      // GET /v1/squads
      if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'squads') {
        const squads = deps.ctx.storage.listSquads().map((s) => ({ id: s.id, name: s.name }));
        sendJson(res, 200, { ok: true, squads });
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
        const payload = isBotMsg ? { botId: id, text } : { squadId: id, text };

        // SSE: Accept: text/event-stream → stream ChatEvent for this session until done/error.
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

          const onChat = (event: ChatEvent) => {
            if (closed || event.botId !== sessionId) return;
            if (!writeSseEvent(res, event)) {
              finish();
              return;
            }
            if (event.type === 'done' || event.type === 'error') {
              finish();
            }
          };

          const unsubscribe = subscribeChatEvent(onChat);
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

      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      console.error('[okbot] localHttpApi request failed', err);
      sendJson(res, 500, { ok: false, error: 'internal_error' });
    }
  };

  const start = (port: number, token: string): Promise<void> => {
    stopSync();
    currentToken = token;
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        void handle(req, res);
      });
      s.on('error', (err) => {
        console.error('[okbot] localHttpApi listen error', err);
        if (server === s) {
          server = null;
          listeningPort = null;
        }
        reject(err);
      });
      s.listen(port, HOST, () => {
        server = s;
        listeningPort = port;
        console.info(`[okbot] localHttpApi listening on http://${HOST}:${port}`);
        resolve();
      });
    });
  };

  return {
    sync(settings: LocalHttpApiSettings) {
      if (!settings.enabled) {
        if (server) console.info('[okbot] localHttpApi stopped');
        stopSync();
        currentToken = '';
        starting = null;
        return;
      }
      const port = settings.port;
      const token = settings.token;
      if (server && listeningPort === port && currentToken === token) {
        return;
      }
      const run = start(port, token).catch((err) => {
        console.error('[okbot] localHttpApi failed to start', err);
      });
      starting = run;
      void run.finally(() => {
        if (starting === run) starting = null;
      });
    },
    stop() {
      stopSync();
      currentToken = '';
      starting = null;
      chatListeners.clear();
    },
    bridgeChatEvent(event: ChatEvent) {
      for (const listener of [...chatListeners]) {
        try {
          listener(event);
        } catch (err) {
          console.error('[okbot] localHttpApi chat listener failed', err);
        }
      }
    },
  };
}
