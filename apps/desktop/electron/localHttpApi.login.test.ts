import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './storage/FileStorage';
import { createLocalHttpApi } from './localHttpApi';
import type { IpcContext } from './ipc/context';

// An oversize login form used to reject inside `void handle()` and crash `okbot serve`.
let unhandled: unknown = null;
process.on('unhandledRejection', (err) => {
  unhandled = err;
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-login-'));
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
await api.listen({ enabled: true, port, token: 'tok-login-test', bindLan: false, serveUi: false });
const base = `http://127.0.0.1:${port}`;

const big = 'token=' + 'x'.repeat(20_000);
await fetch(`${base}/gateway-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: big,
}).catch(() => null); // the server may drop the socket; it must not die
await new Promise((r) => setTimeout(r, 100));
assert.equal(unhandled, null, 'login must not leave an unhandled rejection');

const health = await fetch(`${base}/v1/health`);
assert.equal(health.status, 200, 'server still answers after an oversize login');
const bad = await fetch(`${base}/gateway-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'token=wrong',
});
assert.equal(bad.status, 401);

api.stop();
fs.rmSync(root, { recursive: true, force: true });
console.log('localHttpApi.login.test.ts: ok');
process.exit(0);
