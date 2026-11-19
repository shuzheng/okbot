import assert from 'node:assert/strict';
import { Agent, RunState, Runner, Usage, setTracingDisabled, tool, UserError } from '@openai/agents';
import { z } from 'zod';

setTracingDisabled(true);

const fakeModel = {
  async getResponse() {
    return {
      usage: new Usage({ inputTokens: 3, outputTokens: 2, totalTokens: 5 }),
      output: [
        {
          type: 'function_call',
          callId: 'call_1',
          name: 'do_thing',
          status: 'completed',
          arguments: JSON.stringify({ x: 'hi' }),
        },
      ],
    };
  },
  async *getStreamedResponse() {},
};

const doThing = tool({
  name: 'do_thing',
  description: 'do a thing',
  parameters: z.object({ x: z.string() }),
  needsApproval: true,
  execute: async ({ x }) => `done:${x}`,
});

const agent = new Agent({
  name: 'restore-test',
  instructions: 'You are a test agent.',
  model: fakeModel,
  tools: [doThing],
});

const runner = new Runner({ modelProvider: { getModel: () => fakeModel } });
const result = await runner.run(agent, 'please do the thing', { maxTurns: 5, stream: false });
const serialized = result.state.toString();
const parsed = JSON.parse(serialized) as { $schemaVersion: string };
assert.equal(typeof parsed.$schemaVersion, 'string');
assert.match(parsed.$schemaVersion, /^1\.\d+$/);

{
  const restored = await RunState.fromString(agent, serialized);
  const interruptions = restored.getInterruptions();
  assert.equal(interruptions.length, 1);
  const item = interruptions[0] as { toolName?: string; rawItem?: { name?: string } };
  assert.equal(item.rawItem?.name ?? item.toolName, 'do_thing');
}

{
  // 0.18 wrote schema 1.20; 0.22 still lists 1.0–1.24 as readable.
  const labeled = JSON.stringify({ ...parsed, $schemaVersion: '1.20' });
  const restored = await RunState.fromString(agent, labeled);
  assert.equal(restored.getInterruptions().length, 1);
}

{
  await assert.rejects(
    () => RunState.fromString(agent, JSON.stringify({ $schemaVersion: '99.0' })),
    (err: unknown) => {
      assert.ok(err instanceof UserError, 'unsupported schema must throw UserError');
      assert.match(String(err.message), /is not supported/);
      return true;
    },
  );
}

{
  await assert.rejects(
    () => RunState.fromString(agent, JSON.stringify({ foo: 1 })),
    (err: unknown) => {
      assert.ok(err instanceof UserError, 'missing schema version must throw UserError');
      assert.match(String(err.message), /missing schema version/);
      return true;
    },
  );
}

{
  await assert.rejects(() => RunState.fromString(agent, 'not-json'), (err: unknown) => {
    assert.ok(err instanceof UserError, 'invalid JSON must throw UserError');
    assert.match(String(err.message), /Failed to parse run state/);
    return true;
  });
}

console.log('runStateRestore.test.ts: ok');
