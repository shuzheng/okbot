import assert from 'node:assert/strict';
import {
  applyMemoryLifecyclePass,
  desensitizeMemoryText,
  isMemoryInjectable,
  MEMORY_DECAY_ZERO_HIT_MS,
  MEMORY_DURABLE_TOP_N,
  MEMORY_PROMOTE_MIN_HITS,
  shouldDemoteToCandidate,
  shouldPromoteToDurable,
} from './dist/memoryLifecycle.js';

assert.equal(isMemoryInjectable('candidate', false), false);
assert.equal(isMemoryInjectable('candidate', true), true);
assert.equal(isMemoryInjectable('durable', false), true);

assert.equal(
  shouldPromoteToDurable({ tier: 'candidate', hits: MEMORY_PROMOTE_MIN_HITS, pinned: false }),
  true,
);
assert.equal(shouldPromoteToDurable({ tier: 'candidate', hits: 0, pinned: true }), true);
assert.equal(shouldPromoteToDurable({ tier: 'durable', hits: 99, pinned: false }), false);

const old = new Date(Date.now() - MEMORY_DECAY_ZERO_HIT_MS - 1000).toISOString();
assert.equal(
  shouldDemoteToCandidate({
    tier: 'durable',
    hits: 0,
    pinned: false,
    createdAt: old,
    lastHitAt: null,
  }),
  true,
);
assert.equal(
  shouldDemoteToCandidate({
    tier: 'durable',
    hits: 0,
    pinned: true,
    createdAt: old,
    lastHitAt: null,
  }),
  false,
);

const red = desensitizeMemoryText('key sk-abcdefghijklmnopqrstuvwxyz012345 password');
assert.ok(red.includes('sk-***') || red.includes('***'), red);

const { rows, changed } = applyMemoryLifecyclePass([
  {
    id: 'a',
    tier: 'candidate',
    hits: MEMORY_PROMOTE_MIN_HITS,
    pinned: false,
    createdAt: new Date().toISOString(),
    lastHitAt: null,
  },
  {
    id: 'b',
    tier: 'durable',
    hits: 0,
    pinned: false,
    createdAt: old,
    lastHitAt: null,
  },
]);
assert.equal(changed, true);
assert.equal(rows.find((r) => r.id === 'a').tier, 'durable');
assert.equal(rows.find((r) => r.id === 'b').tier, 'candidate');

// P1: durableCount > TOP_N with high hits must NOT thrash (changed every pass).
{
  const now = Date.now();
  const highHit = Array.from({ length: MEMORY_DURABLE_TOP_N + 2 }, (_, i) => ({
    id: `h${i}`,
    tier: 'durable',
    hits: 5,
    pinned: false,
    createdAt: new Date(now - i * 1000).toISOString(),
    lastHitAt: null,
  }));
  let cur = highHit;
  for (let pass = 1; pass <= 3; pass++) {
    const r = applyMemoryLifecyclePass(cur, now);
    assert.equal(
      r.changed,
      false,
      `high-hit over Top-N must be stable on pass ${pass} (got changed=${r.changed})`,
    );
    assert.equal(r.rows.filter((x) => x.tier === 'durable').length, MEMORY_DURABLE_TOP_N + 2);
    cur = r.rows;
  }
}

// P1: excess low-hit durables demote once, then stable (no re-promote thrash).
{
  const now = Date.now();
  const mix = [
    ...Array.from({ length: MEMORY_DURABLE_TOP_N }, (_, i) => ({
      id: `keep${i}`,
      tier: 'durable',
      hits: 5,
      pinned: false,
      createdAt: new Date(now - i * 1000).toISOString(),
      lastHitAt: null,
    })),
    {
      id: 'low1',
      tier: 'durable',
      hits: 0,
      pinned: false,
      createdAt: new Date(now - 50_000).toISOString(),
      lastHitAt: null,
    },
    {
      id: 'low2',
      tier: 'durable',
      hits: 1,
      pinned: false,
      createdAt: new Date(now - 40_000).toISOString(),
      lastHitAt: null,
    },
  ];
  const pass1 = applyMemoryLifecyclePass(mix, now);
  assert.equal(pass1.changed, true);
  assert.equal(pass1.rows.filter((x) => x.tier === 'durable').length, MEMORY_DURABLE_TOP_N);
  assert.equal(pass1.rows.find((x) => x.id === 'low1').tier, 'candidate');
  assert.equal(pass1.rows.find((x) => x.id === 'low2').tier, 'candidate');
  // Demoted with hits < PROMOTE_MIN must NOT re-promote next pass.
  const pass2 = applyMemoryLifecyclePass(pass1.rows, now);
  assert.equal(pass2.changed, false);
  assert.equal(pass2.rows.find((x) => x.id === 'low1').tier, 'candidate');
  assert.equal(pass2.rows.find((x) => x.id === 'low2').tier, 'candidate');
}

console.log('memoryLifecycle.test.mjs: ok');
