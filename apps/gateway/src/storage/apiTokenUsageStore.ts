import path from 'node:path';
import {
  addTokenUsage,
  emptyTokenUsage,
  normalizeTokenUsage,
  totalTokensUsed,
  type TokenUsage,
} from '@okbot/shared';
import { ensureDir, readJsonResult, handleCorruptJsonRead, writeJson } from './fs';
import { localUsageDay, pruneUsageDaily, USAGE_DAILY_RETENTION_DAYS } from './usageStore';

/** Per-owner counters for one API token (messages + model tokens). */
export type ApiTokenOwnerCounters = {
  messages: number;
  tokens: TokenUsage;
};

export type ApiTokenUsageBucket = {
  lifetime: ApiTokenOwnerCounters;
  /** YYYY-MM-DD → counters */
  daily: Record<string, ApiTokenOwnerCounters>;
  /** botId / squadId → lifetime counters for chats started with this API token */
  byOwner: Record<string, ApiTokenOwnerCounters>;
  /** ownerId → YYYY-MM-DD → counters */
  dailyByOwner: Record<string, Record<string, ApiTokenOwnerCounters>>;
};

export type ApiTokenUsageStats = {
  byTokenId: Record<string, ApiTokenUsageBucket>;
};

export function emptyApiTokenOwnerCounters(): ApiTokenOwnerCounters {
  return { messages: 0, tokens: emptyTokenUsage() };
}

export function emptyApiTokenUsageBucket(): ApiTokenUsageBucket {
  return { lifetime: emptyApiTokenOwnerCounters(), daily: {}, byOwner: {}, dailyByOwner: {} };
}

export function emptyApiTokenUsageStats(): ApiTokenUsageStats {
  return { byTokenId: {} };
}

function normalizeCounters(raw: unknown): ApiTokenOwnerCounters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyApiTokenOwnerCounters();
  const o = raw as Record<string, unknown>;
  const messagesRaw = o.messages;
  const messages =
    typeof messagesRaw === 'number' && Number.isFinite(messagesRaw) && messagesRaw >= 0
      ? Math.floor(messagesRaw)
      : 0;
  return {
    messages,
    tokens: normalizeTokenUsage(o.tokens) ?? emptyTokenUsage(),
  };
}

function addCounters(a: ApiTokenOwnerCounters, b: ApiTokenOwnerCounters): ApiTokenOwnerCounters {
  return {
    messages: (a.messages || 0) + (b.messages || 0),
    tokens: addTokenUsage(a.tokens || emptyTokenUsage(), b.tokens || emptyTokenUsage()),
  };
}

function pruneDailyCounters(
  daily: Record<string, ApiTokenOwnerCounters>,
  today = localUsageDay(),
  retainDays = USAGE_DAILY_RETENTION_DAYS,
): boolean {
  // Reuse date pruning by projecting to TokenUsage keys then restoring — keys only.
  const asUsage: Record<string, TokenUsage> = {};
  for (const [k, v] of Object.entries(daily)) {
    asUsage[k] = v.tokens || emptyTokenUsage();
  }
  const changed = pruneUsageDaily(asUsage, today, retainDays);
  if (!changed) return false;
  for (const key of Object.keys(daily)) {
    if (!(key in asUsage)) delete daily[key];
  }
  return true;
}

function normalizeBucket(raw: unknown): ApiTokenUsageBucket {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyApiTokenUsageBucket();
  const o = raw as Record<string, unknown>;
  const lifetime = normalizeCounters(o.lifetime);
  const daily: Record<string, ApiTokenOwnerCounters> = {};
  if (o.daily && typeof o.daily === 'object' && !Array.isArray(o.daily)) {
    for (const [day, v] of Object.entries(o.daily as Record<string, unknown>)) {
      daily[day] = normalizeCounters(v);
    }
  }
  pruneDailyCounters(daily);
  const byOwner: Record<string, ApiTokenOwnerCounters> = {};
  if (o.byOwner && typeof o.byOwner === 'object' && !Array.isArray(o.byOwner)) {
    for (const [id, v] of Object.entries(o.byOwner as Record<string, unknown>)) {
      byOwner[id] = normalizeCounters(v);
    }
  }
  const dailyByOwner: Record<string, Record<string, ApiTokenOwnerCounters>> = {};
  if (o.dailyByOwner && typeof o.dailyByOwner === 'object' && !Array.isArray(o.dailyByOwner)) {
    for (const [ownerId, days] of Object.entries(o.dailyByOwner as Record<string, unknown>)) {
      if (!days || typeof days !== 'object' || Array.isArray(days)) continue;
      const map: Record<string, ApiTokenOwnerCounters> = {};
      for (const [day, v] of Object.entries(days as Record<string, unknown>)) {
        map[day] = normalizeCounters(v);
      }
      pruneDailyCounters(map);
      if (Object.keys(map).length > 0) dailyByOwner[ownerId] = map;
    }
  }
  return { lifetime, daily, byOwner, dailyByOwner };
}

export function loadApiTokenUsageStats(file: string): ApiTokenUsageStats {
  const loaded = readJsonResult<ApiTokenUsageStats>(file, emptyApiTokenUsageStats());
  if (
    handleCorruptJsonRead(
      file,
      loaded.status,
      loaded.status === 'invalid' ? loaded.error : undefined,
      'api-token-usage.json',
    )
  ) {
    return emptyApiTokenUsageStats();
  }
  const raw = loaded.data;
  const byTokenId: Record<string, ApiTokenUsageBucket> = {};
  if (raw.byTokenId && typeof raw.byTokenId === 'object') {
    for (const [id, bucket] of Object.entries(raw.byTokenId)) {
      if (!id.trim()) continue;
      byTokenId[id] = normalizeBucket(bucket);
    }
  }
  return { byTokenId };
}

export function getApiTokenUsageBucket(
  stats: ApiTokenUsageStats,
  tokenId: string,
): ApiTokenUsageBucket {
  const id = (tokenId || '').trim();
  if (!id) return emptyApiTokenUsageBucket();
  return stats.byTokenId[id] ?? emptyApiTokenUsageBucket();
}

/**
 * Record one chat turn against an API token: +messages and optional model tokens,
 * attributed to ownerId (bot / squad).
 */
export function recordApiTokenUsage(
  file: string,
  tokenId: string,
  ownerId: string,
  opts?: {
    messages?: number;
    tokens?: TokenUsage;
  },
): ApiTokenUsageStats {
  const tid = (tokenId || '').trim();
  const oid = (ownerId || '').trim();
  const messages = Math.max(0, Math.floor(opts?.messages ?? 0));
  const tokens = normalizeTokenUsage(opts?.tokens) ?? emptyTokenUsage();
  const stats = loadApiTokenUsageStats(file);
  if (!tid || (!messages && !tokens.input && !tokens.output && !tokens.cache)) {
    return stats;
  }
  const bucket = stats.byTokenId[tid] ?? emptyApiTokenUsageBucket();
  const delta: ApiTokenOwnerCounters = { messages, tokens };
  const day = localUsageDay();

  bucket.lifetime = addCounters(bucket.lifetime, delta);
  bucket.daily[day] = addCounters(bucket.daily[day] ?? emptyApiTokenOwnerCounters(), delta);
  if (oid) {
    bucket.byOwner[oid] = addCounters(bucket.byOwner[oid] ?? emptyApiTokenOwnerCounters(), delta);
    const map = bucket.dailyByOwner[oid] ?? (bucket.dailyByOwner[oid] = {});
    map[day] = addCounters(map[day] ?? emptyApiTokenOwnerCounters(), delta);
  }

  pruneDailyCounters(bucket.daily);
  for (const map of Object.values(bucket.dailyByOwner)) pruneDailyCounters(map);

  stats.byTokenId[tid] = bucket;
  ensureDir(path.dirname(file));
  writeJson(file, stats);
  return stats;
}

/** Drop one token's usage when the credential is deleted. */
export function removeApiTokenUsage(file: string, tokenId: string): ApiTokenUsageStats {
  const stats = loadApiTokenUsageStats(file);
  const id = (tokenId || '').trim();
  if (id && id in stats.byTokenId) {
    delete stats.byTokenId[id];
    ensureDir(path.dirname(file));
    writeJson(file, stats);
  }
  return stats;
}

/** Snapshot used by quota checks before starting a chat. */
export function apiTokenQuotaSnapshot(bucket: ApiTokenUsageBucket, today = localUsageDay()) {
  const day = bucket.daily[today] ?? emptyApiTokenOwnerCounters();
  return {
    lifetimeMessages: bucket.lifetime.messages || 0,
    lifetimeTokens: totalTokensUsed(bucket.lifetime.tokens),
    dailyMessages: day.messages || 0,
    dailyTokens: totalTokensUsed(day.tokens),
  };
}
