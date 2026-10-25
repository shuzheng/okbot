import assert from 'node:assert/strict';
import { planBackgroundLocalGateway } from './ensureBackgroundLocalGateway';

assert.deepEqual(
  planBackgroundLocalGateway({
    alreadyOwnsInProcess: true,
    running: { state: 'free' },
  }),
  { action: 'skip_already_running', port: 0 },
);

assert.deepEqual(
  planBackgroundLocalGateway({
    alreadyOwnsInProcess: false,
    running: { state: 'running', port: 18765, pid: 42 },
  }),
  { action: 'skip_already_running', port: 18765, pid: 42 },
);

assert.deepEqual(
  planBackgroundLocalGateway({
    alreadyOwnsInProcess: false,
    running: { state: 'free' },
    lock: { ok: true },
  }),
  { action: 'start' },
);

assert.deepEqual(
  planBackgroundLocalGateway({
    alreadyOwnsInProcess: false,
    running: { state: 'free' },
    lock: { ok: false, existing: { pid: 99, port: 18765 } },
    lockHolderVerified: true,
  }),
  { action: 'skip_lock_held', pid: 99, port: 18765, verifiedOkbot: true },
);

assert.deepEqual(
  planBackgroundLocalGateway({
    alreadyOwnsInProcess: false,
    running: { state: 'free' },
    lock: { ok: false, existing: { pid: 99, port: 18765 } },
    lockHolderVerified: false,
  }),
  { action: 'skip_lock_held', pid: 99, port: 18765, verifiedOkbot: false },
);

console.log('ensureBackgroundLocalGateway.test.ts: ok');
