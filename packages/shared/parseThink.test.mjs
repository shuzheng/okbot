import assert from 'node:assert/strict';
import {
  parseThinkContent,
  stripThinkContent,
  redactSensitiveText,
  normalizeTokenUsage,
} from './dist/index.js';

const fenced = '见示例：\n```\n<think>not real</think>\n```\n正文';
const p1 = parseThinkContent(fenced);
assert.equal(p1.hasThinking, false);
assert.ok(p1.answer.includes('<think>not real</think>'));

const closed = '前<think>隐</think>后';
const p2 = parseThinkContent(closed);
assert.equal(p2.hasThinking, true);
assert.equal(p2.answer, '前后');
assert.deepEqual(p2.thinking, ['隐']);

const mid = '字面 <think> 不当思考';
const p3 = parseThinkContent(mid);
assert.equal(p3.hasThinking, false);
assert.ok(p3.answer.includes('<think>'));

const standalone = '可见\n<think>\n还在想';
const p4 = parseThinkContent(standalone);
assert.equal(p4.hasThinking, true);
assert.equal(p4.answer, '可见');

assert.equal(stripThinkContent('a<think>x</think>b'), 'ab');

const red = redactSensitiveText('fail Bearer sk-abcdefghijklmnopqrst key sk-abcdefghijklmnop');
assert.ok(!red.includes('sk-abcdefghijklmnop'));
assert.ok(red.includes('Bearer ***'));

assert.deepEqual(normalizeTokenUsage({ input: 1 }), { input: 1, output: 0, cache: 0 });
assert.equal(normalizeTokenUsage({ input: -1 }), undefined);
assert.deepEqual(normalizeTokenUsage({ input: 0, output: 0, cache: 0 }), {
  input: 0,
  output: 0,
  cache: 0,
});

console.log('parseThink/redact/normalizeTokenUsage ok');
