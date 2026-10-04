import assert from 'node:assert/strict';
import type { ChatMessage } from '@okbot/shared';
import { applyOptimisticSendFailure, rememberReconciledLocalId } from './optimisticSend';

const createdAt = '2026-10-04T02:00:00.000Z';

function user(id: string, content: string, sendStatus?: ChatMessage['sendStatus']): ChatMessage {
  return { id, role: 'user', content, createdAt, ...(sendStatus ? { sendStatus } : {}) };
}

function assistant(id: string, content: string): ChatMessage {
  return { id, role: 'assistant', content, createdAt };
}

const failed = {
  localId: 'local_1',
  text: 'hello',
  createdAt,
};

// Send never reached the server: mark the same optimistic bubble, do not add another.
const pending = [user('local_1', 'hello', 'pending')];
const marked = applyOptimisticSendFailure(pending, failed, new Set());
assert.equal(marked.length, 1);
assert.equal(marked[0].id, 'local_1');
assert.equal(marked[0].sendStatus, 'failed');

// Reply started, then the turn failed: persisted user row replaced local_*.
// A second failed user bubble must not appear after the partial assistant reply.
const persisted: ChatMessage[] = [
  user('msg_user', 'hello'),
  assistant('msg_asst', 'partial reply'),
];
const reconciled = new Set(['local_1']);
const kept = applyOptimisticSendFailure(persisted, failed, reconciled);
assert.equal(kept.length, 2);
assert.deepEqual(
  kept.map((m) => m.id),
  ['msg_user', 'msg_asst'],
);
assert.equal(kept.filter((m) => m.role === 'user').length, 1);
assert.equal(kept[0].sendStatus, undefined);

// Bubble really missing and never reconciled: keep a single failed row so retry still works.
const restored = applyOptimisticSendFailure([assistant('msg_asst', '')], failed, new Set());
assert.equal(restored.length, 2);
assert.equal(restored[1].id, 'local_1');
assert.equal(restored[1].role, 'user');
assert.equal(restored[1].sendStatus, 'failed');

{
  const persisted = [
    { id: 'msg_1', role: 'user' as const, content: 'hi', createdAt: '2026-01-01T00:00:00.000Z' },
  ];
  const kept = applyOptimisticSendFailure(
    persisted,
    { localId: 'local_9', text: 'hi', createdAt: '2026-01-01T00:00:01.000Z' },
    new Set(),
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.id, 'msg_1');
}

{
  const ids = new Set<string>();
  for (let i = 0; i < 70; i++) rememberReconciledLocalId(ids, `local_${i}`);
  assert.equal(ids.size, 64);
  assert.ok(!ids.has('local_0'));
  assert.ok(ids.has('local_69'));
}

console.log('optimisticSend.test.ts: ok');
