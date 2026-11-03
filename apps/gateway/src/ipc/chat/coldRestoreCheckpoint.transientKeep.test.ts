import assert from 'node:assert/strict';
import { ensureColdResumeCheckpointKeptForTransient } from './coldResumeCheckpointKeep';
import type { RunCheckpointRecord } from '../../storage/types';

function makeDisk(overrides?: Partial<RunCheckpointRecord>): RunCheckpointRecord {
  return {
    v: 1,
    ownerId: 'bot_ck',
    kind: 'bot',
    runId: 'run_orig',
    messageId: 'msg_orig',
    serializedRunState: '{"v":1,"orig":true}',
    createdAt: '2026-11-03T00:00:00.000Z',
    updatedAt: '2026-11-03T00:00:00.000Z',
    computerId: 'comp_1',
    userText: 'hello',
    ...overrides,
  };
}

{
  // Consume-once left disk empty → rewrite original so Watchdog can resume again.
  const saved: RunCheckpointRecord[] = [];
  const storage = {
    loadRunCheckpoint(_ownerId: string) {
      return saved.length ? saved[saved.length - 1]! : null;
    },
    saveRunCheckpoint(ownerId: string, data: Omit<RunCheckpointRecord, 'v' | 'ownerId' | 'updatedAt'> & { updatedAt?: string }) {
      saved.push({
        v: 1,
        ownerId,
        kind: data.kind,
        runId: data.runId,
        messageId: data.messageId,
        serializedRunState: data.serializedRunState,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt || '2026-11-03T00:01:00.000Z',
        ...(data.computerId ? { computerId: data.computerId } : {}),
        ...(data.userText ? { userText: data.userText } : {}),
        ...(data.autoResumeEligible === false ? { autoResumeEligible: false } : {}),
      });
    },
  };
  const disk = makeDisk();
  ensureColdResumeCheckpointKeptForTransient(storage, 'bot_ck', disk);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]!.runId, 'run_orig');
  assert.equal(saved[0]!.serializedRunState, '{"v":1,"orig":true}');
  assert.equal(saved[0]!.computerId, 'comp_1');
  assert.equal(saved[0]!.userText, 'hello');
}

{
  // onRunCheckpoint already rewrote → do not clobber newer state with original.
  const newer = makeDisk({
    runId: 'run_resume',
    serializedRunState: '{"v":1,"newer":true}',
    updatedAt: '2026-11-03T00:02:00.000Z',
  });
  let saveCalls = 0;
  const storage = {
    loadRunCheckpoint() {
      return newer;
    },
    saveRunCheckpoint() {
      saveCalls += 1;
    },
  };
  ensureColdResumeCheckpointKeptForTransient(storage, 'bot_ck', makeDisk());
  assert.equal(saveCalls, 0, 'must prefer existing mid-run rewrite');
}

console.log('coldRestoreCheckpoint.transientKeep.test.ts OK');
