import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  acquireServerLock,
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

const health = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'okbot-local-http-api' }));
});
await new Promise<void>((resolve) => health.listen(0, '127.0.0.1', () => resolve()));
const addr = health.address();
const port = typeof addr === 'object' && addr ? addr.port : 0;
assert.equal(await probeOkbotHealth(port), true);
health.close();

const other = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'something-else' }));
});
await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', () => resolve()));
const addr2 = other.address();
const port2 = typeof addr2 === 'object' && addr2 ? addr2.port : 0;
assert.equal(await probeOkbotHealth(port2), false);
other.close();

fs.rmSync(root, { recursive: true, force: true });
console.log('serverPresence.test ok');
