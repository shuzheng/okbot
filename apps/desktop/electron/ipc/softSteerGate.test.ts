import assert from 'node:assert/strict';
import {
  abortOwnerRun,
  listOwnerRunIds,
  registerOwnerRun,
  resetOwnerRunQueuesForTests,
  unregisterOwnerRun,
  waitOwnerRunUnregistered,
  type AbortControllerMap,
} from './ownerRuns';
import {
  cancelSoftSteers,
  resetSoftSteerStateForTests,
  softSteerNewestRun,
} from './softSteerGate';

resetOwnerRunQueuesForTests();
resetSoftSteerStateForTests();

{
  const map: AbortControllerMap = new Map();
  const cOld = new AbortController();
  const cNew = new AbortController();
  registerOwnerRun(map, 'bot_o', 'run_old', cOld);
  registerOwnerRun(map, 'bot_o', 'run_new', cNew);
  assert.deepEqual(listOwnerRunIds(map, 'bot_o'), ['run_old', 'run_new']);

  const ctx = { abortControllers: map };
  const resultPromise = softSteerNewestRun(ctx, 'bot_o');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(cNew.signal.aborted, true);
  assert.equal(cOld.signal.aborted, false);

  unregisterOwnerRun(map, 'bot_o', 'run_new', cNew);
  const result = await resultPromise;
  assert.equal(result.steered, true);
  assert.equal(result.superseded, false);
  assert.deepEqual(listOwnerRunIds(map, 'bot_o'), ['run_old']);
  unregisterOwnerRun(map, 'bot_o', 'run_old', cOld);
}

{
  resetSoftSteerStateForTests();
  const map: AbortControllerMap = new Map();
  const c1 = new AbortController();
  registerOwnerRun(map, 'bot_stop', 'run_1', c1);
  const ctx = { abortControllers: map };

  const pending = softSteerNewestRun(ctx, 'bot_stop');
  await new Promise((r) => setTimeout(r, 5));
  cancelSoftSteers('bot_stop');
  assert.equal(c1.signal.aborted, true);
  unregisterOwnerRun(map, 'bot_stop', 'run_1', c1);
  const result = await pending;
  assert.equal(result.superseded, true);
}

{
  resetSoftSteerStateForTests();
  const map: AbortControllerMap = new Map();
  const c1 = new AbortController();
  registerOwnerRun(map, 'bot_w', 'run_w', c1);
  abortOwnerRun(map, 'bot_w', 'run_w');
  unregisterOwnerRun(map, 'bot_w', 'run_w', c1);
  const ok = await waitOwnerRunUnregistered(map, 'bot_w', 'run_w', 200);
  assert.equal(ok, true);
}

console.log('softSteerGate.test.ts OK');
