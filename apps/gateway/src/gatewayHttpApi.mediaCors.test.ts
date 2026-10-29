import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './storage/FileStorage';
import { createGatewayHttpApi, resolveMediaCorsAllowOrigin } from './gatewayHttpApi';
import type { IpcContext } from './ipc/context';

// --- pure: startsWith localhost must NOT allow evil subdomain ---
assert.equal(
  resolveMediaCorsAllowOrigin('http://localhost.attacker.com', 'http://127.0.0.1:18765', '127.0.0.1:18765'),
  undefined,
  'evil subdomain must NOT echo ACAO',
);
assert.equal(
  resolveMediaCorsAllowOrigin('https://localhost.evil.example', 'http://127.0.0.1:18765', '127.0.0.1:18765'),
  undefined,
);
assert.equal(
  resolveMediaCorsAllowOrigin('http://127.0.0.1.attacker.com', 'http://127.0.0.1:18765', '127.0.0.1:18765'),
  undefined,
);
assert.equal(
  resolveMediaCorsAllowOrigin('http://localhost', 'http://127.0.0.1:18765', '127.0.0.1:18765'),
  'http://localhost',
);
assert.equal(
  resolveMediaCorsAllowOrigin('http://localhost:5173', 'http://127.0.0.1:18765', '127.0.0.1:18765'),
  'http://localhost:5173',
);
assert.equal(
  resolveMediaCorsAllowOrigin('http://127.0.0.1:5173', 'http://127.0.0.1:18765', '127.0.0.1:18765'),
  'http://127.0.0.1:5173',
);
assert.equal(
  resolveMediaCorsAllowOrigin('http://[::1]:5173', 'http://127.0.0.1:18765', '127.0.0.1:18765'),
  'http://[::1]:5173',
);
assert.equal(
  resolveMediaCorsAllowOrigin('http://127.0.0.1:18765', 'http://127.0.0.1:18765', '127.0.0.1:18765'),
  'http://127.0.0.1:18765',
);
assert.equal(
  resolveMediaCorsAllowOrigin('https://gw.example:443', 'https://gw.example:443', 'gw.example:443'),
  'https://gw.example:443',
);
assert.equal(
  resolveMediaCorsAllowOrigin('https://evil.example', 'http://127.0.0.1:18765', '127.0.0.1:18765'),
  undefined,
  'foreign origin must omit ACAO (not fall back to gatewayOrigin)',
);
assert.equal(
  resolveMediaCorsAllowOrigin('', 'http://127.0.0.1:18765', '127.0.0.1:18765'),
  undefined,
);

// --- integration: bindLan media GET must not echo ACAO for evil Origin ---
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-media-cors-'));
const storage = new FileStorage(root);
const ctx = { storage, abortControllers: new Map(), pendingToolApprovals: new Map() } as unknown as IpcContext;
const api = createGatewayHttpApi({ ctx });

const port = await new Promise<number>((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => resolve(p));
  });
});

const TOKEN = 'tok-media-cors';
await api.listen({ enabled: true, port, token: TOKEN, adminToken: '', bindLan: true, serveUi: false });
const base = `http://127.0.0.1:${port}`;

const ownerId = 'bot_media_cors';
const resourcesDir = path.join(storage.dataRoot, ownerId, 'resources');
fs.mkdirSync(resourcesDir, { recursive: true });
const fileName = 'pix.png';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
fs.writeFileSync(path.join(resourcesDir, fileName), png);

try {
  const url = `${base}/v1/media/${encodeURIComponent(ownerId)}/resources/${encodeURIComponent(fileName)}?token=${encodeURIComponent(TOKEN)}`;

  const evil = await fetch(url, { headers: { Origin: 'http://localhost.attacker.com' } });
  assert.equal(evil.status, 200);
  assert.equal(evil.headers.get('access-control-allow-origin'), null, 'evil subdomain must NOT echo ACAO');

  const foreign = await fetch(url, { headers: { Origin: 'https://evil.example' } });
  assert.equal(foreign.status, 200);
  assert.equal(foreign.headers.get('access-control-allow-origin'), null, 'foreign Origin must omit ACAO');

  const local = await fetch(url, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(local.status, 200);
  assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5173');

  const loop = await fetch(url, { headers: { Origin: 'http://127.0.0.1:5173' } });
  assert.equal(loop.status, 200);
  assert.equal(loop.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
} finally {
  api.stop();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('gatewayHttpApi.mediaCors.test.ts: ok');
process.exit(0);
