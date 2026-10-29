/** Model provider catalog + context-compression helpers (split from settings.ts). */

import { createId } from './text.js';

/** OpenAI-compatible API wire format. Only formats the runtime can actually use. */
export type ApiFormat = 'chat_completions' | 'responses';

/** One selectable model in the provider catalog (Settings → 模型). */
export interface CatalogModel {
  /** API model id (sent to the provider). */
  id: string;
  /** Display name (defaults to id). */
  name: string;
  /** Context window in tokens (per-model; used for compression threshold). */
  contextWindow: number;
  /**
   * Max output tokens for this model (Agent `modelSettings.maxTokens`).
   * `null` = omit from request (follow provider default).
   * Chat Completions → `max_tokens`; Responses → `max_output_tokens`.
   */
  maxTokens: number | null;
  /** When false, hidden from bot picker and cannot be default. Default true. */
  enabled: boolean;
  /**
   * When true, render `<think>…</think>` as a collapsible block.
   * When false / missing (default), strip think spans from display (and from
   * persisted assistant content when that path still strips).
   */
  showThinking?: boolean;
}

/** One custom model provider (Settings → 模型接入 → 自定义供应商). */
export interface ModelProvider {
  /** Stable id (`prov_…`). */
  id: string;
  /** Display name in UI / level-1 menu. */
  name: string;
  baseURL: string;
  apiKey: string;
  /** Chat Completions (default) or Responses API via OpenAIProvider.useResponses. */
  apiFormat: ApiFormat;
  models: CatalogModel[];
}

/**
 * Persisted model-provider settings (`settings.json` → `model`).
 * Early product: old flat single-provider `{ baseURL, apiKey, apiFormat, models, defaultModelId }`
 * (and older `{ model, contextWindow }`) is rewritten in place via normalizeModelSettings —
 * no dual-format shim.
 */
export interface ModelSettings {
  providers: ModelProvider[];
  /** Provider that owns the global default model. */
  defaultProviderId: string;
  /** Model id within that provider’s catalog. */
  defaultModelId: string;
}

/**
 * Runtime model config for agent/chat (resolved from settings + optional bot/squad override).
 * Keeps the historical `model` string field the agent already passes to the SDK.
 */
export interface ResolvedModelConfig {
  baseURL: string;
  apiKey: string;
  apiFormat: ApiFormat;
  /** API model id / name. */
  model: string;
  contextWindow: number;
  /** Max output tokens → Agent modelSettings.maxTokens; null = omit (provider default). */
  maxTokens: number | null;
  /** Resolved showThinking (`=== true` → true; missing/false → false). */
  showThinking: boolean;
  /** All model ids on the resolved provider (for image-gen capability inference). */
  providerModelIds?: string[];
  /** Provider display name (passed through to agent tooling). */
  providerName?: string;
}

/** Optional bot/squad model override. Both empty / omitted → global default. */
export interface ModelRef {
  providerId?: string;
  modelId?: string;
}

/** Default display name when migrating a legacy single provider. */
export const DEFAULT_PROVIDER_NAME = '默认';

/**
 * Persisted Summary+Buffer knobs (`settings.json` root key `contextCompression`).
 * `ratio` is stored as 0–1 (e.g. 0.8); the Settings UI shows it as a percent (80).
 * Missing / invalid fields fall back to the CONTEXT_* constants below — no migration shims.
 */
export interface ContextCompressionSettings {
  /** Trigger when estimated tokens ≥ contextWindow × ratio. Range ~0.5–0.95. */
  ratio: number;
  /** Max recent buffer messages (upper bound). */
  keepRecentMax: number;
  /** Floor when shrinking the recent buffer. */
  keepRecentMin: number;
  /** Soft char cap for the rolling session summary. */
  summaryMaxChars: number;
  /**
   * Multiply the local token heuristic before comparing to the compress /
   * enforceBudget threshold. Counters under-count vs provider billed usage
   * (some providers overnight ~1.7×). Range 1.0–3.0; 1.0 = no calibration.
   */
  estimateSafetyFactor: number;
  /**
   * When true (default), on send classify whether the new user message starts a
   * new topic; if yes, force one Summary+Buffer compress (keep recent buffer).
   */
  autoTopicCompress: boolean;
}

/**
 * Persisted rolling Summary+Buffer state for a bot session.
 * `summary` is structured prose (目标/约定/路径/未完成/其他); only spans older than the recent buffer.
 */
export interface SessionSummary {
  /** Structured session summary, capped by CONTEXT_SUMMARY_MAX_CHARS. */
  summary: string;
  /** Last message id included in the summarized (older) span. */
  coveredThroughId: string;
  updatedAt: string;
  /**
   * Last effective model key used for a chat turn on this owner
   * (`effectiveModelKey`). Compared at turn start so a mid-session model
   * switch (bot override or global default for followers) triggers one
   * Summary+Buffer compress. Optional — missing means "not yet recorded".
   */
  lastEffectiveModel?: string;
}

/**
 * Stable key for the resolved runtime model (provider endpoint + API model id).
 * Used to detect mid-session model changes without scanning settings at save time.
 */
export function effectiveModelKey(model: Pick<ResolvedModelConfig, 'baseURL' | 'model'>): string {
  const base = (model.baseURL || '').replace(/\/+$/, '');
  const id = (model.model || '').trim();
  return `${base}\n${id}`;
}

/** Context compression knobs (Summary + Buffer, SlimContext-style) — defaults when settings omit fields. */
export const CONTEXT_COMPRESS_RATIO = 0.6;
export const CONTEXT_KEEP_RECENT_MESSAGES = 12;
/** Floor for the recent buffer when fitting a smaller model window. */
export const CONTEXT_KEEP_RECENT_MIN = 8;
/** Soft cap for the rolling summary (Chinese chars / punctuation). */
export const CONTEXT_SUMMARY_MAX_CHARS = 2000;
/** Scale local token estimates before threshold checks (undercount calibration). */
export const CONTEXT_ESTIMATE_SAFETY_FACTOR = 1.6;
export const DEFAULT_CONTEXT_COMPRESSION: ContextCompressionSettings = {
  ratio: CONTEXT_COMPRESS_RATIO,
  keepRecentMax: CONTEXT_KEEP_RECENT_MESSAGES,
  keepRecentMin: CONTEXT_KEEP_RECENT_MIN,
  summaryMaxChars: CONTEXT_SUMMARY_MAX_CHARS,
  estimateSafetyFactor: CONTEXT_ESTIMATE_SAFETY_FACTOR,
  autoTopicCompress: true,
};
export function normalizeContextWindow(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(n) && n >= 1000) return Math.floor(n);
  return 128_000;
}

/**
 * Positive integer → floor; missing / empty / invalid → `null` (provider default; do not send).
 * Existing saved numbers (including former default 128000) are kept as-is.
 */
export function normalizeMaxTokens(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string' && !raw.trim()) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return null;
}

export function normalizeApiFormat(raw: unknown): ApiFormat {
  return raw === 'responses' ? 'responses' : 'chat_completions';
}

/** Compact badge for context windows (e.g. 200000 → 200K, 1000000 → 1M). */
export function formatContextWindowBadge(tokens: number): string {
  const n = normalizeContextWindow(tokens);
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(n);
}

export function normalizeCatalogModel(raw: unknown): CatalogModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const id = typeof src.id === 'string' ? src.id.trim() : '';
  if (!id) return null;
  const name =
    typeof src.name === 'string' && src.name.trim() ? src.name.trim() : id;
  return {
    id,
    name,
    contextWindow: normalizeContextWindow(src.contextWindow),
    maxTokens: normalizeMaxTokens(src.maxTokens),
    enabled: src.enabled !== false,
    // Default false when missing; only persist true when explicitly on.
    showThinking: src.showThinking === true ? true : undefined,
  };
}

/**
 * Deduplicate catalog models within one provider.
 * - `id` unique (first wins)
 * - `name` unique after trim, case-sensitive (first wins)
 */
export function dedupeCatalogModels(models: CatalogModel[]): CatalogModel[] {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const out: CatalogModel[] = [];
  for (const m of models) {
    const nameKey = m.name.trim();
    if (seenIds.has(m.id) || seenNames.has(nameKey)) continue;
    seenIds.add(m.id);
    seenNames.add(nameKey);
    out.push(m);
  }
  return out;
}

/** Display key for A–Z sort: trimmed name, else id. */
export function catalogModelSortKey(m: Pick<CatalogModel, 'id' | 'name'>): string {
  const name = (m.name || '').trim();
  return name || m.id;
}

/**
 * Stable A–Z by display name (fallback id); id as tiebreak.
 * Used by settings model list, default/bot/squad pickers, and discover results.
 */
export function compareCatalogModels(
  a: Pick<CatalogModel, 'id' | 'name'>,
  b: Pick<CatalogModel, 'id' | 'name'>,
): number {
  const byName = catalogModelSortKey(a).localeCompare(catalogModelSortKey(b), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id, undefined, { sensitivity: 'base', numeric: true });
}

/** Return a new array sorted A–Z by display name (fallback id). Stable for equal keys. */
export function sortCatalogModels<T extends Pick<CatalogModel, 'id' | 'name'>>(
  models: readonly T[],
): T[] {
  return models.slice().sort(compareCatalogModels);
}

function normalizeCatalogModelsList(raw: unknown): CatalogModel[] {
  if (!Array.isArray(raw)) return [];
  const list: CatalogModel[] = [];
  for (const item of raw) {
    const m = normalizeCatalogModel(item);
    if (m) list.push(m);
  }
  return sortCatalogModels(dedupeCatalogModels(list));
}


/** Trim API key; strip a leading "Bearer " so chat and testConnection stay consistent. */
function hashText(s: string): string {
  // Short stable id fragment (not cryptographic).
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function stripBearerPrefix(raw: string): string {
  let key = (raw || '').trim();
  if (/^bearer\s+/i.test(key)) {
    key = key.replace(/^bearer\s+/i, '').trim();
  }
  return key;
}

export function normalizeModelProvider(
  raw: unknown,
  fallbackName = DEFAULT_PROVIDER_NAME,
): ModelProvider | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const name =
    typeof src.name === 'string' && src.name.trim() ? src.name.trim() : fallbackName;
  const baseURL = typeof src.baseURL === 'string' ? src.baseURL : '';
  // Missing id must be stable across reads — createId() on every getSettings wiped bindings.
  const id =
    typeof src.id === 'string' && src.id.trim()
      ? src.id.trim()
      : `prov_${hashText(`${name}\0${baseURL}`)}`;
  return {
    id,
    name,
    baseURL,
    apiKey: stripBearerPrefix(typeof src.apiKey === 'string' ? src.apiKey : ''),
    apiFormat: normalizeApiFormat(src.apiFormat),
    models: normalizeCatalogModelsList(src.models),
  };
}

function migrateLegacyFlatProvider(src: Record<string, unknown>): ModelProvider {
  let models = normalizeCatalogModelsList(src.models);
  if (!models.length) {
    const legacyId =
      typeof src.model === 'string' && src.model.trim() ? src.model.trim() : '';
    if (legacyId) {
      models = [
        {
          id: legacyId,
          name: legacyId,
          contextWindow: normalizeContextWindow(src.contextWindow),
          maxTokens: normalizeMaxTokens(src.maxTokens),
          enabled: true,
        },
      ];
    }
  }
  return {
    id: createId('prov'),
    name: DEFAULT_PROVIDER_NAME,
    baseURL: typeof src.baseURL === 'string' ? src.baseURL : '',
    apiKey: stripBearerPrefix(typeof src.apiKey === 'string' ? src.apiKey : ''),
    apiFormat: normalizeApiFormat(src.apiFormat),
    models,
  };
}

function pickDefaultInProviders(
  providers: ModelProvider[],
  wantProviderId: string,
  wantModelId: string,
): { defaultProviderId: string; defaultModelId: string } {
  if (!providers.length) return { defaultProviderId: '', defaultModelId: '' };

  let provider =
    (wantProviderId && providers.find((p) => p.id === wantProviderId)) || null;
  let modelId = wantModelId;

  if (provider && modelId) {
    const hit = provider.models.find((m) => m.id === modelId);
    if (!hit || !hit.enabled) {
      modelId = provider.models.find((m) => m.enabled)?.id || provider.models[0]?.id || '';
    }
  } else if (!provider && modelId) {
    provider =
      providers.find((p) => p.models.some((m) => m.id === modelId && m.enabled)) ||
      providers.find((p) => p.models.some((m) => m.id === modelId)) ||
      null;
  }

  if (!provider) {
    provider =
      providers.find((p) => p.models.some((m) => m.enabled)) || providers[0] || null;
  }
  if (!provider) return { defaultProviderId: '', defaultModelId: '' };

  if (!modelId || !provider.models.some((m) => m.id === modelId)) {
    modelId =
      provider.models.find((m) => m.enabled)?.id || provider.models[0]?.id || '';
  } else {
    const def = provider.models.find((m) => m.id === modelId);
    if (def && !def.enabled) {
      modelId =
        provider.models.find((m) => m.enabled)?.id || provider.models[0]?.id || '';
    }
  }

  return { defaultProviderId: provider.id, defaultModelId: modelId };
}

/**
 * Clamp / migrate model provider settings.
 * Rewrites legacy flat single-provider (and older `{ model, contextWindow }`) into
 * `providers` + `defaultProviderId` + `defaultModelId` in place (no dual-read forever).
 */
export function normalizeModelSettings(raw: unknown): ModelSettings {
  const src =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  let providers: ModelProvider[] = [];
  if (Array.isArray(src.providers)) {
    const seen = new Map<string, ModelProvider>();
    for (const item of src.providers) {
      const p = normalizeModelProvider(item);
      if (!p) continue;
      const prev = seen.get(p.id);
      if (prev) {
        // Duplicate id: keep first row, but don't drop a non-empty apiKey from the dup.
        if (!prev.apiKey.trim() && p.apiKey.trim()) prev.apiKey = p.apiKey;
        continue;
      }
      seen.set(p.id, p);
      providers.push(p);
    }
  } else if (
    typeof src.baseURL === 'string' ||
    typeof src.apiKey === 'string' ||
    Array.isArray(src.models) ||
    typeof src.model === 'string' ||
    'contextWindow' in src ||
    typeof src.defaultModelId === 'string'
  ) {
    providers = [migrateLegacyFlatProvider(src)];
  }

  const wantProviderId =
    typeof src.defaultProviderId === 'string' ? src.defaultProviderId.trim() : '';
  let wantModelId =
    typeof src.defaultModelId === 'string' ? src.defaultModelId.trim() : '';
  if (!wantModelId && typeof src.model === 'string' && src.model.trim()) {
    wantModelId = src.model.trim();
  }

  const picked = pickDefaultInProviders(providers, wantProviderId, wantModelId);
  return {
    providers,
    defaultProviderId: picked.defaultProviderId,
    defaultModelId: picked.defaultModelId,
  };
}

/**
 * Resolve bot/squad override → settings default → first enabled model.
 * Across providers the same model id string is allowed; resolution always uses providerId.
 */
export function resolveModelConfig(
  settings: ModelSettings,
  override?: ModelRef | null,
): ResolvedModelConfig {
  const providers = settings.providers || [];
  const oPid = (override?.providerId || '').trim();
  const oMid = (override?.modelId || '').trim();

  let provider: ModelProvider | null = null;
  let pick: CatalogModel | null = null;

  if (oPid && oMid) {
    provider = providers.find((p) => p.id === oPid) || null;
    if (provider) {
      const enabled = provider.models.filter((m) => m.enabled);
      const pool = enabled.length ? enabled : provider.models;
      pick = pool.find((m) => m.id === oMid) || null;
    }
  }

  if (!pick) {
    provider =
      providers.find((p) => p.id === settings.defaultProviderId) ||
      providers[0] ||
      null;
    if (provider) {
      const enabled = provider.models.filter((m) => m.enabled);
      const pool = enabled.length ? enabled : provider.models;
      pick =
        (settings.defaultModelId &&
          pool.find((m) => m.id === settings.defaultModelId)) ||
        pool[0] ||
        null;
    }
  }

  return {
    baseURL: provider?.baseURL ?? '',
    apiKey: provider?.apiKey ?? '',
    apiFormat: provider?.apiFormat ?? 'chat_completions',
    model: pick?.id ?? '',
    contextWindow: pick ? pick.contextWindow : 128_000,
    maxTokens: pick ? pick.maxTokens : null,
    showThinking: pick?.showThinking === true,
    providerModelIds: provider ? provider.models.map((m) => m.id) : [],
    providerName: provider?.name ?? '',
  };
}

/**
 * Bind a (possibly legacy) model override onto a concrete provider using current settings.
 * Prefer explicit providerId+modelId; legacy modelId-only prefers the default provider,
 * else the unique owner; ambiguous / missing → `{}` (use global default).
 */
export function resolveModelRef(
  settings: ModelSettings,
  ref?: ModelRef | null,
): ModelRef {
  const pid = (ref?.providerId || '').trim();
  const mid = (ref?.modelId || '').trim();
  if (!mid && !pid) return {};
  if (pid && mid) {
    const p = settings.providers.find((x) => x.id === pid);
    if (p && p.models.some((m) => m.id === mid)) {
      return { providerId: pid, modelId: mid };
    }
    return {};
  }
  if (mid && !pid) {
    const hits = settings.providers.filter((p) => p.models.some((m) => m.id === mid));
    if (!hits.length) return {};
    const preferred =
      hits.find((p) => p.id === settings.defaultProviderId) ||
      (hits.length === 1 ? hits[0] : null);
    if (preferred) return { providerId: preferred.id, modelId: mid };
    return {};
  }
  return {};
}

/**
 * Clamp / fill contextCompression from disk or UI.
 * - ratio: 0.5–0.95 (UI percent ÷ 100)
 * - keepRecentMin/Max: integers with 1 ≤ min ≤ max (max capped at 500)
 * - summaryMaxChars: 100–8000
 * - estimateSafetyFactor: 1.0–3.0 (missing → CONTEXT_ESTIMATE_SAFETY_FACTOR)
 * - autoTopicCompress: missing → true
 */
export function normalizeContextCompression(raw: unknown): ContextCompressionSettings {
  // null/'' → defaults (same family as normalizeMaxTokens); do not Number(null) quirks.
  const src =
    raw != null && raw !== '' && typeof raw === 'object'
      ? (raw as Partial<Record<keyof ContextCompressionSettings, unknown>>)
      : {};

  // Field-level null/'' must not Number() to 0 then clamp to the aggressive floor.
  const numField = (v: unknown, fallback: number): number => {
    if (v == null || v === '') return fallback;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  let ratio = numField(src.ratio, CONTEXT_COMPRESS_RATIO);
  // Defensive: if a percent slipped in (e.g. 80), map to 0–1.
  if (ratio > 1 && ratio <= 100) ratio = ratio / 100;
  ratio = Math.min(0.95, Math.max(0.5, ratio));

  let keepRecentMin = numField(src.keepRecentMin, CONTEXT_KEEP_RECENT_MIN);
  let keepRecentMax = numField(src.keepRecentMax, CONTEXT_KEEP_RECENT_MESSAGES);
  keepRecentMin = Math.floor(keepRecentMin);
  keepRecentMax = Math.floor(keepRecentMax);
  keepRecentMin = Math.min(500, Math.max(1, keepRecentMin));
  keepRecentMax = Math.min(500, Math.max(1, keepRecentMax));
  if (keepRecentMin > keepRecentMax) {
    const tmp = keepRecentMin;
    keepRecentMin = keepRecentMax;
    keepRecentMax = tmp;
  }

  let summaryMaxChars = numField(src.summaryMaxChars, CONTEXT_SUMMARY_MAX_CHARS);
  summaryMaxChars = Math.floor(summaryMaxChars);
  summaryMaxChars = Math.min(8000, Math.max(100, summaryMaxChars));

  let estimateSafetyFactor = numField(src.estimateSafetyFactor, CONTEXT_ESTIMATE_SAFETY_FACTOR);
  // One decimal place is enough for UI / settings.json.
  estimateSafetyFactor = Math.round(estimateSafetyFactor * 10) / 10;
  estimateSafetyFactor = Math.min(3, Math.max(1, estimateSafetyFactor));

  // Missing / invalid → default ON (early product: no migration shim).
  const autoTopicCompress = src.autoTopicCompress === false ? false : true;

  return {
    ratio,
    keepRecentMax,
    keepRecentMin,
    summaryMaxChars,
    estimateSafetyFactor,
    autoTopicCompress,
  };
}

/**
 * Default fallback for `normalizeMaxTurns` (message-limit knobs and similar).
 * Not a user-facing 1:1 / squad run setting — those UIs were removed.
 */
export const DEFAULT_MAX_TURNS = 50;

/**
 * Hardcoded 1:1 `runner.run({ maxTurns })` default (settings.maxTurns removed).
 * Above the old UI default of 50 so long tool loops are less likely to hit the
 * cap; still finite so a runaway agent cannot loop forever. Avoids SDK's
 * DEFAULT_MAX_TURNS=10 when callers omit maxTurns.
 */
export const DEFAULT_RUNNER_MAX_TURNS = 100;

/** Clamp agent maxTurns to 1–100; null/empty/missing/invalid → fallback. */
export function normalizeMaxTurns(raw: unknown, fallback: number = DEFAULT_MAX_TURNS): number {
  // Number(null) === 0 would otherwise clamp to 1 — treat null/'' like normalizeMaxTokens.
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'string' && !raw.trim()) return fallback;
  let n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) n = fallback;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

/** Max recent messages for memory extract (compress fold can exceed maxTurns). */
export const MAX_MEMORY_RECENT_MESSAGE_LIMIT = 500;

/**
 * Clamp memory-extract recent window to 1–500.
 * Do not reuse normalizeMaxTurns (capped at 100) — a 300-message fold would drop 200.
 */
export function normalizeMemoryRecentLimit(raw: unknown, fallback: number = 2): number {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'string' && !raw.trim()) return fallback;
  let n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) n = fallback;
  return Math.min(MAX_MEMORY_RECENT_MESSAGE_LIMIT, Math.max(1, Math.floor(n)));
}

/**
 * 1:1 private-chat peer mesh (`settings.json` → `mesh`).
 * Depth / per-turn call caps were removed; mesh nesting is unlimited.
 * Cycle prevention (no assistant already on the call stack) stays on and is not
 * configurable. Squad sessions never use this object. Kept as an empty bag so
 * older `settings.json` files with maxDepth / maxCallsPerTurn still load.
 */
export interface MeshSettings {
  /* intentionally empty — no user-facing mesh caps */
}

export const DEFAULT_MESH_SETTINGS: MeshSettings = {};

/** Ignore legacy mesh knobs; always return an empty settings object. */
export function normalizeMeshSettings(_raw?: unknown): MeshSettings {
  return {};
}



/** Clamp summary text to the soft char budget (prefer cutting at a newline). */
export function clampSessionSummary(text: string, max = CONTEXT_SUMMARY_MAX_CHARS): string {
  const s = text.trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const nl = cut.lastIndexOf('\n');
  if (nl >= Math.floor(max * 0.6)) return cut.slice(0, nl).trimEnd();
  return cut.trimEnd();
}

/**
 * Messages in `older` that are not yet covered by `coveredThroughId`.
 * If the id is missing / unknown, returns the full older list (first compress or reset).
 */
export function uncoveredOlderMessages<T extends { id: string }>(
  older: T[],
  coveredThroughId: string | null | undefined,
): T[] {
  if (!older.length) return [];
  if (!coveredThroughId) return older;
  const idx = older.findIndex((m) => m.id === coveredThroughId);
  if (idx < 0) return older;
  if (idx >= older.length - 1) return [];
  return older.slice(idx + 1);
}

/**
 * Prior turns still in the model-facing buffer (after Summary+Buffer `coveredThroughId`).
 * Mirror of `readSessionItemsAfter`: missing marker → treat whole list as live buffer.
 */
export function messagesAfterCoverage<T extends { id: string }>(
  messages: T[],
  coveredThroughId: string | null | undefined,
): T[] {
  if (!messages.length) return [];
  if (!coveredThroughId) return messages;
  const idx = messages.findIndex((m) => m.id === coveredThroughId);
  if (idx < 0) return messages;
  return messages.slice(idx + 1);
}
