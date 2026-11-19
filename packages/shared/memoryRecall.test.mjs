import assert from 'node:assert/strict';
import { computeMemoryInjectionScore, scoreMemoryRelevance, selectMemoriesForPrompt } from './dist/memoryRecall.js';

assert.ok(scoreMemoryRelevance('用户偏好中文回复', '中文 偏好') > 0.3);

const result = selectMemoriesForPrompt(
  [
    { id: 'g1', memory: '用户叫张三', tier: 'durable', hits: 1 },
    { id: 'g2', memory: '临时笔记候选', tier: 'candidate', hits: 0 },
  ],
  [
    { id: 'b1', memory: '本助手用简体中文', tier: 'durable', hits: 5 },
    { id: 'b2', memory: '钉住的候选', tier: 'candidate', pinned: true, hits: 0 },
    { id: 'b3', memory: '无关英语偏好', tier: 'durable', hits: 100 },
  ],
  { maxEntries: 3, maxChars: 10_000, query: '中文 简体' },
);

const ids = new Set(result.selectedIds);
assert.ok(!ids.has('g2'), 'unpinned candidate excluded from injection');
assert.ok(ids.has('b2'), 'pinned candidate included');
assert.equal(result.selectedIds.length <= 3, true);
assert.ok(ids.has('b1') || ids.has('g1'));
assert.ok(Array.isArray(result.softHitIds), 'softHitIds present');

// P2: keyword-matching unpinned candidate earns softHit, not injection.
{
  const soft = selectMemoriesForPrompt(
    [{ id: 'c1', memory: '用户喜欢喝美式咖啡', tier: 'candidate', hits: 0 }],
    [{ id: 'd1', memory: '办公地点在上海', tier: 'durable', hits: 2 }],
    { maxEntries: 8, maxChars: 10_000, query: '美式咖啡' },
  );
  assert.ok(!soft.selectedIds.includes('c1'), 'candidate not injected');
  assert.ok(soft.softHitIds.includes('c1'), 'candidate soft-hit on keyword match');
  assert.ok(soft.selectedIds.includes('d1'));
}

// No query → no soft hits.
{
  const none = selectMemoriesForPrompt(
    [{ id: 'c1', memory: '用户喜欢喝美式咖啡', tier: 'candidate', hits: 0 }],
    [],
    { maxEntries: 8, maxChars: 10_000 },
  );
  assert.deepEqual(none.softHitIds, []);
}

const capped = selectMemoriesForPrompt(
  Array.from({ length: 30 }, (_, i) => ({
    id: `g${i}`,
    memory: `global-fact-${i}`,
    tier: 'durable',
    hits: i,
  })),
  [],
  { maxEntries: 16, maxChars: 100_000 },
);
assert.equal(capped.selectedIds.length, 16);
assert.deepEqual(capped.softHitIds, []);


{
  const base = {
    memory: '用户喜欢简体中文',
    hits: 2,
    scope: 'bot',
    createdAt: '2020-01-01T00:00:00.000Z',
  };
  const standing = computeMemoryInjectionScore(base);
  // No query → R=0; score = 0 + 0 + 3*2 + 0 + T (T in (0, 1])
  assert.ok(standing >= 6 && standing < 7, 'standing score is 3H + T with R=0');
  const withQuery = computeMemoryInjectionScore({ ...base, query: '简体中文' });
  assert.ok(withQuery > standing + 10, 'query relevance increases score via 100R');
  const pinned = computeMemoryInjectionScore({ ...base, pinned: true });
  assert.ok(pinned >= 1_000_000, 'pinned adds P=1e6');
  const globalRow = computeMemoryInjectionScore({ ...base, scope: 'global' });
  assert.ok(Math.abs(globalRow - standing - 1) < 1e-9, 'global adds G=1');
}

console.log('memoryRecall.test.mjs: ok');
