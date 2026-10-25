import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './storage/FileStorage';
import { createGatewayHttpApi } from './gatewayHttpApi';
import type { IpcContext } from './ipc/context';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-media-'));
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

const TOKEN = 'tok-media-test';
await api.listen({ enabled: true, port, token: TOKEN, adminToken: '', bindLan: false, serveUi: false });
const base = `http://127.0.0.1:${port}`;

const ownerId = 'bot_media_1';
const resourcesDir = path.join(storage.dataRoot, ownerId, 'resources');
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

  // Stale cookie must not shadow a fresh ?token= (regenerate / re-login race).
  const staleCookieWins = await fetch(
    `${base}/v1/media/${encodeURIComponent(ownerId)}/resources/${encodeURIComponent(fileName)}?token=${encodeURIComponent(TOKEN)}`,
    { headers: { Cookie: 'okbot_gateway_token=stale-wrong-token' } },
  );
  assert.equal(staleCookieWins.status, 200, 'query token must beat stale cookie');

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

  // POST uploads → ~/.okbot/data/<owner>/uploads/ then GET /v1/media/…/uploads/…
  const bot = storage.createBot({ name: 'UploadBot' });
  const uploadPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const uploadRes = await fetch(`${base}/v1/bots/${encodeURIComponent(bot.id)}/uploads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'clip.png',
      mime: 'image/png',
      dataBase64: uploadPng.toString('base64'),
    }),
  });
  const uploadRaw = await uploadRes.text();
  assert.equal(uploadRes.status, 200, uploadRaw);
  const uploadJson = JSON.parse(uploadRaw) as {
    ok: boolean;
    attachment: { kind: string; path: string; name: string; size: number; mediaPath: string; assetRel: string };
  };
  assert.equal(uploadJson.ok, true);
  assert.equal(uploadJson.attachment.kind, 'image');
  assert.equal(uploadJson.attachment.name, 'clip.png');
  assert.equal(uploadJson.attachment.size, uploadPng.length);
  assert.match(uploadJson.attachment.mediaPath, /\/v1\/media\/.+\/uploads\//);
  assert.equal(fs.existsSync(uploadJson.attachment.path), true);
  assert.match(uploadJson.attachment.path.replace(/\\/g, '/'), /\/uploads\//);

  const uploadGet = await fetch(
    `${base}${uploadJson.attachment.mediaPath}?token=${encodeURIComponent(TOKEN)}`,
  );
  assert.equal(uploadGet.status, 200);
  assert.equal(uploadGet.headers.get('content-type'), 'image/png');
  const uploadBody = Buffer.from(await uploadGet.arrayBuffer());
  assert.equal(uploadBody.equals(uploadPng), true);

  const uploadUnauth = await fetch(`${base}${uploadJson.attachment.mediaPath}`);
  assert.equal(uploadUnauth.status, 401);
} finally {
  api.stop();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('gatewayHttpApi.media.test.ts: ok');
process.exit(0);
