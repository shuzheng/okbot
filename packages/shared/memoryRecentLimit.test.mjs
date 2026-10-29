import assert from 'node:assert/strict';
import {
  normalizeMaxTurns,
  normalizeMemoryRecentLimit,
  MAX_MEMORY_RECENT_MESSAGE_LIMIT,
} from './dist/index.js';

assert.equal(normalizeMaxTurns(300), 100);
assert.equal(normalizeMemoryRecentLimit(300), 300);
assert.equal(normalizeMemoryRecentLimit(9999), MAX_MEMORY_RECENT_MESSAGE_LIMIT);
assert.equal(normalizeMemoryRecentLimit(0), 1);
assert.equal(normalizeMemoryRecentLimit(null, 2), 2);

console.log('memoryRecentLimit.test.mjs: ok');
