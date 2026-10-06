import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { AppSettings } from '@okbot/shared';
import { FileStorage } from './storage';
import { createLocalHttpApi } from './localHttpApi';
import type { IpcContext } from './ipc/context';
import { resolveProbeApiKey } from './modelProbe';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-rpc-'));
const storage = new FileStorage(root);
const ctx: IpcContext = {
  storage,
  abortControllers: new Map(),
  pendingToolApprovals: new Map(),
  hardwareAccelerationActive: true,
  sendRuntimeEvent: () => {},
  snapshotActiveRuns: () => ({ busyBotIds: [], pendingToolRequests: [] }),
  rejectPendingApprovalsForBot: () => {},
  applyTheme: () => {},
};

const port = await new Promise<number>((resolve) => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1', () => {
    const addr = probe.address();
    const p = typeof addr === 'object' && addr ? addr.port : 0;
    probe.close(() => resolve(p));
  });
});
const TOKEN = 'rpc-test-token-1234567890';
const api = createLocalHttpApi({ ctx });
await api.listen({ enabled: true, port, token: TOKEN, bindLan: false, serveUi: false });
const base = `http://127.0.0.1:${port}`;

async function rpc(op: string, args: unknown, token = TOKEN) {
  const res = await fetch(`${base}/v1/rpc/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; result?: any; error?: string } };
}

try {
  // No token, wrong token: no write.
  assert.equal((await rpc('createBot', { name: 'x' }, '')).status, 401);
  assert.equal((await rpc('createBot', { name: 'x' }, 'wrong')).status, 401);
  assert.equal(storage.listBots().length, 0);

  // Unknown or not-allowlisted op.
  assert.equal((await rpc('exportAssistantPackage', {})).status, 404);

  const a = await rpc('createBot', { name: 'Alpha' });
  assert.equal(a.status, 200);
  const b = await rpc('createBot', { name: 'Beta' });
  const botA = a.body.result;
  const botB = b.body.result;
  assert.equal(botA.name, 'Alpha');

  const up = await rpc('updateBot', { id: botA.id, patch: { description: 'hi' } });
  assert.equal(up.body.result.description, 'hi');

  const done = await rpc('finishBotOnboarding', { botId: botA.id, answers: {} });
  assert.equal(done.body.result.onboardingComplete, true);

  const sq = await rpc('createSquad', {
    name: 'Team',
    members: [
      { botId: botA.id, role: 'a' },
      { botId: botB.id, role: 'b' },
    ],
  });
  assert.equal(sq.status, 200);
  const squadId = sq.body.result.id;
  assert.equal((await rpc('updateSquad', { id: squadId, patch: { name: 'Team2' } })).body.result.name, 'Team2');
  assert.equal((await rpc('deleteSquad', { id: squadId })).body.result, true);
  assert.equal(storage.listSquads().length, 0);

  // Storage errors come back as 400 with the message, not 500.
  const bad = await rpc('updateSquad', { id: 'squad_missing', patch: {} });
  assert.equal(bad.status, 400);

  assert.equal((await rpc('deleteBot', { id: botB.id })).body.result, true);
  assert.equal(storage.listBots().length, 1);

  const compress = await rpc('compressSessionNow', { botId: botA.id, mode: 'compress' });
  assert.equal(compress.body.result.ok, true);
  // Model probes from the gateway cannot target unsaved URLs (SSRF).
  const ssrf = await rpc('discoverModels', { baseURL: 'http://169.254.169.254/latest' });
  assert.equal(ssrf.status, 400);
  assert.equal(ssrf.body.error, 'probe_url_not_saved');
  assert.equal((await rpc('testModelConnection', { baseURL: 'http://10.0.0.1:8080/v1', model: 'm' })).status, 400);
} finally {
  api.stop();
}

// Saved key only goes to the saved base URL.
const settings = {
  model: {
    providers: [{ id: 'p1', name: 'P', baseURL: 'https://api.example.com/v1/', apiKey: 'sk-saved', apiFormat: 'chat_completions', models: [] }],
    defaultProviderId: 'p1',
    defaultModelId: '',
  },
} as unknown as AppSettings;
assert.equal(resolveProbeApiKey(settings, { baseURL: 'https://api.example.com/v1', providerId: 'p1' }), 'sk-saved');
assert.equal(resolveProbeApiKey(settings, { baseURL: 'https://evil.example.net/v1', providerId: 'p1' }), '');
assert.equal(resolveProbeApiKey(settings, { baseURL: 'https://evil.example.net/v1', apiKey: 'Bearer sk-own' }), 'sk-own');
assert.equal(resolveProbeApiKey(settings, { baseURL: 'https://api.example.com/v1', providerId: 'nope' }), '');

fs.rmSync(root, { recursive: true, force: true });
console.log('gatewayRpc.test.ts: ok');

// Search rate limit through the gateway.
{
  const { createRateLimiter } = await import('./gatewayRpc');
  const lim = createRateLimiter({ maxInFlight: 1, maxPerWindow: 2, windowMs: 1000 });
  const a = lim.tryStart(0);
  assert.ok(a);
  assert.equal(lim.tryStart(1), null, 'second concurrent search waits');
  a!();
  const b = lim.tryStart(2);
  assert.ok(b);
  b!();
  assert.equal(lim.tryStart(3), null, 'window cap');
  assert.ok(lim.tryStart(1001));
  console.log('gatewayRpc rate limit: ok');
}
