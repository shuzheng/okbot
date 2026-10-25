import assert from 'node:assert/strict';
import {
  abortOwnerRun,
  listBusyOwnerIds,
  listOwnerRunIds,
  ownerHasBusyHold,
  registerOwnerRun,
  resetOwnerRunQueuesForTests,
  unregisterOwnerRun,
  waitOwnerRunUnregistered,
  type AbortControllerMap,
} from './ownerRuns';
import {
  cancelSoftSteers,
  getSoftSteerEpoch,
  listSoftSteerAwareBusyOwnerIds,
  resetSoftSteerStateForTests,
  softSteerNewestRun,
} from './softSteerGate';
import {
  isAutoContinueCancelled,
  resetAutoContinueStateForTests,
} from './autoContinueGate';

resetOwnerRunQueuesForTests();
resetSoftSteerStateForTests();
resetAutoContinueStateForTests();

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
  assert.equal(cOld.signal.aborted, true, 'soft-steer aborts all owner runs incl. older peers');

  unregisterOwnerRun(map, 'bot_o', 'run_new', cNew);
  unregisterOwnerRun(map, 'bot_o', 'run_old', cOld);
  const result = await resultPromise;
  assert.equal(result.steered, true);
  assert.equal(result.superseded, false);
  assert.deepEqual(listOwnerRunIds(map, 'bot_o'), []);
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


{
  // Empty runs after Stop: softSteer bumps epoch; superseded stays false unless
  // cancel races after the bump. Orchestrate honors softSteer.superseded so
  // Stop during soft-steer never starts a turn (see orchestrateBotTurn.test.ts).
  resetSoftSteerStateForTests();
  const map: AbortControllerMap = new Map();
  const before = getSoftSteerEpoch('bot_empty');
  cancelSoftSteers('bot_empty');
  assert.ok(getSoftSteerEpoch('bot_empty') > before);
  const result = await softSteerNewestRun({ abortControllers: map }, 'bot_empty');
  assert.equal(result.steered, false);
  // softSteer itself bumped after Stop; current === its own epoch → not superseded here.
  assert.equal(result.superseded, false);
}

{
  // Regression: busy + soft-steer → owner stays busy through abort+unregister
  // until replacement registerOwnerRun (no idle flash in the gap).
  resetOwnerRunQueuesForTests();
  resetSoftSteerStateForTests();
  const map: AbortControllerMap = new Map();
  const c1 = new AbortController();
  registerOwnerRun(map, 'bot_busy', 'run_a', c1);
  assert.deepEqual(listBusyOwnerIds(map), ['bot_busy']);
  assert.equal(ownerHasBusyHold('bot_busy'), false);

  const samples: string[][] = [];
  const steerPromise = softSteerNewestRun({ abortControllers: map }, 'bot_busy');
  // Abort lands quickly; poll busy while waiting for unregister.
  for (let i = 0; i < 5; i++) {
    samples.push(listSoftSteerAwareBusyOwnerIds(map));
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(c1.signal.aborted, true);
  assert.equal(ownerHasBusyHold('bot_busy'), true, 'hold must be set before unregister');

  unregisterOwnerRun(map, 'bot_busy', 'run_a', c1);
  // Gap: no AbortController registered, but soft-steer hold keeps owner busy.
  assert.equal(listOwnerRunIds(map, 'bot_busy').length, 0);
  assert.deepEqual(
    listBusyOwnerIds(map),
    ['bot_busy'],
    'must stay busy after unregister, before replacement register',
  );
  for (const snap of samples) {
    assert.ok(snap.includes('bot_busy'), `busy sample missing owner: ${JSON.stringify(snap)}`);
  }

  const result = await steerPromise;
  assert.equal(result.steered, true);
  assert.equal(result.superseded, false);
  assert.deepEqual(listBusyOwnerIds(map), ['bot_busy'], 'hold remains until register');

  const c2 = new AbortController();
  registerOwnerRun(map, 'bot_busy', 'run_b', c2);
  assert.equal(ownerHasBusyHold('bot_busy'), false, 'register clears soft-steer hold');
  assert.deepEqual(listBusyOwnerIds(map), ['bot_busy'], 'replacement run keeps busy');
  unregisterOwnerRun(map, 'bot_busy', 'run_b', c2);
  assert.deepEqual(listBusyOwnerIds(map), [], 'idle only after replacement finishes');
}

{
  // Superseded soft-steer must not leave a stuck busy hold.
  resetOwnerRunQueuesForTests();
  resetSoftSteerStateForTests();
  const map: AbortControllerMap = new Map();
  const c1 = new AbortController();
  registerOwnerRun(map, 'bot_sup', 'run_1', c1);
  const pending = softSteerNewestRun({ abortControllers: map }, 'bot_sup');
  await new Promise((r) => setTimeout(r, 5));
  cancelSoftSteers('bot_sup');
  unregisterOwnerRun(map, 'bot_sup', 'run_1', c1);
  const result = await pending;
  assert.equal(result.superseded, true);
  assert.equal(ownerHasBusyHold('bot_sup'), false);
  assert.deepEqual(listBusyOwnerIds(map), []);
}


{
  // Soft-steer cancels host auto-continue so a racing AC kick cannot start.
  resetSoftSteerStateForTests();
  resetAutoContinueStateForTests();
  resetOwnerRunQueuesForTests();
  const map: AbortControllerMap = new Map();
  const c1 = new AbortController();
  registerOwnerRun(map, 'bot_ac', 'run_ac', c1);
  assert.equal(isAutoContinueCancelled('bot_ac'), false);
  const pending = softSteerNewestRun({ abortControllers: map }, 'bot_ac');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(isAutoContinueCancelled('bot_ac'), true, 'soft-steer must cancelAutoContinues');
  assert.equal(c1.signal.aborted, true);
  unregisterOwnerRun(map, 'bot_ac', 'run_ac', c1);
  await pending;
  resetAutoContinueStateForTests();
}

console.log('softSteerGate.test.ts OK');
