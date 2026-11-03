import assert from 'node:assert/strict';
import {
  createRunCheckpointBox,
  noteRunCheckpointState,
  wireRunCheckpointFlush,
} from './hitl.js';
import type { HitlLoopHooks } from './types.js';

{
  // wireRunCheckpointFlush registers a host flush that emits the latest boxed state.
  const checkpoints: string[] = [];
  let registeredFlush: (() => void) | null = null;
  const hooks: HitlLoopHooks = {
    onToolApprovalRequest: async () => ({ approved: true }),
    onRunCheckpoint: ({ serializedRunState }) => {
      checkpoints.push(serializedRunState);
    },
    registerCheckpointFlush: (flush) => {
      registeredFlush = flush;
    },
  };
  const box = createRunCheckpointBox();
  wireRunCheckpointFlush(hooks, box);
  assert.equal(typeof registeredFlush, 'function');

  // No state yet → flush is a no-op.
  registeredFlush!();
  assert.deepEqual(checkpoints, []);

  noteRunCheckpointState(box, {
    toString: () => 'ckpt-v1',
  });
  registeredFlush!();
  assert.deepEqual(checkpoints, ['ckpt-v1']);

  // Fresher in-memory state is what Stop / soft-steer flush must persist.
  noteRunCheckpointState(box, {
    toString: () => 'ckpt-v2-mid-stream',
  });
  registeredFlush!();
  assert.deepEqual(checkpoints, ['ckpt-v1', 'ckpt-v2-mid-stream']);
}

{
  // Serialize failure soft-skips (does not throw to abort path).
  let registeredFlush: (() => void) | null = null;
  const hooks: HitlLoopHooks = {
    onToolApprovalRequest: async () => ({ approved: true }),
    onRunCheckpoint: () => {
      throw new Error('host should not be called when toString fails');
    },
    registerCheckpointFlush: (flush) => {
      registeredFlush = flush;
    },
  };
  const box = createRunCheckpointBox();
  wireRunCheckpointFlush(hooks, box);
  noteRunCheckpointState(box, {
    toString: () => {
      throw new Error('bad state');
    },
  });
  // emitRunCheckpoint catches — flush must not throw.
  registeredFlush!();
}

{
  // Without onRunCheckpoint / registerCheckpointFlush, wire is a no-op.
  const hooks: HitlLoopHooks = {
    onToolApprovalRequest: async () => ({ approved: true }),
  };
  const box = createRunCheckpointBox();
  wireRunCheckpointFlush(hooks, box);
  noteRunCheckpointState(box, { toString: () => 'x' });
  assert.equal(box.state?.toString(), 'x');
}

console.log('runCheckpointFlush.test.ts OK');
