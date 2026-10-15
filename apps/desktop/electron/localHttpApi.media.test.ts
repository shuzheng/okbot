import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './storage/FileStorage';
import { createLocalHttpApi } from './localHttpApi';
import type { IpcContext } from './ipc/context';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-media-'));
const storage = new FileStorage(root);
const ctx = { storage, abortControllers: new Map(), pendingToolApprovals: new Map() } as unknown as IpcContext;
const api = createLocalHttpApi({ ctx });

const port = await new Promise<number>((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => resolve(p));
  });
});

const TOKEN = 'tok-media-test';
await api.listen({ enabled: true, port, token: TOKEN, bindLan: false, serveUi: false });
const base = `http://127.0.0.1:${port}`;

const ownerId = 'bot_media_1';
const resourcesDir = path.join(root, ownerId, 'resources');
fs.mkdirSync(resourcesDir, { recursive: true });
const fileName = 'bee-honey.png';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
fs.writeFileSync(path.join(resourcesDir, fileName), png);

try {
  const unauth = await fetch(`${base}/v1/media/${ownerId}/resources/${fileName}`);
  assert.equal(unauth.status, 401);

  const byQuery = await fetch(
    `${base}/v1/media/${encodeURIComponent(ownerId)}/resources/${encodeURIComponent(fileName)}?token=${encodeURIComponent(TOKEN)}`,
  );
  assert.equal(byQuery.status, 200);
  assert.equal(byQuery.headers.get('content-type'), 'image/png');
  const body = Buffer.from(await byQuery.arrayBuffer());
  assert.equal(body.equals(png), true);

  const byBearer = await fetch(`${base}/v1/media/${ownerId}/resources/${fileName}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(byBearer.status, 200);

  const missing = await fetch(
    `${base}/v1/media/${ownerId}/resources/nope.png?token=${encodeURIComponent(TOKEN)}`,
  );
  assert.equal(missing.status, 404);

  // Encoded slash becomes extra path segments (no media match → 401) or stays one segment with ".."
  const traversalSlash = await fetch(
    `${base}/v1/media/${ownerId}/resources/${encodeURIComponent('../settings.json')}?token=${encodeURIComponent(TOKEN)}`,
  );
  assert.ok([400, 401, 404].includes(traversalSlash.status), String(traversalSlash.status));

  const traversalDots = await fetch(
    `${base}/v1/media/${ownerId}/resources/${encodeURIComponent('..settings.json')}?token=${encodeURIComponent(TOKEN)}`,
  );
  assert.equal(traversalDots.status, 400);
} finally {
  api.stop();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('localHttpApi.media.test.ts: ok');
process.exit(0);
