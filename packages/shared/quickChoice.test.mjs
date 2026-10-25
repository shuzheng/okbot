import assert from 'node:assert/strict';
import { normalizeQuickChoice, QUICK_CHOICE_MAX_OPTIONS } from './dist/index.js';

assert.equal(normalizeQuickChoice(null), null);
assert.equal(normalizeQuickChoice({ question: '', options: ['a', 'b'] }), null);
// Fewer than two distinct usable options → no card.
assert.equal(normalizeQuickChoice({ question: 'Q', options: ['a', ' a ', '', 3] }), null);

const ok = normalizeQuickChoice({
  question: '  我主要帮你做什么？ ',
  options: ['写代码', '写  代码', '查资料', '  先聊一聊 '],
});
assert.deepEqual(ok, { question: '我主要帮你做什么？', options: ['写代码', '写 代码', '查资料', '先聊一聊'] });

const many = normalizeQuickChoice({ question: 'Q', options: Array.from({ length: 10 }, (_, i) => `o${i}`) });
assert.equal(many.options.length, QUICK_CHOICE_MAX_OPTIONS);
assert.equal(normalizeQuickChoice({ question: 'Q', options: ['x'.repeat(100), 'y'] }).options[0].length, 60);

console.log('quickChoice.test.mjs: ok');
