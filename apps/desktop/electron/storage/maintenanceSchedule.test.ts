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
  const c = createMaintenanceCounters();
  const a = planPostTurnMaintenance({
    settings: DEFAULT_MAINTENANCE_SETTINGS,
    counters: c,
    userText: '好的',
  });
  assert.equal(a.runMemory, false);
  assert.equal(a.runAgents, false);
  assert.equal(a.runSkills, false);
  assert.equal(c.turnsSince.memory, 1);

  const b = planPostTurnMaintenance({
    settings: DEFAULT_MAINTENANCE_SETTINGS,
    counters: c,
    userText: '嗯',
  });
  // memoryEveryTurns default 2 → second short turn runs memory only
  assert.equal(b.runMemory, true);
  assert.equal(b.runAgents, false);
  assert.equal(b.runSkills, false);
  assert.equal(c.turnsSince.memory, 0);
  assert.equal(c.turnsSince.agents, 2);
}

{
  const c = createMaintenanceCounters();
  const long = 'x'.repeat(400);
  const a = planPostTurnMaintenance({
    settings: DEFAULT_MAINTENANCE_SETTINGS,
    counters: c,
    userText: long,
  });
  assert.equal(a.runMemory, true);
  assert.equal(a.runAgents, false);
}

{
  const c = createMaintenanceCounters();
  const a = planPostTurnMaintenance({
    settings: DEFAULT_MAINTENANCE_SETTINGS,
    counters: c,
    userText: '请记住门牌号是 42',
  });
  assert.equal(a.runMemory, true);
  assert.equal(a.runAgents, false);
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
  assert.equal(fifth.runAgents, true);
  assert.equal(fifth.runSkills, true);
}

console.log('maintenanceSchedule.test.ts: ok');
