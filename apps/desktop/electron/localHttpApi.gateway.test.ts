import assert from 'node:assert/strict';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Lightweight mirror of token extract + auth gate used by gateway (keeps test free of Electron).
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

const TOKEN = 'gateway-test-token';
const server = http.createServer((req, res) => {
  const parts = (req.url || '/').split('?')[0].split('/').filter(Boolean);
  if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (extractToken(req) !== TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, path: req.url }));
});

await new Promise<void>((resolve, reject) => {
  server.listen(0, '127.0.0.1', () => resolve());
  server.once('error', reject);
});
const addr = server.address();
if (!addr || typeof addr === 'string') throw new Error('no addr');
const base = `http://127.0.0.1:${addr.port}`;

const health = await fetch(`${base}/v1/health`);
assert.equal(health.status, 200);

const unauth = await fetch(`${base}/v1/bots`);
assert.equal(unauth.status, 401);

const auth = await fetch(`${base}/v1/bots`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
});
assert.equal(auth.status, 200);

const auth2 = await fetch(`${base}/v1/bots`, {
  headers: { 'X-OkBot-Token': TOKEN },
});
assert.equal(auth2.status, 200);

await new Promise<void>((r) => server.close(() => r()));
console.log('localHttpApi.gateway.test.ts: ok');
