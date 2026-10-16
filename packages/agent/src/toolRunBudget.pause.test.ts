import assert from 'node:assert/strict';
import { ToolRunBudget, wrapToolExecute } from './toolRunBudget.ts';

const controller = new AbortController();
const budget = new ToolRunBudget(controller);
budget.start();
budget.pauseDuration();
budget.resumeDuration();
assert.equal(budget.isDurationPaused(), false);
assert.equal(budget.toolCallCount, 0);

let ran = 0;
const exec = wrapToolExecute('noop', budget, async () => {
  ran += 1;
  return 'ok';
});
assert.equal(await exec({}), 'ok');
assert.equal(ran, 1);
assert.equal(budget.toolCallCount, 1);

// Many tool calls must never circuit-break.
for (let i = 0; i < 60; i++) {
  await exec({});
}
assert.equal(budget.toolCallCount, 61);
assert.equal(controller.signal.aborted, false);
budget.dispose();
console.log('toolRunBudget.pause.test.ts OK');
