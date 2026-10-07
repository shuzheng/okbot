import assert from 'node:assert/strict';
import {
  abortAllOwnerRuns,
  acquireParallelGate,
  cancelQueuedOwnerRuns,
  DEFAULT_MAX_PARALLEL_RUNS,
  ownerHasRuns,
  registerOwnerRun,
  resetOwnerRunQueuesForTests,
  unregisterOwnerRun,
  type AbortControllerMap,
} from './ownerRuns';

resetOwnerRunQueuesForTests();

{
  const map: AbortControllerMap = new Map();
  const a = await acquireParallelGate('bot_p', { maxParallel: 2 });
  const b = await acquireParallelGate('bot_p', { maxParallel: 2 });
  assert.equal(a.proceed, true);
  assert.equal(b.proceed, true);
  assert.notEqual(a.runId, b.runId);

  let cStarted = false;
  const cPromise = acquireParallelGate('bot_p', { maxParallel: 2 }).then((g) => {
    cStarted = true;
    return g;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(cStarted, false, 'third wait should block at cap 2');

  const ca = new AbortController();
  const cb = new AbortController();
  registerOwnerRun(map, 'bot_p', a.runId, ca);
  registerOwnerRun(map, 'bot_p', b.runId, cb);
  // Acquiring/queuing must NOT abort peers (replaces steer abort+restart).
  assert.equal(ca.signal.aborted, false);
  assert.equal(cb.signal.aborted, false);

  a.release();
  unregisterOwnerRun(map, 'bot_p', a.runId, ca);
  const c = await cPromise;
  assert.equal(c.proceed, true);
  assert.equal(cStarted, true);
  assert.equal(cb.signal.aborted, false, 'releasing one slot must not abort the other run');

  b.release();
  c.release();
  unregisterOwnerRun(map, 'bot_p', b.runId, cb);
}

{
  resetOwnerRunQueuesForTests();
  const map: AbortControllerMap = new Map();
  const g1 = await acquireParallelGate('bot_q', { maxParallel: 1 });
  const waiting = acquireParallelGate('bot_q', { maxParallel: 1 });
  await new Promise((r) => setTimeout(r, 10));
  cancelQueuedOwnerRuns('bot_q');
  const g2 = await waiting;
  assert.equal(g2.proceed, false, 'Stop cancels queued wait without starting');

  const ctrl = new AbortController();
  registerOwnerRun(map, 'bot_q', g1.runId, ctrl);
  assert.equal(abortAllOwnerRuns(map, 'bot_q'), true);
  assert.equal(ctrl.signal.aborted, true);
  assert.equal(ownerHasRuns(map, 'bot_q'), false);
  g1.release();
}

assert.ok(DEFAULT_MAX_PARALLEL_RUNS >= 2);
console.log('ownerRuns.test.ts OK');
