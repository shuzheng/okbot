import assert from 'node:assert/strict';
import http from 'node:http';
import {
  createLocalExecutionBackend,
  createRemoteExecutionBackend,
  probeRemoteComputer,
  resolveExecutionBackend,
} from './executionBackend.js';

const local = createLocalExecutionBackend();
assert.equal(local.label, '本机');
const shellOut = await local.runShell('echo local-backend-ok');
assert.match(shellOut, /local-backend-ok/);

const TOKEN = 'backend-test-token';
let shellPosts = 0;
const server = http.createServer((req, res) => {
  const pathOnly = (req.url || '').split('?')[0];
  if (req.method === 'GET' && pathOnly === '/v1/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'okbot-sandbox-agent' }));
    return;
  }
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${TOKEN}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const path = (req.url || '').split('?')[0];
    if (path === '/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'okbot-sandbox-agent' }));
      return;
    }
    if (path === '/v1/shell') {
      shellPosts += 1;
      let parsed: { command?: string } = {};
      try { parsed = body.trim() ? JSON.parse(body) : {}; } catch { parsed = {}; }
      if (!parsed.command || !String(parsed.command).trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'command_required' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          formatted: 'cwd: /tmp\n\nshell: /bin/bash\n\nstdout:\nremote-shell-ok\n',
        }),
      );
      return;
    }
    if (path === '/v1/fs/read') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, formatted: 'path: /x\n\nhello' }));
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });
});

await new Promise<void>((resolve, reject) => {
  server.listen(0, '127.0.0.1', () => resolve());
  server.once('error', reject);
});
const addr = server.address();
if (!addr || typeof addr === 'string') throw new Error('no addr');
const port = addr.port;

const remote = createRemoteExecutionBackend({
  name: 'TestCloud',
  baseUrl: `http://127.0.0.1:${port}`,
  token: TOKEN,
});
assert.equal(remote.label, 'TestCloud');
const postsBefore = shellPosts;
const remoteOut = await remote.runShell('echo ignored');
assert.equal(shellPosts, postsBefore + 1);
assert.match(remoteOut, /remote-shell-ok/);
const readOut = await remote.readFile('/x');
assert.match(readOut, /hello/);

const resolvedLocal = resolveExecutionBackend({ computerId: 'local', computers: [] });
assert.equal(resolvedLocal.label, '本机');

const resolvedRemote = resolveExecutionBackend({
  computerId: 'c1',
  computers: [{ id: 'c1', name: 'Orb', host: '127.0.0.1', port, token: TOKEN }],
});
assert.equal(resolvedRemote.label, 'Orb');
const viaResolve = await resolvedRemote.runShell('x');
assert.match(viaResolve, /remote-shell-ok/);

const probed = await probeRemoteComputer({
  name: 'TestCloud',
  baseUrl: `http://127.0.0.1:${port}`,
  token: TOKEN,
});
assert.deepEqual(probed, { ok: true });
const badToken = await probeRemoteComputer({
  name: 'TestCloud',
  baseUrl: `http://127.0.0.1:${port}`,
  token: 'wrong-token',
});
assert.deepEqual(badToken, { ok: false, error: 'unauthorized' });
const down = await probeRemoteComputer({
  name: 'Down',
  baseUrl: 'http://127.0.0.1:1',
  token: TOKEN,
});
assert.equal(down.ok, false);
if (!down.ok) assert.equal(down.error, 'unreachable');

const missing = resolveExecutionBackend({ computerId: 'missing-computer', computers: [] });
const refused = await missing.runShell('echo should-not-run');
assert.match(refused, /拒绝/);
assert.doesNotMatch(refused, /should-not-run/);

await new Promise<void>((resolve) => server.close(() => resolve()));
console.log('executionBackend.test.ts: ok');
