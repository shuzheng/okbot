import assert from 'node:assert/strict';
import {
  createMaintenanceCounters,
  planPostTurnMaintenance,
  resetMaintenanceCountersForTests,
  userAskedToRemember,
} from './maintenanceSchedule';
import { DEFAULT_MAINTENANCE_SETTINGS } from '@okbot/shared';

resetMaintenanceCountersForTests();

assert.equal(userAskedToRemember('请记住我喜欢绿茶'), true);
assert.equal(userAskedToRemember('别忘了明天开会'), true);
assert.equal(userAskedToRemember('Please remember my timezone'), true);
assert.equal(userAskedToRemember('好的谢谢'), false);
assert.equal(userAskedToRemember('remembrance day'), false);

{
  // Memory always runs (no every-N / chars gate); SOUL/skills still throttled.
  const c = createMaintenanceCounters();
  const a = planPostTurnMaintenance({
    settings: DEFAULT_MAINTENANCE_SETTINGS,
    counters: c,
    userText: '好的',
  });
  assert.equal(a.runMemory, true);
  assert.equal(a.runSoul, false);
  assert.equal(a.runSkills, false);
  assert.equal(c.turnsSince.memory, 0);
  assert.equal(c.turnsSince.soul, 1);

  const b = planPostTurnMaintenance({
    settings: DEFAULT_MAINTENANCE_SETTINGS,
    counters: c,
    userText: '嗯',
  });
  assert.equal(b.runMemory, true);
  assert.equal(b.runSoul, false);
  assert.equal(b.runSkills, false);
  assert.equal(c.turnsSince.soul, 2);
}

{
  // Short or long user text: memory still always true; not gated by chars.
  const c = createMaintenanceCounters();
  const short = planPostTurnMaintenance({
    settings: DEFAULT_MAINTENANCE_SETTINGS,
    counters: c,
    userText: 'x',
  });
  assert.equal(short.runMemory, true);
  const long = planPostTurnMaintenance({
    settings: { ...DEFAULT_MAINTENANCE_SETTINGS, memoryEveryUserChars: 99999 },
    counters: c,
    userText: 'y'.repeat(10),
  });
  assert.equal(long.runMemory, true);
}

{
  // Deprecated memoryEveryTurns=50 must not suppress memory.
  const c = createMaintenanceCounters();
  const a = planPostTurnMaintenance({
    settings: { ...DEFAULT_MAINTENANCE_SETTINGS, memoryEveryTurns: 50 },
    counters: c,
    userText: 'ok',
  });
  assert.equal(a.runMemory, true);
}

{
  const c = createMaintenanceCounters();
  for (let i = 0; i < 4; i++) {
    planPostTurnMaintenance({
      settings: DEFAULT_MAINTENANCE_SETTINGS,
      counters: c,
      userText: 'ok',
    });
  }
  const fifth = planPostTurnMaintenance({
    settings: DEFAULT_MAINTENANCE_SETTINGS,
    counters: c,
    userText: 'ok',
  });
  assert.equal(fifth.runSoul, true);
  assert.equal(fifth.runSkills, true);
  assert.equal(fifth.runMemory, true);
}

console.log('maintenanceSchedule.test.ts: ok');
