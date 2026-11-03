import assert from 'node:assert/strict';
import { normalizeMessageReaction, DEFAULT_REACTION_EMOJIS } from './dist/chat.js';

assert.equal(DEFAULT_REACTION_EMOJIS.length, 5);
assert.equal(normalizeMessageReaction(null), undefined);
assert.equal(normalizeMessageReaction({ emoji: '👍', from: 'user' })?.from, 'user');
assert.equal(normalizeMessageReaction({ emoji: '❤️', from: 'assistant' })?.emoji, '❤️');
assert.equal(normalizeMessageReaction({ emoji: '', from: 'user' }), undefined);
assert.equal(normalizeMessageReaction({ emoji: 'x', from: 'nope' }), undefined);
console.log('messageReaction.test.mjs: ok');
