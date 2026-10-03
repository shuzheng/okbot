import type { IncomingMessage, ServerResponse } from 'node:http';

export function readBody(req: IncomingMessage, limit = 2_000_000): Promise<string> {
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

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.writableEnded) return;
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(raw),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-OkBot-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(raw);
}

export function matchPath(url: string): { pathname: string; parts: string[] } {
  let pathname = url.split('?')[0] || '/';
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    /* keep raw */
  }
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  return { pathname, parts };
}

export function wantsSse(req: IncomingMessage): boolean {
  const raw = req.headers.accept;
  const accept = Array.isArray(raw) ? raw.join(',') : raw || '';
  return accept.includes('text/event-stream');
}

export function openSse(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  if (typeof (res as ServerResponse & { flushHeaders?: () => void }).flushHeaders === 'function') {
    (res as ServerResponse & { flushHeaders: () => void }).flushHeaders();
  }
  try {
    res.write(': connected\n\n');
  } catch {
    /* ignore */
  }
}

export function writeSse(res: ServerResponse, event: string, data: unknown): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    return res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    return false;
  }
}
