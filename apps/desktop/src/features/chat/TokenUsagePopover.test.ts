import assert from 'node:assert/strict';
import { deriveRoundUsage, formatTokCount } from './TokenUsagePopover';

{
  const d = deriveRoundUsage({ input: 33489, output: 132, cache: 0 });
  assert.equal(d.total, 33621);
  assert.equal(d.uncachedInput, 33489);
  assert.equal(d.cacheRead, 0);
  assert.equal(d.output, 132);
  assert.equal(d.cacheHitPct, 0);
  assert.equal(d.hasData, true);
  assert.equal(formatTokCount(d.total), '33,621 tok');
}

{
  const d = deriveRoundUsage({ input: 100, output: 20, cache: 40 });
  assert.equal(d.uncachedInput, 60);
  assert.equal(d.cacheRead, 40);
  assert.equal(d.cacheHitPct, 40);
  assert.equal(d.total, 120);
}

{
  const d = deriveRoundUsage(undefined);
  assert.equal(d.hasData, false);
  assert.equal(d.total, 0);
  assert.equal(formatTokCount(0), '0 tok');
}

console.log('TokenUsagePopover.test.ts: ok');
