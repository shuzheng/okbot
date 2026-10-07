import type { TokenUsage } from '@okbot/shared';
import { emptyTokenUsage, addTokenUsage } from '@okbot/shared';
import type { Usage } from '@openai/agents';

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Sum cached/prompt-cache tokens from SDK usage detail bags. */
function cacheFromDetails(details: unknown): number {
  let cache = 0;
  const readOne = (d: Record<string, unknown>) => {
    cache += num(
      d.cached_tokens ??
        d.cachedTokens ??
        d.cache_read_input_tokens ??
        d.cacheReadInputTokens ??
        d.cache_tokens ??
        d.prompt_cache_hit_tokens ??
        d.promptCacheHitTokens ??
        d.prompt_cache_hit_token_count,
    );
  };
  if (Array.isArray(details)) {
    for (const item of details) {
      if (item && typeof item === 'object') readOne(item as Record<string, unknown>);
    }
  } else if (details && typeof details === 'object') {
    readOne(details as Record<string, unknown>);
  }
  return cache;
}

/**
 * Map Agents SDK `Usage` (or a loose result with `.state.usage` / `.rawResponses`)
 * into OkBot TokenUsage { input, output, cache }.
 */
export function tokenUsageFromSdkUsage(usage: Usage | null | undefined): TokenUsage {
  if (!usage) return emptyTokenUsage();
  const input = num(usage.inputTokens);
  const output = num(usage.outputTokens);
  let cache = cacheFromDetails(usage.inputTokensDetails);
  if (Array.isArray(usage.requestUsageEntries)) {
    for (const entry of usage.requestUsageEntries) {
      cache += cacheFromDetails(entry?.inputTokensDetails);
      // Some gateways put DeepSeek-style fields on the entry itself.
      if (entry && typeof entry === 'object') {
        cache += cacheFromDetails(entry);
      }
    }
  }
  // Loose Usage bags may carry DeepSeek fields at the top level.
  cache += cacheFromDetails(usage as unknown as Record<string, unknown>);
  return { input, output, cache };
}

/** Best-effort extract from a streamed / final RunResult-like object. */
export function tokenUsageFromRunResult(result: {
  state?: { usage?: Usage };
  runContext?: { usage?: Usage };
  rawResponses?: Array<{ usage?: Usage }>;
} | null | undefined): TokenUsage {
  if (!result) return emptyTokenUsage();
  const fromState = tokenUsageFromSdkUsage(result.state?.usage ?? result.runContext?.usage);
  if (fromState.input || fromState.output || fromState.cache) return fromState;
  let acc = emptyTokenUsage();
  for (const r of result.rawResponses ?? []) {
    acc = addTokenUsage(acc, tokenUsageFromSdkUsage(r.usage));
  }
  return acc;
}

export { emptyTokenUsage, addTokenUsage };
