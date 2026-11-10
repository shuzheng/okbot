/**
 * withResolvedExtraTools: buildExtraTools runs only after onBeforeToolExecute exists,
 * so MCP can share the mid-turn seal/reset (same contract as runAgentChat).
 */
import assert from 'node:assert/strict';
import { withResolvedExtraTools } from './squad.js';
import type { Tool } from '@openai/agents';

const fakeTool = { name: 'mcp_probe' } as unknown as Tool;

{
  // Without onBeforeToolExecute, builder must not run (bare list stays unresolved).
  let called = 0;
  const out = await withResolvedExtraTools({
    buildExtraTools: async () => {
      called += 1;
      return [fakeTool];
    },
  });
  assert.equal(called, 0);
  assert.equal(out.extraTools, undefined);
  assert.equal(typeof out.buildExtraTools, 'function');
}

{
  const hooks: string[] = [];
  const onBefore = async () => {
    hooks.push('before');
  };
  const out = await withResolvedExtraTools({
    onBeforeToolExecute: onBefore,
    toolRunBudget: undefined,
    buildExtraTools: async ({ onBeforeToolExecute, toolRunBudget }) => {
      assert.equal(onBeforeToolExecute, onBefore);
      assert.equal(toolRunBudget, undefined);
      await onBeforeToolExecute();
      return [fakeTool];
    },
  });
  assert.deepEqual(hooks, ['before']);
  assert.equal(out.buildExtraTools, undefined);
  assert.equal(out.extraTools?.length, 1);
  assert.equal(out.extraTools?.[0], fakeTool);
}

{
  // Merges with any pre-existing extraTools.
  const prior = { name: 'prior' } as unknown as Tool;
  const out = await withResolvedExtraTools({
    extraTools: [prior],
    onBeforeToolExecute: async () => {},
    buildExtraTools: async () => [fakeTool],
  });
  assert.deepEqual(
    (out.extraTools ?? []).map((t) => (t as { name: string }).name),
    ['prior', 'mcp_probe'],
  );
}

console.log('squad.extraTools.test.ts: ok');
