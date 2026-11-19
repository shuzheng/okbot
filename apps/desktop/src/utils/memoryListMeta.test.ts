import assert from 'node:assert/strict';
import {
  formatMemoryScore,
  lastUserQueryText,
  memoryListTimestamp,
} from './memoryListMeta';

assert.equal(memoryListTimestamp({ lastHitAt: '2026-11-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }), '2026-11-01T00:00:00.000Z');
assert.equal(memoryListTimestamp({ lastHitAt: null, createdAt: '2026-01-01T00:00:00.000Z' }), '2026-01-01T00:00:00.000Z');
assert.equal(memoryListTimestamp({ createdAt: '2026-01-01T00:00:00.000Z' }), '2026-01-01T00:00:00.000Z');
assert.equal(memoryListTimestamp({}), undefined);
assert.equal(memoryListTimestamp({ lastHitAt: '', createdAt: '   ' }), undefined);

assert.equal(formatMemoryScore(6), '6');
assert.equal(formatMemoryScore(6.04), '6');
assert.equal(formatMemoryScore(12.56), '12.6');
assert.equal(formatMemoryScore(Number.NaN), '0');

assert.equal(
  lastUserQueryText([
    { role: 'user', content: 'old', autoContinue: true },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: '  latest question  ' },
  ]),
  'latest question',
);
assert.equal(
  lastUserQueryText([
    { role: 'user', content: 'hidden', autoContinue: true },
    { role: 'assistant', content: 'ok' },
  ]),
  undefined,
);
assert.equal(lastUserQueryText([]), undefined);

console.log('memoryListMeta.test.ts: ok');
