import assert from 'node:assert/strict';
import {
  classifyBusyIntent,
  classifyBusyIntentFallback,
  classifyBusyIntentHeuristic,
} from './classifyBusyIntent.js';

{
  assert.equal(
    classifyBusyIntentHeuristic({ newUserText: '继续', activeRunCount: 1 }),
    'supplement',
  );
  assert.equal(
    classifyBusyIntentHeuristic({ newUserText: '改成用 TypeScript', activeRunCount: 1 }),
    'supplement',
  );
  assert.equal(
    classifyBusyIntentHeuristic({
      newUserText: '另一个问题：明天天气怎么样',
      activeRunCount: 1,
    }),
    'new_task',
  );
  assert.equal(
    classifyBusyIntentHeuristic({
      newUserText: '补充一点：也要写测试',
      activeRunCount: 2,
    }),
    'supplement',
  );
  assert.equal(
    classifyBusyIntentHeuristic({
      newUserText: '路径改成 /tmp/out',
      activeRunCount: 1,
      hasQuote: true,
    }),
    'supplement',
  );
  assert.equal(
    classifyBusyIntentHeuristic({
      newUserText: '请帮我调研一下竞品定价策略并给一张对比表',
      activeRunCount: 1,
    }),
    null,
    'long distinct ask without markers stays ambiguous',
  );
}

{
  assert.equal(classifyBusyIntentFallback(1), 'supplement');
  assert.equal(classifyBusyIntentFallback(0), 'supplement');
  assert.equal(classifyBusyIntentFallback(3), 'new_task');
}

{
  const intent = await classifyBusyIntent({
    newUserText: '继续',
    activeRunCount: 1,
  });
  assert.equal(intent, 'supplement');
}

{
  const intent = await classifyBusyIntent({
    newUserText: '另一个问题：帮我写一首诗',
    activeRunCount: 2,
  });
  assert.equal(intent, 'new_task');
}

{
  // No model + ambiguous → fail-open by active count
  const one = await classifyBusyIntent({
    newUserText: '请帮我调研一下竞品定价策略并给一张对比表',
    activeRunCount: 1,
  });
  assert.equal(one, 'supplement');
  const many = await classifyBusyIntent({
    newUserText: '请帮我调研一下竞品定价策略并给一张对比表',
    activeRunCount: 2,
  });
  assert.equal(many, 'new_task');
}

console.log('classifyBusyIntent.test.ts OK');
