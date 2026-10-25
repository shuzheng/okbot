import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './storage/FileStorage';
import { createGatewayHttpApi } from './gatewayHttpApi';
import type { IpcContext } from './ipc/context';
import type { RuntimeEvent } from '@okbot/shared';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-events-'));
const storage = new FileStorage(root);
const TOKEN = 'events-test-token';

const ctx = {
  storage,
  abortControllers: new Map(),
  pendingToolApprovals: new Map(),
  snapshotActiveRuns: () => ({ busyBotIds: [], pendingToolRequests: [] }),
  hardwareAccelerationActive: true,
} as unknown as IpcContext;

const api = createGatewayHttpApi({ ctx });

const port = await new Promise<number>((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => resolve(p));
  });
});

await api.listen({
  enabled: true,
  port,
  token: TOKEN,
  adminToken: '',
  bindLan: false,
  serveUi: false,
});
const base = `http://127.0.0.1:${port}`;

function parseSseBlocks(buf: string): { events: RuntimeEvent[]; rest: string } {
  const parts = buf.split('\n\n');
  const rest = parts.pop() || '';
  const events: RuntimeEvent[] = [];
  for (const block of parts) {
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as RuntimeEvent);
    } catch {
      /* ignore */
    }
  }
  return { events, rest };
}

const ac = new AbortController();
const res = await fetch(`${base}/v1/events`, {
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'text/event-stream',
  },
  signal: ac.signal,
});
assert.equal(res.status, 200, 'GET /v1/events should connect');
assert.ok(res.body, 'SSE body');

const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buf = '';
const received: RuntimeEvent[] = [];

const readUntil = async (pred: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) {
      throw new Error(`timeout waiting for SSE; got ${JSON.stringify(received)}`);
    }
    const remaining = Math.max(50, deadline - Date.now());
    const step = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), remaining),
      ),
    ]);
    if (step.done && step.value === undefined) {
      continue;
    }
    if (step.done) break;
    buf += decoder.decode(step.value, { stream: true });
    const parsed = parseSseBlocks(buf);
    buf = parsed.rest;
    received.push(...parsed.events);
  }
};

api.bridgeRuntimeEvent({
  type: 'sessions_changed',
  botId: 'bot-1',
  reason: 'message',
});
api.bridgeRuntimeEvent({
  type: 'delta',
  botId: 'bot-1',
  messageId: 'm1',
  delta: 'hello',
  runId: 'run-1',
});
api.bridgeRuntimeEvent({
  type: 'user_message',
  botId: 'bot-1',
  message: {
    id: 'u1',
    role: 'user',
    content: 'hi',
    createdAt: new Date().toISOString(),
  },
  runId: 'run-1',
});

await readUntil(
  () =>
    received.some((e) => e.type === 'sessions_changed') &&
    received.some((e) => e.type === 'delta') &&
    received.some((e) => e.type === 'user_message'),
);

assert.ok(received.some((e) => e.type === 'sessions_changed'));
assert.ok(received.some((e) => e.type === 'delta' && (e as { delta?: string }).delta === 'hello'));
assert.ok(received.some((e) => e.type === 'user_message'));

// Mirror Electron main `sendRuntimeEvent` (IPC + bridge): owner-originated turns
// must reach GET /v1/events subscribers (attach clients).
const sendRuntimeEvent = (event: RuntimeEvent) => {
  api.bridgeRuntimeEvent(event);
};
sendRuntimeEvent({
  type: 'user_message',
  botId: 'bot-1',
  message: {
    id: 'u-owner',
    role: 'user',
    content: 'from-owner',
    createdAt: new Date().toISOString(),
  },
  runId: 'run-owner',
});
await readUntil(() => received.some((e) => e.type === 'user_message' && (e as { message?: { id?: string } }).message?.id === 'u-owner'));
assert.ok(
  received.some((e) => e.type === 'user_message' && (e as { message?: { id?: string } }).message?.id === 'u-owner'),
  'owner-path sendRuntimeEvent must fan user_message to /v1/events',
);

ac.abort();
try {
  await reader.cancel();
} catch {
  /* ignore */
}
api.stop();
fs.rmSync(root, { recursive: true, force: true });
console.log('gatewayHttpApi.events.test.ts: ok');
