import assert from 'node:assert/strict';
import {
  abortAllOwnerRuns,
  abortOwnerRun,
  acquireParallelGate,
  cancelQueuedOwnerRuns,
  DEFAULT_MAX_PARALLEL_RUNS,
  getOwnerRunLastHeartbeatMs,
  listOwnerRunIds,
  ownerHasRuns,
  registerOwnerRun,
  resetOwnerRunQueuesForTests,
  setOwnerRunCheckpointFlush,
  unregisterOwnerRun,
  waitOwnerRunUnregistered,
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


{
  resetOwnerRunQueuesForTests();
  const map: AbortControllerMap = new Map();
  const g1 = await acquireParallelGate('bot_s', { maxParallel: 2 });
  const g2 = await acquireParallelGate('bot_s', { maxParallel: 2 });
  const c1 = new AbortController();
  const c2 = new AbortController();
  registerOwnerRun(map, 'bot_s', g1.runId, c1);
  registerOwnerRun(map, 'bot_s', g2.runId, c2);
  assert.deepEqual(listOwnerRunIds(map, 'bot_s'), [g1.runId, g2.runId]);

  assert.equal(abortOwnerRun(map, 'bot_s', g1.runId), true);
  assert.equal(c1.signal.aborted, true);
  assert.equal(c2.signal.aborted, false, 'abortOwnerRun must not abort peers');

  unregisterOwnerRun(map, 'bot_s', g1.runId, c1);
  const gone = await waitOwnerRunUnregistered(map, 'bot_s', g1.runId, 500);
  assert.equal(gone, true);
  assert.deepEqual(listOwnerRunIds(map, 'bot_s'), [g2.runId]);

  g1.release();
  g2.release();
  unregisterOwnerRun(map, 'bot_s', g2.runId, c2);
}

assert.ok(DEFAULT_MAX_PARALLEL_RUNS >= 2);

{
  // Flush registered checkpoint callback BEFORE AbortController.abort (Stop / soft-steer).
  resetOwnerRunQueuesForTests();
  const map: AbortControllerMap = new Map();
  const ctrl = new AbortController();
  const order: string[] = [];
  registerOwnerRun(map, 'bot_flush', 'run_f', ctrl);
  setOwnerRunCheckpointFlush('bot_flush', 'run_f', () => {
    order.push('flush');
    assert.equal(ctrl.signal.aborted, false, 'flush must run before abort completes');
  });
  ctrl.signal.addEventListener('abort', () => {
    order.push('abort');
  });
  assert.equal(abortOwnerRun(map, 'bot_flush', 'run_f'), true);
  assert.deepEqual(order, ['flush', 'abort']);
  unregisterOwnerRun(map, 'bot_flush', 'run_f', ctrl);
}

{
  // abortAllOwnerRuns (Stop) flushes every in-flight run before abort.
  resetOwnerRunQueuesForTests();
  const map: AbortControllerMap = new Map();
  const c1 = new AbortController();
  const c2 = new AbortController();
  const flushed: string[] = [];
  registerOwnerRun(map, 'bot_stop_flush', 'run_1', c1);
  registerOwnerRun(map, 'bot_stop_flush', 'run_2', c2);
  setOwnerRunCheckpointFlush('bot_stop_flush', 'run_1', () => {
    flushed.push('run_1');
    assert.equal(c1.signal.aborted, false);
  });
  setOwnerRunCheckpointFlush('bot_stop_flush', 'run_2', () => {
    flushed.push('run_2');
    assert.equal(c2.signal.aborted, false);
  });
  assert.equal(abortAllOwnerRuns(map, 'bot_stop_flush'), true);
  assert.deepEqual(flushed.sort(), ['run_1', 'run_2']);
  assert.equal(c1.signal.aborted, true);
  assert.equal(c2.signal.aborted, true);
}

{
  // Flush errors must not block abort.
  resetOwnerRunQueuesForTests();
  const map: AbortControllerMap = new Map();
  const ctrl = new AbortController();
  registerOwnerRun(map, 'bot_flush_err', 'run_e', ctrl);
  setOwnerRunCheckpointFlush('bot_flush_err', 'run_e', () => {
    throw new Error('flush boom');
  });
  assert.equal(abortOwnerRun(map, 'bot_flush_err', 'run_e'), true);
  assert.equal(ctrl.signal.aborted, true);
  unregisterOwnerRun(map, 'bot_flush_err', 'run_e', ctrl);
}


{
  // abortAllOwnerRuns must stop heartbeat timers before map.delete (Stop leak).
  // Otherwise finally unregisterOwnerRun early-returns and 10s intervals stack.
  resetOwnerRunQueuesForTests();
  const map: AbortControllerMap = new Map();
  const ctrl = new AbortController();
  registerOwnerRun(map, 'bot_hb_stop', 'run_hb', ctrl);
  assert.ok(getOwnerRunLastHeartbeatMs('bot_hb_stop', 'run_hb') != null);
  assert.equal(abortAllOwnerRuns(map, 'bot_hb_stop'), true);
  assert.equal(ctrl.signal.aborted, true);
  assert.equal(ownerHasRuns(map, 'bot_hb_stop'), false);
  assert.equal(
    getOwnerRunLastHeartbeatMs('bot_hb_stop', 'run_hb'),
    null,
    'Stop must clear runHeartbeats so intervals do not leak',
  );
  // Mimic turn finally after abortAll cleared the map — must not throw / re-leak.
  unregisterOwnerRun(map, 'bot_hb_stop', 'run_hb', ctrl);
  assert.equal(getOwnerRunLastHeartbeatMs('bot_hb_stop', 'run_hb'), null);
}

console.log('ownerRuns.test.ts OK');
