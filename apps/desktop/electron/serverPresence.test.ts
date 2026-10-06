import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { probeChallengeMac } from './authChallenge';
import {
  acquireServerLock,
  inspectRunningServer,
  isPidAlive,
  probeOkbotHealth,
  publicBase,
  readServerLock,
  releaseServerLock,
} from './serverPresence';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-lock-'));

assert.equal(isPidAlive(process.pid), true);
assert.equal(isPidAlive(2_000_000_000), false);
assert.equal(publicBase(18765), 'http://127.0.0.1:18765');

const first = acquireServerLock(root, { pid: process.pid, port: 18765, owner: 'serve' });
assert.equal(first.ok, true);
const second = acquireServerLock(root, { pid: process.pid + 1, port: 18765, owner: 'electron' });
assert.equal(second.ok, false);
if (!second.ok) assert.equal(second.existing.pid, process.pid);

releaseServerLock(root, process.pid);
assert.equal(readServerLock(root), null);

fs.writeFileSync(
  path.join(root, 'server.json'),
  JSON.stringify({ pid: 2_000_000_000, port: 9, owner: 'serve' }),
);
const replaced = acquireServerLock(root, { pid: process.pid, port: 18765, owner: 'electron' });
assert.equal(replaced.ok, true);
assert.equal(readServerLock(root)?.owner, 'electron');
releaseServerLock(root, process.pid);

const token = 'probe-token';
const health = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/v1/auth-challenge') {
    const nonce = (url.searchParams.get('nonce') || '').trim();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        service: 'okbot-local-http-api',
        mac: probeChallengeMac(token, nonce),
      }),
    );
    return;
  }
  if (url.pathname === '/v1/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'okbot-local-http-api' }));
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => health.listen(0, '127.0.0.1', () => resolve()));
const addr = health.address();
const port = typeof addr === 'object' && addr ? addr.port : 0;
assert.equal(await probeOkbotHealth(port), true);
assert.equal(await probeOkbotHealth(port, 400, token), true);
assert.equal(await probeOkbotHealth(port, 400, 'wrong'), false);
health.close();

const other = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'something-else' }));
});
await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', () => resolve()));
const addr2 = other.address();
const port2 = typeof addr2 === 'object' && addr2 ? addr2.port : 0;
assert.equal(await probeOkbotHealth(port2), false);
assert.equal(await probeOkbotHealth(port2, 400, token), false);
other.close();

// Health JSON forge without challenge — must fail when a token is required.
const forged = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/v1/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'okbot-local-http-api' }));
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => forged.listen(0, '127.0.0.1', () => resolve()));
const addr3 = forged.address();
const port3 = typeof addr3 === 'object' && addr3 ? addr3.port : 0;
assert.equal(await probeOkbotHealth(port3, 400, token), false);
forged.close();

// Token-harvesting faker: accepts any Bearer and echoes 200/401. Challenge must reject it,
// and the client must never send the real token on the challenge request.
let sawAuthorization = false;
const harvester = http.createServer((req, res) => {
  if (req.headers.authorization) sawAuthorization = true;
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/v1/auth-challenge') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Wrong mac (random) — pretend to be OkBot without knowing the token.
    res.end(
      JSON.stringify({
        ok: true,
        service: 'okbot-local-http-api',
        mac: crypto.randomBytes(32).toString('hex'),
      }),
    );
    return;
  }
  if (url.pathname === '/v1/approvals') {
    const auth = String(req.headers.authorization || '');
    if (auth.startsWith('Bearer ')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false }));
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => harvester.listen(0, '127.0.0.1', () => resolve()));
const addr4 = harvester.address();
const port4 = typeof addr4 === 'object' && addr4 ? addr4.port : 0;
assert.equal(await probeOkbotHealth(port4, 400, token), false);
assert.equal(sawAuthorization, false);
harvester.close();

// Live foreign lock + failed probe must not report running (would attach with a real token).
const stuck = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-stuck-'));
const deadPortServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'not-okbot' }));
});
await new Promise<void>((resolve) => deadPortServer.listen(0, '127.0.0.1', () => resolve()));
const deadAddr = deadPortServer.address();
const deadPort = typeof deadAddr === 'object' && deadAddr ? deadAddr.port : 0;
// Child keeps a foreign pid alive while the port fails the challenge.
const { spawn } = await import('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], {
  stdio: 'ignore',
});
try {
  fs.writeFileSync(
    path.join(stuck, 'server.json'),
    JSON.stringify({ pid: child.pid, port: deadPort, owner: 'serve' }),
  );
  const inspected = await inspectRunningServer(stuck, deadPort, token);
  assert.equal(inspected.state, 'free');
  assert.equal(readServerLock(stuck), null);
} finally {
  child.kill('SIGKILL');
  deadPortServer.close();
  fs.rmSync(stuck, { recursive: true, force: true });
}

fs.rmSync(root, { recursive: true, force: true });
console.log('serverPresence.test ok');
