import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSandboxHandler } from './server.js';

const TOKEN = 'test-sandbox-token-abc';

async function withServer(
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const handler = createSandboxHandler(TOKEN);
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(base);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function req(
  base: string,
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text };
}

await withServer(async (base) => {
  const health = await req(base, 'GET', '/v1/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  assert.equal(health.json.service, 'okbot-sandbox-agent');

  const unauth = await req(base, 'POST', '/v1/shell', { command: 'echo hi' });
  assert.equal(unauth.status, 401);

  const shell = await req(
    base,
    'POST',
    '/v1/shell',
    { command: 'echo hello-sandbox && pwd' },
    { Authorization: `Bearer ${TOKEN}` },
  );
  assert.equal(shell.status, 200);
  assert.equal(shell.json.ok, true);
  assert.match(String(shell.json.formatted), /hello-sandbox/);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'okbot-sandbox-agent-'));
  const file = path.join(tmp, 'note.txt');
  const write = await req(
    base,
    'POST',
    '/v1/fs/write',
    { path: file, content: 'alpha\n' },
    { Authorization: `Bearer ${TOKEN}` },
  );
  assert.equal(write.status, 200);
  assert.equal(write.json.ok, true);

  const read = await req(
    base,
    'POST',
    '/v1/fs/read',
    { path: file },
    { Authorization: `Bearer ${TOKEN}` },
  );
  assert.equal(read.status, 200);
  assert.match(String(read.json.formatted), /alpha/);

  const edit = await req(
    base,
    'POST',
    '/v1/fs/edit',
    { path: file, old_text: 'alpha', new_text: 'beta' },
    { Authorization: `Bearer ${TOKEN}` },
  );
  assert.equal(edit.status, 200);
  const disk = await fs.readFile(file, 'utf8');
  assert.equal(disk, 'beta\n');

  // SSE shell
  const sseRes = await fetch(`${base}/v1/shell`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ command: 'printf "sse-chunk\\n"' }),
  });
  assert.equal(sseRes.status, 200);
  assert.match(sseRes.headers.get('content-type') || '', /text\/event-stream/);
  const sseBody = await sseRes.text();
  assert.match(sseBody, /event: done/);
  assert.match(sseBody, /sse-chunk/);
});

console.log('sandboxApi.test.ts: ok');
