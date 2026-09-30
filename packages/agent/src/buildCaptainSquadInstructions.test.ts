import assert from 'node:assert/strict';
import { emptyTokenUsage, type TokenUsage } from '@okbot/shared';
import {
  buildCaptainSquadInstructions,
  recordMemberTokenUsage,
  type SquadMemberAgentSpec,
} from './squad.js';
import { DEFAULT_TOOL_PREFERENCES } from '@okbot/shared';

const members: SquadMemberAgentSpec[] = [
  {
    botId: 'bot_a',
    name: 'Alice',
    description: 'research',
    role: '调研',
  },
  {
    botId: 'bot_b',
    name: 'Bob',
    description: 'code',
    role: '工程',
  },
];

{
  const text = buildCaptainSquadInstructions({
    squadName: '测试小队',
    squadDescription: 'desc',
    persona: 'persona',
    playbook: 'playbook',
    members,
    askToolNames: ['ask_alice', 'ask_bob'],
    prefs: DEFAULT_TOOL_PREFERENCES,
    history: [],
  });
  assert.match(text, /并行/);
  assert.match(text, /ask_alice/);
  assert.match(text, /ask_bob/);
  assert.doesNotMatch(text, /一次只调用一名/);
  assert.doesNotMatch(text, /V1 请串行/);
  assert.doesNotMatch(text, /你可以串行调用/);
}

{
  const state: { acc: TokenUsage; byBot: Record<string, TokenUsage> } = {
    acc: emptyTokenUsage(),
    byBot: {},
  };
  recordMemberTokenUsage(state, 'bot_a', { input: 10, output: 2, cache: 1 });
  recordMemberTokenUsage(state, 'bot_b', { input: 5, output: 3, cache: 0 });
  recordMemberTokenUsage(state, 'bot_a', { input: 1, output: 1, cache: 1 });
  assert.deepEqual(state.acc, { input: 16, output: 6, cache: 2 });
  assert.deepEqual(state.byBot.bot_a, { input: 11, output: 3, cache: 2 });
  assert.deepEqual(state.byBot.bot_b, { input: 5, output: 3, cache: 0 });
}

console.log('buildCaptainSquadInstructions.test.ts: ok');
