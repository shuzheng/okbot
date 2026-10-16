/**
 * RunState checkpoint serialization needs Responses-shaped ModelItems.
 */
import assert from 'node:assert/strict';
import { normalizeAgentInputItemForRunState } from './dist/text.js';

const plain = normalizeAgentInputItemForRunState({
  type: 'message',
  role: 'assistant',
  content: 'hello',
});
assert.deepEqual(plain.content, [{ type: 'output_text', text: 'hello' }]);
assert.equal(plain.status, 'completed');

const already = {
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text: 'ok' }],
};
assert.equal(normalizeAgentInputItemForRunState(already), already);

const missingStatus = normalizeAgentInputItemForRunState({
  type: 'message',
  role: 'assistant',
  content: [{ type: 'output_text', text: 'x' }],
});
assert.equal(missingStatus.status, 'completed');
assert.notEqual(missingStatus, already);

const reasoning = normalizeAgentInputItemForRunState({
  type: 'reasoning',
  content: 'why',
});
assert.deepEqual(reasoning.content, [{ type: 'input_text', text: 'why' }]);

const system = normalizeAgentInputItemForRunState({
  role: 'system',
  content: [{ type: 'input_text', text: 'a' }, { type: 'input_text', text: 'b' }],
});
assert.equal(system.content, 'ab');

const user = { type: 'message', role: 'user', content: 'hi' };
assert.equal(normalizeAgentInputItemForRunState(user), user);

const bareParts = normalizeAgentInputItemForRunState({
  type: 'message',
  role: 'assistant',
  content: ['plain'],
});
assert.deepEqual(bareParts.content, [{ type: 'output_text', text: 'plain' }]);
assert.equal(bareParts.status, 'completed');

console.log('normalizeAgentInputItem.test.mjs: ok');
