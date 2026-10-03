import assert from 'node:assert/strict';
import { ToolRunBudget } from './toolRunBudget.ts';

const controller = new AbortController();
const budget = new ToolRunBudget({ maxToolCalls: 10, maxDurationSec: 60 }, controller);
budget.start();
budget.pauseDuration();
budget.pauseDuration();
budget.resumeDuration();
assert.equal(budget.isDurationPaused(), true, 'second waiter still holds the pause');
budget.resumeDuration();
assert.equal(budget.isDurationPaused(), false, 'clock resumes only after the last waiter');
budget.dispose();
assert.equal(controller.signal.aborted, false);
console.log('toolRunBudget.pause.test.ts OK');
