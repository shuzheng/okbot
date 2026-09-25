import assert from 'node:assert/strict';
import { allocateAskToolNames } from './squad.js';

{
  const names = allocateAskToolNames([
    { name: 'member', botId: 'bot_a' },
    { name: 'member', botId: 'bot_b' },
  ]);
  assert.deepEqual(names, ['ask_member', 'ask_member_2']);
}

{
  const names = allocateAskToolNames([
    { name: 'Alice', botId: 'bot_1' },
    { name: 'alice', botId: 'bot_2' },
    { name: 'Bob', botId: 'bot_3' },
  ]);
  assert.deepEqual(names, ['ask_alice', 'ask_alice_2', 'ask_bob']);
}

console.log('allocateAskToolNames.test.ts: ok');
