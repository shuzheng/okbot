import assert from 'node:assert/strict';
import {
  parseThinkContent,
  stripThinkContent,
  trailingThinkTagPrefix,
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

// Unclosed mid-line open: treat as thinking so raw tags never flash in the bubble.
const mid = '字面 <think> 不当思考';
const p3 = parseThinkContent(mid);
assert.equal(p3.hasThinking, true);
assert.equal(p3.answer, '字面 ');
assert.deepEqual(p3.thinking, ['不当思考']);

const standalone = '可见\n<think>\n还在想';
const p4 = parseThinkContent(standalone);
assert.equal(p4.hasThinking, true);
assert.equal(p4.answer, '可见');

assert.equal(stripThinkContent('a<think>x</think>b'), 'ab');

// Streaming: incomplete open/close tag suffixes must not paint into the answer.
assert.equal(trailingThinkTagPrefix('<think'), '<think');
assert.equal(trailingThinkTagPrefix('<thin'), '<thin');
assert.equal(trailingThinkTagPrefix('</th'), '</th');
assert.equal(trailingThinkTagPrefix('<think>'), '');
assert.equal(trailingThinkTagPrefix('hello'), '');

const streamChunks = ['<', '<t', '<th', '<thi', '<thin', '<think'];
for (const c of streamChunks) {
  const p = parseThinkContent(c);
  assert.equal(p.hasThinking, false, `incomplete ${JSON.stringify(c)} not thinking yet`);
  assert.equal(p.answer, '', `incomplete ${JSON.stringify(c)} held from answer`);
}

const openOnly = parseThinkContent('<think>');
assert.equal(openOnly.hasThinking, true);
assert.equal(openOnly.answer, '');
assert.deepEqual(openOnly.thinking, []);

const openBody = parseThinkContent('<think>xxxxx');
assert.equal(openBody.hasThinking, true);
assert.equal(openBody.answer, '');
assert.deepEqual(openBody.thinking, ['xxxxx']);
assert.ok(!openBody.answer.includes('<think'), 'raw open tag not in answer');

const midStream = parseThinkContent('Hello <think>hid');
assert.equal(midStream.hasThinking, true);
assert.equal(midStream.answer, 'Hello ');
assert.deepEqual(midStream.thinking, ['hid']);

const closePartial = parseThinkContent('<think>xxxxx</thin');
assert.equal(closePartial.hasThinking, true);
assert.equal(closePartial.answer, '');
// Partial close tag held out of thinking body.
assert.deepEqual(closePartial.thinking, ['xxxxx']);

const done = parseThinkContent('<think>xxxxx</think>\nHello');
assert.equal(done.hasThinking, true);
assert.equal(done.answer, 'Hello');
assert.deepEqual(done.thinking, ['xxxxx']);

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

{
  const long = 'x'.repeat(600);
  assert.equal(redactSensitiveText(long).length, 500);
  assert.equal(redactSensitiveText(long, undefined, 240).length, 240);
  assert.equal(redactSensitiveText(long, undefined, 0).length, 500);
}
