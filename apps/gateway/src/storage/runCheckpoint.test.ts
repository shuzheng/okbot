import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './FileStorage';
import { isRunCheckpointRecord } from './RunCheckpointStore';

assert.equal(isRunCheckpointRecord(null), false);
assert.equal(
  isRunCheckpointRecord({
    v: 1,
    ownerId: 'b1',
    kind: 'bot',
    runId: 'r1',
    messageId: 'm1',
    serializedRunState: '',
    createdAt: 't',
    updatedAt: 't',
  }),
  false,
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-run-checkpoint-'));
const storage = new FileStorage(root);
const bot = storage.createBot({ name: 'A' });

assert.equal(storage.loadRunCheckpoint(bot.id), null);

storage.saveRunCheckpoint(bot.id, {
  kind: 'bot',
  runId: 'run_1',
  messageId: 'msg_1',
  serializedRunState: '{"state":1}',
  createdAt: '2026-01-01T00:00:00.000Z',
  userText: 'hello',
  computerId: 'local',
});
const loaded = storage.loadRunCheckpoint(bot.id);
assert.ok(loaded);
assert.equal(loaded!.runId, 'run_1');
assert.equal(loaded!.userText, 'hello');
assert.equal(loaded!.computerId, 'local');
assert.ok(fs.existsSync(path.join(storage.dataRoot, bot.id, 'run-checkpoint.json')));

// Overwrite single latest
storage.saveRunCheckpoint(bot.id, {
  kind: 'bot',
  runId: 'run_2',
  messageId: 'msg_2',
  serializedRunState: '{"state":2}',
  createdAt: '2026-01-01T00:01:00.000Z',
});
assert.equal(storage.loadRunCheckpoint(bot.id)?.runId, 'run_2');
assert.equal(storage.listAllRunCheckpoints().length, 1);

storage.clearRunCheckpoint(bot.id);
assert.equal(storage.loadRunCheckpoint(bot.id), null);
assert.ok(!fs.existsSync(path.join(storage.dataRoot, bot.id, 'run-checkpoint.json')));

// clearPendingHitl does not clear checkpoints (independent stores)
storage.saveRunCheckpoint(bot.id, {
  kind: 'bot',
  runId: 'run_3',
  messageId: 'msg_3',
  serializedRunState: '{}',
  createdAt: '2026-01-01T00:02:00.000Z',
});
storage.clearPendingHitl(bot.id);
assert.ok(storage.loadRunCheckpoint(bot.id));

// Intentional stop/force-quit path clears both
storage.clearRunCheckpoint(bot.id);
assert.equal(storage.loadRunCheckpoint(bot.id), null);

fs.rmSync(root, { recursive: true, force: true });
console.log('runCheckpoint.test.ts: ok');
