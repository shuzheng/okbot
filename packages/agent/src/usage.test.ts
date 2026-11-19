import assert from 'node:assert/strict';
import { tokenUsageFromSdkUsage } from './usage.js';
import { Usage } from '@openai/agents';

{
  const usage = {
    inputTokens: 100,
    outputTokens: 20,
    inputTokensDetails: { prompt_cache_hit_tokens: 40 },
  } as unknown as Usage;
  const t = tokenUsageFromSdkUsage(usage);
  assert.equal(t.input, 100);
  assert.equal(t.output, 20);
  assert.equal(t.cache, 40);
}

{
  const usage = {
    inputTokens: 10,
    outputTokens: 2,
    prompt_cache_hit_tokens: 7,
  } as unknown as Usage;
  const t = tokenUsageFromSdkUsage(usage);
  assert.equal(t.cache, 7);
}

{
  // requestUsageEntries + top-level details must not double-count cache.
  const usage = {
    inputTokens: 100,
    outputTokens: 20,
    inputTokensDetails: { cached_tokens: 40 },
    requestUsageEntries: [{ inputTokensDetails: { cached_tokens: 40 } }],
  } as unknown as Usage;
  const t = tokenUsageFromSdkUsage(usage);
  assert.equal(t.cache, 40, 'must not double-count overlapping cache fields');
}

{
  // 0.21+ Usage.inputTokensDetails is an array of TokenDetails (JSON values).
  // Narrow before arithmetic — non-numeric detail values must not leak into cache.
  const usage = {
    inputTokens: 50,
    outputTokens: 8,
    inputTokensDetails: [
      { cached_tokens: 'nope' },
      { cached_tokens: 12 },
    ],
  } as unknown as Usage;
  const t = tokenUsageFromSdkUsage(usage);
  assert.equal(t.input, 50);
  assert.equal(t.output, 8);
  assert.equal(t.cache, 12);
}

{
  const usage = new Usage({
    inputTokens: 100,
    outputTokens: 20,
    inputTokensDetails: { cached_tokens: 40 },
    requestUsageEntries: [{ inputTokens: 100, outputTokens: 20, inputTokensDetails: { cached_tokens: 40 } }],
  });
  const t = tokenUsageFromSdkUsage(usage);
  assert.equal(t.input, 100);
  assert.equal(t.output, 20);
  assert.equal(t.cache, 40, 'SDK Usage instance must not double-count cache');
}

console.log('usage.test.ts: ok');
