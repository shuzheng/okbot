/**
 * Watchdog silent-resume gates: Stop / soft-steer excluded; transient keep policy.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from '../storage/FileStorage';
import {
  markSoftSteerCheckpointHandoff,
  resetSoftSteerStateForTests,
  shouldKeepRunCheckpointOnTurnEnd,
} from './softSteerGate';
import { resetOwnerRunQueuesForTests } from './ownerRuns';
import { isCheckpointSilentResumeSafe } from './runWatchdog';

resetSoftSteerStateForTests();
resetOwnerRunQueuesForTests();

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-watchdog-'));
const storage = new FileStorage(root);
const bot = storage.createBot({ name: 'w' });

storage.saveRunCheckpoint(bot.id, {
  kind: 'bot',
  runId: 'run_w',
  messageId: 'msg_w',
  serializedRunState: '{"state":1}',
  createdAt: new Date().toISOString(),
});

const ctx = {
  abortControllers: new Map(),
  storage,
  sendRuntimeEvent: () => undefined,
  pendingToolApprovals: new Map(),
  snapshotActiveRuns: () => ({ runs: [], busyBotIds: [] }),
} as never;

assert.equal(isCheckpointSilentResumeSafe(ctx, bot.id).ok, true);

storage.saveRunCheckpoint(bot.id, {
  kind: 'bot',
  runId: 'run_w',
  messageId: 'msg_w',
  serializedRunState: '{"state":1}',
  createdAt: new Date().toISOString(),
  autoResumeEligible: false,
});
const stopped = isCheckpointSilentResumeSafe(ctx, bot.id);
assert.equal(stopped.ok, false);
assert.equal((stopped as { reason: string }).reason, 'stop_suppress_auto_resume');

storage.saveRunCheckpoint(bot.id, {
  kind: 'bot',
  runId: 'run_w',
  messageId: 'msg_w',
  serializedRunState: '{"state":1}',
  createdAt: new Date().toISOString(),
});
markSoftSteerCheckpointHandoff(bot.id);
assert.equal(isCheckpointSilentResumeSafe(ctx, bot.id).ok, false);
resetSoftSteerStateForTests();

assert.equal(
  shouldKeepRunCheckpointOnTurnEnd({
    ownerId: bot.id,
    aborted: false,
    transientFailure: true,
  }),
  true,
);
assert.equal(
  shouldKeepRunCheckpointOnTurnEnd({
    ownerId: bot.id,
    aborted: false,
    transientFailure: false,
  }),
  false,
);

console.log('runWatchdog.test.ts: ok');
