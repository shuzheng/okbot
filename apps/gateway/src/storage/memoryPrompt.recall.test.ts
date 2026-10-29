import assert from 'node:assert/strict';
import { selectMemoriesForPrompt } from '@okbot/shared';
import { formatCappedMemoriesForPrompt } from './memoryPrompt';

const selected = selectMemoriesForPrompt(
  [
    { id: 'g1', memory: '用户偏好中文', tier: 'durable', hits: 3 },
    { id: 'g2', memory: '候选不注入', tier: 'candidate', hits: 0 },
  ],
  [{ id: 'b1', memory: '本助手简体', tier: 'durable', hits: 1, pinned: true }],
  { maxEntries: 16, maxChars: 4000, query: '中文' },
);

assert.ok(!selected.selectedIds.includes('g2'));
assert.ok(Array.isArray(selected.softHitIds));
// g2 text has no 中文 overlap → not a soft hit; matching candidate would.
assert.ok(!selected.softHitIds.includes('g2'));

const text = formatCappedMemoriesForPrompt(selected.global, selected.local, {
  maxEntries: 16,
  maxChars: 4000,
});
assert.ok(text.includes('用户偏好中文') || text.includes('本助手简体'));
assert.ok(!text.includes('候选不注入'));

console.log('memoryPrompt.recall.test.ts: ok');
