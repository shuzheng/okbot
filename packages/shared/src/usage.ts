/** Token usage aggregates. */

export interface TokenUsage {
  input: number;
  output: number;
  /** Prompt-cache / cached input tokens when the provider reports them. */
  cache: number;
}

export function emptyTokenUsage(): TokenUsage {
  return { input: 0, output: 0, cache: 0 };
}

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: (a.input || 0) + (b.input || 0),
    output: (a.output || 0) + (b.output || 0),
    cache: (a.cache || 0) + (b.cache || 0),
  };
}

export function normalizeTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const coerce = (v: unknown): number | null => {
    if (v == null || v === '') return 0;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  };
  const input = coerce(src.input);
  const output = coerce(src.output);
  const cache = coerce(src.cache);
  // Reject only when a present field is non-numeric / negative; missing → 0.
  if (input == null || output == null || cache == null) return undefined;
  return { input, output, cache };
}

export interface UsageStats {
  lifetime: TokenUsage;
  /** YYYY-MM-DD → counts (local calendar day). */
  daily: Record<string, TokenUsage>;
  /** botId / squadId → lifetime totals for that conversation owner. */
  byOwner: Record<string, TokenUsage>;
  /** ownerId → YYYY-MM-DD → counts (same retention window as `daily`). */
  dailyByOwner: Record<string, Record<string, TokenUsage>>;
}

export function emptyUsageStats(): UsageStats {
  return { lifetime: emptyTokenUsage(), daily: {}, byOwner: {}, dailyByOwner: {} };
}

function usageTokenMap(raw: unknown): Record<string, TokenUsage> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, TokenUsage> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const usage = normalizeTokenUsage(value);
    if (usage) out[key] = usage;
  }
  return out;
}

/**
 * Coerce a gateway or file payload into the Electron IPC `UsageStats` shape.
 * Missing or non-object token bags become zeros so callers never read `.input` on undefined.
 * Arrays (legacy gateway stubs used `byOwner: []`) are treated as empty maps.
 */
export function normalizeUsageStats(raw: unknown): UsageStats {
  const src =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const dailyByOwner: Record<string, Record<string, TokenUsage>> = {};
  const rawDailyByOwner = src.dailyByOwner;
  if (rawDailyByOwner && typeof rawDailyByOwner === 'object' && !Array.isArray(rawDailyByOwner)) {
    for (const [ownerId, days] of Object.entries(rawDailyByOwner as Record<string, unknown>)) {
      const map = usageTokenMap(days);
      if (Object.keys(map).length > 0) dailyByOwner[ownerId] = map;
    }
  }
  return {
    lifetime: normalizeTokenUsage(src.lifetime) ?? emptyTokenUsage(),
    daily: usageTokenMap(src.daily),
    byOwner: usageTokenMap(src.byOwner),
    dailyByOwner,
  };

}
