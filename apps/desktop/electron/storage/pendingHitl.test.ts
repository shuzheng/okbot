import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './FileStorage';
import type { PendingHitlRecord } from './types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-hitl-'));
const storage = new FileStorage(root);
const bot = storage.createBot({ name: 'A' });

const rec = (requestId: string, createdAt: string, extra: Partial<PendingHitlRecord> = {}): PendingHitlRecord => ({
  v: 1,
  requestId,
  messageId: 'msg_1',
  toolName: 'shell',
  arguments: '{}',
  serializedRunState: '{}',
  createdAt,
  ...extra,
});

// Parallel approvals keep one file each; saving the second must not overwrite the first.
storage.savePendingHitl(bot.id, rec('r1', '2026-01-01T00:00:01Z', {
  squadMember: { botId: 'b1', toolName: 'ask_a', task: 't1' },
  turnId: 'turn_1',
}));
storage.savePendingHitl(bot.id, rec('r2', '2026-01-01T00:00:02Z'));
let list = storage.listPendingHitl(bot.id);
assert.deepEqual(list.map((p) => p.requestId), ['r1', 'r2']);
assert.equal(list[0]!.squadMember?.task, 't1');
assert.equal(list[0]!.turnId, 'turn_1');
assert.equal(storage.loadPendingHitl(bot.id)?.requestId, 'r1');
assert.equal(storage.listAllPendingHitl().length, 2);

storage.clearPendingHitlRequest(bot.id, 'r1');
list = storage.listPendingHitl(bot.id);
assert.deepEqual(list.map((p) => p.requestId), ['r2']);

// Legacy single file is still read and cleared by request id.
fs.writeFileSync(path.join(root, bot.id, 'pending-hitl.json'), JSON.stringify(rec('old', '2025-01-01T00:00:00Z')));
assert.deepEqual(storage.listPendingHitl(bot.id).map((p) => p.requestId), ['old', 'r2']);
storage.clearPendingHitlRequest(bot.id, 'old');
assert.deepEqual(storage.listPendingHitl(bot.id).map((p) => p.requestId), ['r2']);

// Collected member replies per turn.
storage.writeSquadResumeReplies(bot.id, 'turn_1', [{ memberBotId: 'b1', memberName: 'M', task: 't', reply: 'ok' }]);
assert.equal(storage.readSquadResumeReplies(bot.id, 'turn_1').length, 1);

storage.clearPendingHitl(bot.id);
assert.equal(storage.listPendingHitl(bot.id).length, 0);
assert.equal(storage.readSquadResumeReplies(bot.id, 'turn_1').length, 0);

fs.rmSync(root, { recursive: true, force: true });
console.log('pendingHitl ok');
