/**
 * wrapToolExecute: onBeforeToolExecute fires for normal tools, skipped for send_message.
 */
import assert from 'node:assert/strict';
import {
  TOOLS_SEAL_THEMSELVES,
  ToolRunBudget,
  wrapToolExecute,
} from './toolRunBudget.js';

const controller = new AbortController();
const budget = new ToolRunBudget(controller);
const calls: string[] = [];

const onBefore = async () => {
  calls.push('before');
};

{
  calls.length = 0;
  const exec = wrapToolExecute(
    'web_fetch',
    budget,
    async () => 'ok',
    onBefore,
  );
  assert.equal(await exec({}), 'ok');
  assert.deepEqual(calls, ['before']);
}

{
  calls.length = 0;
  const exec = wrapToolExecute(
    'send_message',
    budget,
    async () => 'sent',
    onBefore,
  );
  assert.equal(await exec({}), 'sent');
  assert.deepEqual(calls, [], 'send_message must skip onBeforeToolExecute');
}

{
  assert.equal(TOOLS_SEAL_THEMSELVES.has('send_message'), true);
  assert.equal(TOOLS_SEAL_THEMSELVES.has('ask_assistant'), true);
  assert.equal(TOOLS_SEAL_THEMSELVES.has('web_fetch'), false);
}

console.log('toolRunBudget.beforeTool.test.ts: ok');
