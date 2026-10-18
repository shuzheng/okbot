/** App settings schema, normalize helpers, bots/squads, defaults. */

import type { McpSettings } from './mcp.js';
import type { WebSettings } from './web.js';
import type { AutoApprovalRule } from './approval.js';
import { createId } from './text.js';
import {
  TOOL_IDS,
  type ToolId,
  type ToolPreference,
  type ToolPreferences,
  DEFAULT_TOOL_PREFERENCES,
  normalizeToolPreferences,
} from './toolIds.js';

// Re-exported via barrel from toolIds.ts (avoid duplicate export * names).

export type ThemeMode = 'system' | 'light' | 'dark';
export type LanguageCode = 'system' | 'zh' | 'en';

/**
 * Window close button behavior (Electron desktop).
 * - `ask`: first close (or until remembered) shows Quit vs tray/hide dialog
 * - `quit`: close quits the app
 * - `tray`: close hides to system tray / macOS menu bar
 *
 * Cmd+Q / tray Quit still request quit; if work is in flight, `before-quit` may
 * move the app to the background instead of exiting immediately.
 */
export type CloseAction = 'ask' | 'quit' | 'tray';

export function normalizeCloseAction(raw: unknown): CloseAction {
  if (raw === 'quit' || raw === 'tray' || raw === 'ask') return raw;
  return 'ask';
}

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
}

/** Context compression knobs (Summary + Buffer, SlimContext-style) — defaults when settings omit fields. */
export const CONTEXT_COMPRESS_RATIO = 0.6;
export const CONTEXT_KEEP_RECENT_MESSAGES = 12;
/** Floor for the recent buffer when fitting a smaller model window. */
export const CONTEXT_KEEP_RECENT_MIN = 8;
/** Soft cap for the rolling summary (Chinese chars / punctuation). */
export const CONTEXT_SUMMARY_MAX_CHARS = 2000;
export const DEFAULT_CONTEXT_COMPRESSION: ContextCompressionSettings = {
  ratio: CONTEXT_COMPRESS_RATIO,
  keepRecentMax: CONTEXT_KEEP_RECENT_MESSAGES,
  keepRecentMin: CONTEXT_KEEP_RECENT_MIN,
  summaryMaxChars: CONTEXT_SUMMARY_MAX_CHARS,
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
 * - autoTopicCompress: missing → true
 */
export function normalizeContextCompression(raw: unknown): ContextCompressionSettings {
  // null/'' → defaults (same family as normalizeMaxTokens); do not Number(null) quirks.
  const src =
    raw != null && raw !== '' && typeof raw === 'object'
      ? (raw as Partial<Record<keyof ContextCompressionSettings, unknown>>)
      : {};

  let ratio = typeof src.ratio === 'number' ? src.ratio : Number(src.ratio);
  if (!Number.isFinite(ratio)) ratio = CONTEXT_COMPRESS_RATIO;
  // Defensive: if a percent slipped in (e.g. 80), map to 0–1.
  if (ratio > 1 && ratio <= 100) ratio = ratio / 100;
  ratio = Math.min(0.95, Math.max(0.5, ratio));

  let keepRecentMin =
    typeof src.keepRecentMin === 'number' ? src.keepRecentMin : Number(src.keepRecentMin);
  let keepRecentMax =
    typeof src.keepRecentMax === 'number' ? src.keepRecentMax : Number(src.keepRecentMax);
  if (!Number.isFinite(keepRecentMin)) keepRecentMin = CONTEXT_KEEP_RECENT_MIN;
  if (!Number.isFinite(keepRecentMax)) keepRecentMax = CONTEXT_KEEP_RECENT_MESSAGES;
  keepRecentMin = Math.floor(keepRecentMin);
  keepRecentMax = Math.floor(keepRecentMax);
  keepRecentMin = Math.min(500, Math.max(1, keepRecentMin));
  keepRecentMax = Math.min(500, Math.max(1, keepRecentMax));
  if (keepRecentMin > keepRecentMax) {
    const tmp = keepRecentMin;
    keepRecentMin = keepRecentMax;
    keepRecentMax = tmp;
  }

  let summaryMaxChars =
    typeof src.summaryMaxChars === 'number' ? src.summaryMaxChars : Number(src.summaryMaxChars);
  if (!Number.isFinite(summaryMaxChars)) summaryMaxChars = CONTEXT_SUMMARY_MAX_CHARS;
  summaryMaxChars = Math.floor(summaryMaxChars);
  summaryMaxChars = Math.min(8000, Math.max(100, summaryMaxChars));

  // Missing / invalid → default ON (early product: no migration shim).
  const autoTopicCompress = src.autoTopicCompress === false ? false : true;

  return { ratio, keepRecentMax, keepRecentMin, summaryMaxChars, autoTopicCompress };
}

/**
 * Default fallback for `normalizeMaxTurns` (squad captain/member caps, message
 * limit knobs). Not a user-facing 1:1 setting — that UI was removed.
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
/** UI / IPC snapshot of one timed wakeup (desktop settings + gateway RPC). */
export type ScheduledJobInfo = {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerKind: 'bot' | 'squad';
  title: string;
  prompt: string;
  enabled: boolean;
  timezone: string;
  /** Human schedule label, e.g. daily 09:00 */
  scheduleLabel: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  once: boolean;
  /** ISO create time (for edit-UI sort newest→oldest). */
  createdAt: string;
};
/** How tool input guardrails short-circuit a blocked call. */
export type SecurityBlockMode = 'reject' | 'tripwire';

/** One dangerous-shell denylist entry (`settings.security.shellPatterns`). */
export interface DangerousShellPattern {
  id: string;
  /** JavaScript RegExp source (no delimiters). Compiled with the `i` flag. */
  pattern: string;
  /** Short label for block messages / Settings UI. */
  label?: string;
}

/**
 * Built-in dangerous shell patterns (case-insensitive).
 * Used when `security.shellPatterns` is absent/undefined.
 */
export const DEFAULT_DANGEROUS_SHELL_PATTERNS: DangerousShellPattern[] = [
  {
    id: 'rm_rf_root',
    pattern: String.raw`\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|-[a-zA-Z]*\s+)*\/\s*($|&&|\||;)`,
    label: 'rm -rf /',
  },
  {
    id: 'rm_rf_star',
    pattern: String.raw`\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+(\/\*|~\/\*|\$HOME\/\*)`,
    label: 'rm -rf /*',
  },
  {
    id: 'sudo',
    pattern: String.raw`(^|[;&|\`\n]|\$\()\s*sudo\b`,
    label: 'sudo',
  },
  {
    id: 'mkfs',
    pattern: String.raw`\bmkfs(\.\w+)?\b`,
    label: 'mkfs',
  },
  {
    id: 'dd_if',
    pattern: String.raw`\bdd\s+.*\bif=`,
    label: 'dd if=',
  },
  {
    id: 'curl_pipe_sh',
    pattern: String.raw`\b(curl|wget)\b[^|\n]*\|\s*(ba)?sh\b`,
    label: 'curl|sh / wget|sh',
  },
  {
    id: 'chmod_777_root',
    pattern: String.raw`\bchmod\s+(-R\s+)?777\s+\/(\s|$)`,
    label: 'chmod 777 /',
  },
  {
    id: 'diskutil_erase',
    pattern: String.raw`\bdiskutil\s+erase`,
    label: 'diskutil erase',
  },
  {
    id: 'shutdown',
    pattern: String.raw`\b(shutdown|reboot|halt|poweroff)\b`,
    label: 'shutdown/reboot',
  },
  {
    id: 'fork_bomb',
    pattern: String.raw`:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:`,
    label: 'fork bomb',
  },
  {
    id: 'write_disk',
    pattern: String.raw`>\s*\/dev\/(sd|disk|rdisk|nvme)`,
    label: 'write to /dev/disk',
  },
];

/**
 * Local-tool safety knobs (`settings.json` root key `security`).
 * Guardrails run before needsApproval / HITL. No migration shims for older shapes.
 */
export interface SecuritySettings {
  /** Master switch. When false, no tool input guardrails are attached. Default true. */
  enabled: boolean;
  /**
   * When true, file paths and shell cwd must resolve under the tool root (~ / homedir)
   * or under an entry in allowedPathPrefixes.
   */
  restrictToHome: boolean;
  /** Extra allowed absolute/~ path prefixes (one per line in UI). */
  allowedPathPrefixes: string[];
  /** Always-denied path prefixes (checked before allowlist). */
  deniedPathPrefixes: string[];
  /** Scan run_shell commands for dangerous patterns. */
  shellPatternsEnabled: boolean;
  /**
   * Custom dangerous-shell regex list.
   * Absent/undefined → {@link DEFAULT_DANGEROUS_SHELL_PATTERNS}.
   * Explicit `[]` → clear denylist (no patterns).
   * Non-empty raw that normalizes to zero valid rows → fall back to defaults
   * (never silently disable the denylist due to typos / malformed rows).
   */
  shellPatterns?: DangerousShellPattern[];
  /**
   * reject = rejectContent (Chinese reason to the model);
   * tripwire = throwException (abort the run).
   */
  blockMode: SecurityBlockMode;
}

export const DEFAULT_DENIED_PATH_PREFIXES = [
  '~/.ssh',
  '~/.gnupg',
  '/etc',
  '/private/etc',
  '/System',
] as const;

export const DEFAULT_SECURITY: SecuritySettings = {
  enabled: true,
  restrictToHome: true,
  allowedPathPrefixes: [],
  deniedPathPrefixes: [...DEFAULT_DENIED_PATH_PREFIXES],
  shellPatternsEnabled: true,
  blockMode: 'reject',
};

function normalizePathPrefixList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeShellPatternList(raw: unknown): DangerousShellPattern[] {
  if (!Array.isArray(raw)) return [];
  const out: DangerousShellPattern[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const pattern = typeof o.pattern === 'string' ? o.pattern.trim() : '';
    if (!pattern) continue;
    let id = typeof o.id === 'string' ? o.id.trim() : '';
    if (!id) {
      // Stable-enough fallback for malformed rows; UI always assigns ids on create.
      id = `sp_${out.length}_${pattern.slice(0, 32).replace(/[^a-zA-Z0-9]+/g, '_')}`;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    out.push(label ? { id, pattern, label } : { id, pattern });
  }
  return out;
}

/** Compile a shell denylist pattern; returns null when the source is empty or invalid. */
export function tryCompileShellPattern(pattern: string): RegExp | null {
  const src = pattern.trim();
  if (!src) return null;
  try {
    return new RegExp(src, 'i');
  } catch {
    return null;
  }
}

/**
 * Effective denylist: custom list when `shellPatterns` is set (including explicit
 * `[]`), otherwise built-in defaults. Callers must go through
 * {@link normalizeSecuritySettings} so malformed non-empty input does not become `[]`.
 */
export function resolveShellPatterns(security: SecuritySettings): DangerousShellPattern[] {
  if (security.shellPatterns !== undefined) {
    return security.shellPatterns.map((p) => ({ ...p }));
  }
  return DEFAULT_DANGEROUS_SHELL_PATTERNS.map((p) => ({ ...p }));
}

/** Clamp / fill security from disk or UI. Missing fields → DEFAULT_SECURITY. */
export function normalizeSecuritySettings(raw: unknown): SecuritySettings {
  const src =
    raw && typeof raw === 'object' ? (raw as Partial<Record<keyof SecuritySettings, unknown>>) : {};
  const blockMode: SecurityBlockMode = src.blockMode === 'tripwire' ? 'tripwire' : 'reject';
  const out: SecuritySettings = {
    enabled: src.enabled !== false,
    restrictToHome: src.restrictToHome !== false,
    allowedPathPrefixes: normalizePathPrefixList(src.allowedPathPrefixes),
    deniedPathPrefixes:
      src.deniedPathPrefixes == null || src.deniedPathPrefixes === ''
        ? [...DEFAULT_DENIED_PATH_PREFIXES]
        : normalizePathPrefixList(src.deniedPathPrefixes),
    shellPatternsEnabled: src.shellPatternsEnabled !== false,
    blockMode,
  };
  if (Array.isArray(src.shellPatterns)) {
    // Literal [] = explicit clear. Non-empty raw that yields 0 valid
    // (structurally or compilable) patterns must NOT become [] (fail-open).
    if (src.shellPatterns.length === 0) {
      out.shellPatterns = [];
    } else {
      const normalized = normalizeShellPatternList(src.shellPatterns).filter((p) =>
        tryCompileShellPattern(p.pattern),
      );
      if (normalized.length > 0) {
        out.shellPatterns = normalized;
      }
      // else: omit shellPatterns → resolveShellPatterns uses defaults
    }
  }
  return out;
}

/**
 * Global squad defaults (`settings.json` → `squad`).
 * Built-in virtual captain uses persona + playbook; maxTurns cap captain / member runs.
 */
export interface SquadSettings {
  /** Captain persona / profession instructions (Chinese by default). */
  captainPersona: string;
  /** Collaboration playbook injected into the captain. */
  playbook: string;
  /** Max agent turns for the captain run. */
  captainMaxTurns: number;
  /** Max agent turns for each nested member asTool run. */
  memberMaxTurns: number;
}

export const DEFAULT_SQUAD_CAPTAIN_PERSONA = `你是小队的虚拟队长与编排者。你负责理解目标、拆解任务、选择队员、传递上下文、校验结果、汇总结论，并简洁清楚的回复用户。
你的价值在于编排与把关，而不是替队员输出其专业细节。

原则：
1. 目标与约束优先：先确认用户目标、范围、验收标准、格式与限制。
2. 角色边界：只把队员明确回报的内容当作其结论；不编造、不夸大、不把自己的推断伪装成队员结论。
3. 中立务实：不确定时，涉及专业事实先问对应队员；涉及用户偏好、目标或取舍，先问用户。
4. 效率可控：独立且无依赖的子任务应并行调用多名队员；有依赖时再串行；控制轮次、调用次数与成本。
5. 结果负责：最终答复要可执行、可追溯，并说明依据、风险与未尽事项。`;

export const DEFAULT_SQUAD_PLAYBOOK = `0. 准备：读取队员名册、能力边界、工具权限与输出格式；建立任务清单：目标/约束/子任务/负责人/依赖/状态/结果/未决。
1. 澄清：若关键信息缺失且影响结果，先向用户提不超过3个关键问题；否则做最小合理假设并明确标注。
2. 拆解：把目标拆成可执行子任务。每个子任务写明：输入、期望输出、验收标准、依赖、优先级。
3. 路由：按能力选择最合适队员。多个无依赖子任务应在同一轮并行调用对应队员；有依赖时再串行。
   分派时必须携带：总目标、子任务、已知输入、约束、期望格式、验收标准、不要做什么。
4. 校验：队员回报后检查完整性、一致性、事实依据与验收标准。不合格则追问、重试、换人或降级。
5. 冲突：队员结论冲突时，列出来源、证据、假设、置信度，按领域权威、数据新鲜度、可验证性裁决；不能裁决则请用户决定。
6. 汇总：去重、校对、统一术语与格式。最终答复包含：结论/交付物、关键依据、风险与限制、下一步建议。不要暴露冗长内部推理。
7. 异常：队员超时/失败/空结果时，记录原因，尝试一次修复；仍失败则换人或降级，并明确告知用户。
8. 边界：不越权调用工具或访问数据；不泄露隐私与密钥；不把未确认信息写成事实。
9. 队员之间默认不互通，所有跨队员信息由你传递，并标注来源。`;

export const DEFAULT_SQUAD_SETTINGS: SquadSettings = {
  captainPersona: DEFAULT_SQUAD_CAPTAIN_PERSONA,
  playbook: DEFAULT_SQUAD_PLAYBOOK,
  captainMaxTurns: 50,
  memberMaxTurns: 50,
};

/**
 * Pre-parallel-star captain persona (exact text). Persisted settings still storing this
 * exact default are upgraded to DEFAULT_SQUAD_CAPTAIN_PERSONA (parallel-first wording).
 */
export const LEGACY_DEFAULT_SQUAD_CAPTAIN_PERSONA = `你是小队的虚拟队长与编排者。你负责理解目标、拆解任务、选择队员、传递上下文、校验结果、汇总结论，并简洁清楚的回复用户。
你的价值在于编排与把关，而不是替队员输出其专业细节。

原则：
1. 目标与约束优先：先确认用户目标、范围、验收标准、格式与限制。
2. 角色边界：只把队员明确回报的内容当作其结论；不编造、不夸大、不把自己的推断伪装成队员结论。
3. 中立务实：不确定时，涉及专业事实先问对应队员；涉及用户偏好、目标或取舍，先问用户。
4. 效率可控：默认串行调用；独立且无依赖的子任务可并行；控制轮次、调用次数与成本。
5. 结果负责：最终答复要可执行、可追溯，并说明依据、风险与未尽事项。`;

/**
 * Pre-parallel-star playbook (exact text). Exact match → upgrade to DEFAULT_SQUAD_PLAYBOOK.
 */
export const LEGACY_DEFAULT_SQUAD_PLAYBOOK = `0. 准备：读取队员名册、能力边界、工具权限与输出格式；建立任务清单：目标/约束/子任务/负责人/依赖/状态/结果/未决。
1. 澄清：若关键信息缺失且影响结果，先向用户提不超过3个关键问题；否则做最小合理假设并明确标注。
2. 拆解：把目标拆成可执行子任务。每个子任务写明：输入、期望输出、验收标准、依赖、优先级。
3. 路由：按能力选择最合适队员。默认一次调用一名队员；若多个子任务无依赖且系统支持并行，可并行。
   分派时必须携带：总目标、子任务、已知输入、约束、期望格式、验收标准、不要做什么。
4. 校验：队员回报后检查完整性、一致性、事实依据与验收标准。不合格则追问、重试、换人或降级。
5. 冲突：队员结论冲突时，列出来源、证据、假设、置信度，按领域权威、数据新鲜度、可验证性裁决；不能裁决则请用户决定。
6. 汇总：去重、校对、统一术语与格式。最终答复包含：结论/交付物、关键依据、风险与限制、下一步建议。不要暴露冗长内部推理。
7. 异常：队员超时/失败/空结果时，记录原因，尝试一次修复；仍失败则换人或降级，并明确告知用户。
8. 边界：不越权调用工具或访问数据；不泄露隐私与密钥；不把未确认信息写成事实。
9. 队员之间默认不互通，所有跨队员信息由你传递，并标注来源。`;

/** Clamp / fill squad settings. Empty / legacy serial-only defaults → parallel-star defaults. */
export function normalizeSquadSettings(raw: unknown): SquadSettings {
  const src =
    raw && typeof raw === 'object' ? (raw as Partial<Record<keyof SquadSettings, unknown>>) : {};
  const personaRaw =
    typeof src.captainPersona === 'string' ? src.captainPersona.trim() : '';
  const playbookRaw = typeof src.playbook === 'string' ? src.playbook.trim() : '';
  const persona =
    !personaRaw || personaRaw === LEGACY_DEFAULT_SQUAD_CAPTAIN_PERSONA ? '' : personaRaw;
  const playbook =
    !playbookRaw || playbookRaw === LEGACY_DEFAULT_SQUAD_PLAYBOOK ? '' : playbookRaw;

  return {
    captainPersona: persona || DEFAULT_SQUAD_CAPTAIN_PERSONA,
    playbook: playbook || DEFAULT_SQUAD_PLAYBOOK,
    captainMaxTurns: normalizeMaxTurns(src.captainMaxTurns, DEFAULT_SQUAD_SETTINGS.captainMaxTurns),
    memberMaxTurns: normalizeMaxTurns(src.memberMaxTurns, DEFAULT_SQUAD_SETTINGS.memberMaxTurns),
  };
}

/**
 * Global 1:1 instruction templates (`settings.json` → `instructions`).
 * `{name}` is replaced with botName || 'OkBot' when building the system prompt.
 * Also holds SOUL.md / skills silent-refresh knobs (UI under 设置 → 指令).
 */
export interface InstructionsSettings {
  /** Opening role sentence for 1:1 assistants. Empty / whitespace → default. */
  assistantRoleTemplate: string;
  /**
   * Full system prompt for refreshSoulMd. Empty → default.
   * Settings JSON key: `soulMdRefreshSystemPrompt` (migrates from legacy `agentsMdRefreshSystemPrompt` on load).
   */
  soulMdRefreshSystemPrompt: string;
  /**
   * How many recent user/assistant messages refreshSoulMd analyzes. Default 12; clamp 1–100.
   * Settings JSON key: `soulMdRecentMessageLimit` (migrates from legacy `agentsMdRecentMessageLimit` on load).
   */
  soulMdRecentMessageLimit: number;
  /** The create/update decision line injected into refreshBotSkills system prompt. Empty → default. */
  skillsCreateUpdateInstruction: string;
  /** How many recent messages refreshBotSkills analyzes. Default 20; clamp 1–100. */
  skillsRecentMessageLimit: number;
}

export const DEFAULT_ASSISTANT_ROLE_TEMPLATE =
  '你是「{name}」，一个可使用授权工具在已连接电脑上工作的个人助手。';

/** Exact prior default; persisted copies upgrade to DEFAULT_ASSISTANT_ROLE_TEMPLATE. */
export const LEGACY_DEFAULT_ASSISTANT_ROLE_TEMPLATE =
  '你是「{name}」，一个可使用本机工具的桌面个人助手。';

/**
 * Older AGENTS.md / SOUL.md refresh system prompts (exact text). Persisted settings that
 * still store any of these exact defaults are upgraded to DEFAULT_SOUL_MD_REFRESH_SYSTEM_PROMPT.
 * Bodies keep historical AGENTS.md wording so on-disk custom-or-default matching still works.
 */
export const LEGACY_DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT = [
  '你负责维护桌面助手机器人的 AGENTS.md（系统提示词）。',
  '只写入值得跨会话记住的内容：用户偏好、长期目标、项目路径/技术栈、反复出现的约束。',
  '不要写入一次性任务细节、密钥、冗长日志或与助手无关的闲聊。',
  '保持 Markdown，保留原有章节结构（角色与目标 / 用户偏好 / 项目与环境 / 工作备注），可增删条目。',
  '若无需更新，只输出一行：NO_CHANGE',
  '若需更新，只输出完整的新 AGENTS.md 正文（不要代码围栏，不要解释）。',
].join('\n');

/** Prior default that added the no-absolute-capability-denial clause + NO_CHANGE sentinel. */
export const LEGACY_AGENTS_MD_REFRESH_WITH_VISION_GUARD = [
  '你负责维护桌面助手机器人的 AGENTS.md（系统提示词）。',
  '只写入值得跨会话记住的内容：用户偏好、长期目标、项目路径/技术栈、反复出现的约束。',
  '不要写入一次性任务细节、密钥、冗长日志或与助手无关的闲聊。',
  '不要写入绝对的能力否定（例如「无图像处理能力」「不能看图」「只支持文本」）：视觉取决于当前模型与用户是否附带图片，本机工具列表以系统注入为准，勿在 AGENTS.md 里写死。',
  '保持 Markdown，保留原有章节结构（角色与目标 / 用户偏好 / 项目与环境 / 工作备注），可增删条目。',
  '若无需更新，只输出一行：NO_CHANGE',
  '若需更新，只输出完整的新 AGENTS.md 正文（不要代码围栏，不要解释）。',
].join('\n');

/**
 * Previous default that asked the model to emit a full AGENTS.md replacement.
 * Exact persisted copies upgrade to the section-patch default.
 */
export const LEGACY_AGENTS_MD_REFRESH_FULL_FILE = [
  '你负责维护桌面助手机器人的 AGENTS.md（系统提示词）。',
  '只写入值得跨会话记住的内容：用户偏好、长期目标、项目路径/技术栈、反复出现的约束。',
  '不要写入一次性任务细节、密钥、冗长日志或与助手无关的闲聊。',
  '保持 Markdown，保留原有章节结构（角色与目标 / 用户偏好 / 项目与环境 / 工作备注），可增删条目。',
  '若需更新，只输出完整的新 AGENTS.md 正文（不要代码围栏，不要解释）。否则不要输出任何正文。',
].join('\n');

/** Prior section-patch default that still said「桌面助手机器人」; upgrade to assistant wording. */
export const LEGACY_AGENTS_MD_REFRESH_WITH_ROBOT = [
  '你负责维护桌面助手机器人的 AGENTS.md（系统提示词）。',
  '只写入值得跨会话记住的内容：用户偏好、长期目标、项目路径/技术栈、反复出现的约束。',
  '不要写入一次性任务细节、密钥、冗长日志或与助手无关的闲聊。',
  '不要重写整份文件，不要删除未提到的章节。',
  '只输出有改动的章节。新约定可以追加为新章节。',
  '只输出 JSON，不要代码围栏，不要解释。',
  '无需更新：{"action":"none"}',
  '需要更新：{"action":"patch","sections":[{"heading":"用户偏好","body":"该章节的新正文（Markdown，不含标题行）"}]}',
  'heading 用现有章节名（不要带 #）。只列有变化的章节。',
].join('\n');

/**
 * Pre-SOUL section-patch default (AGENTS.md product name + old section themes).
 * Exact persisted copies upgrade to DEFAULT_SOUL_MD_REFRESH_SYSTEM_PROMPT.
 */
export const LEGACY_AGENTS_MD_REFRESH_SECTION_PATCH = [
  '你负责维护桌面助手的 AGENTS.md（系统提示词）。',
  '只写入值得跨会话记住的内容：用户偏好、长期目标、项目路径/技术栈、反复出现的约束。',
  '不要写入一次性任务细节、密钥、冗长日志或与助手无关的闲聊。',
  '不要重写整份文件，不要删除未提到的章节。',
  '只输出有改动的章节。新约定可以追加为新章节。',
  '只输出 JSON，不要代码围栏，不要解释。',
  '无需更新：{"action":"none"}',
  '需要更新：{"action":"patch","sections":[{"heading":"用户偏好","body":"该章节的新正文（Markdown，不含标题行）"}]}',
  'heading 用现有章节名（不要带 #）。只列有变化的章节。',
].join('\n');

/** Full default system prompt for silent SOUL.md maintenance (section patches only). */
export const DEFAULT_SOUL_MD_REFRESH_SYSTEM_PROMPT = [
  '你负责维护桌面助手的 SOUL.md（个性、边界、语气、约束、安全红线与输入输出习惯）。',
  '只写入跨会话仍成立的内容：个性与边界、语气与表达、长期约束、安全红线、稳定的输入/输出习惯。',
  '不要写入一次性任务细节、密钥、冗长日志或与助手无关的闲聊。',
  '不要重写整份文件，不要删除未提到的章节。',
  '只输出有改动的章节。新约定可以追加为新章节。',
  '合并后全文不超过 2000 字。',
  '只输出 JSON，不要代码围栏，不要解释。',
  '无需更新：{"action":"none"}',
  '需要更新：{"action":"patch","sections":[{"heading":"个性与边界","body":"该章节的新正文（Markdown，不含标题行）"}]}',
  'heading 用现有章节名（不要带 #），常见章节：个性与边界 / 语气与表达 / 约束 / 安全红线 / 输入输出习惯。只列有变化的章节。',
].join('\n');

export const DEFAULT_SOUL_MD_RECENT_MESSAGE_LIMIT = 12;

/** Default create/update gate line for refreshBotSkills (one system line only). */
export const DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION =
  '仅当对话中出现「固定多步流程」，或同一类事情已做/将做至少两遍时，才新增或更新 skill。技能 slug、name 与文件名均须以 okbot- 为前缀。description 写清能力与何时使用（含触发词与「勿用于」），最多 1024 字；触发说明只写在 description，body 只写步骤。';

/** Exact prior defaults; persisted copies upgrade to DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION. */
export const LEGACY_DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION =
  '仅当对话中出现「固定多步流程」，或同一类事情已做/将做至少两遍时，才新增或更新 skill。技能 slug（目录名）必须以 okbot- 为前缀。';

/** Prior default (okbot- prefix on slug/name/file); upgrade in place. */
export const LEGACY_DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION_V2 =
  '仅当对话中出现「固定多步流程」，或同一类事情已做/将做至少两遍时，才新增或更新 skill。技能slug（目录名）、技能name（名称）和文件name（skill文件名）必须以okbot-为前缀。';

/**
 * Fixed refreshBotSkills lines: how to write skill.description / body
 * (always injected; not replaced by skillsCreateUpdateInstruction).
 */
export const DEFAULT_SKILLS_DESCRIPTION_FORMAT_INSTRUCTION = [
  'description 必填，最多 1024 字：能力 + 何时使用（须含「何时使用」或 Use when…）；第三人称、动词开头（如「从…提取…」/ Extract…）；含清晰触发关键词；尽量写「勿用于」或 Do NOT use for… 减少误触发。避免「我能」「你可以」第一人称助手口吻。',
  '「何时使用」/ Use when / 「勿用于」/ Do NOT use for 等触发说明只写在 description 字段，不要写入 body。',
  'body 只写可执行步骤（Steps/做法），中文优先；不要重复 description 的触发说明，不要单独的 When/何时使用 章节。',
].join('\n');

export const DEFAULT_SKILLS_RECENT_MESSAGE_LIMIT = 20;

export const DEFAULT_INSTRUCTIONS_SETTINGS: InstructionsSettings = {
  assistantRoleTemplate: DEFAULT_ASSISTANT_ROLE_TEMPLATE,
  soulMdRefreshSystemPrompt: DEFAULT_SOUL_MD_REFRESH_SYSTEM_PROMPT,
  soulMdRecentMessageLimit: DEFAULT_SOUL_MD_RECENT_MESSAGE_LIMIT,
  skillsCreateUpdateInstruction: DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION,
  skillsRecentMessageLimit: DEFAULT_SKILLS_RECENT_MESSAGE_LIMIT,
};

/** Clamp / fill instructions settings. Empty strings → defaults; limits → 1–100. */
export function normalizeInstructionsSettings(raw: unknown): InstructionsSettings {
  const src =
    raw && typeof raw === 'object'
      ? (raw as Partial<Record<keyof InstructionsSettings, unknown>>)
      : {};
  const templateRaw =
    typeof src.assistantRoleTemplate === 'string' ? src.assistantRoleTemplate.trim() : '';
  const template =
    !templateRaw || templateRaw === LEGACY_DEFAULT_ASSISTANT_ROLE_TEMPLATE ? '' : templateRaw;
  // Prefer new keys; fall back to legacy agentsMd* so custom prompts are not wiped.
  const srcAny = src as Partial<Record<string, unknown>>;
  const soulPromptCandidate =
    typeof srcAny.soulMdRefreshSystemPrompt === 'string'
      ? srcAny.soulMdRefreshSystemPrompt
      : typeof srcAny.agentsMdRefreshSystemPrompt === 'string'
        ? srcAny.agentsMdRefreshSystemPrompt
        : '';
  const soulPromptRaw = soulPromptCandidate.trim();
  // Upgrade exact legacy defaults (pre-vision-guard / vision-guard+NO_CHANGE / pre-SOUL) in place.
  const soulPrompt =
    !soulPromptRaw ||
    soulPromptRaw === LEGACY_DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT ||
    soulPromptRaw === LEGACY_AGENTS_MD_REFRESH_WITH_VISION_GUARD ||
    soulPromptRaw === LEGACY_AGENTS_MD_REFRESH_FULL_FILE ||
    soulPromptRaw === LEGACY_AGENTS_MD_REFRESH_WITH_ROBOT ||
    soulPromptRaw === LEGACY_AGENTS_MD_REFRESH_SECTION_PATCH
      ? ''
      : soulPromptRaw;
  const skillsInstrRaw =
    typeof src.skillsCreateUpdateInstruction === 'string'
      ? src.skillsCreateUpdateInstruction.trim()
      : '';
  const skillsInstr =
    !skillsInstrRaw ||
    skillsInstrRaw === LEGACY_DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION ||
    skillsInstrRaw === LEGACY_DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION_V2
      ? ''
      : skillsInstrRaw;
  const soulLimitRaw =
    srcAny.soulMdRecentMessageLimit !== undefined
      ? srcAny.soulMdRecentMessageLimit
      : srcAny.agentsMdRecentMessageLimit;
  return {
    assistantRoleTemplate: template || DEFAULT_ASSISTANT_ROLE_TEMPLATE,
    soulMdRefreshSystemPrompt: soulPrompt || DEFAULT_SOUL_MD_REFRESH_SYSTEM_PROMPT,
    soulMdRecentMessageLimit: normalizeMaxTurns(
      soulLimitRaw,
      DEFAULT_SOUL_MD_RECENT_MESSAGE_LIMIT,
    ),
    skillsCreateUpdateInstruction:
      skillsInstr || DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION,
    skillsRecentMessageLimit: normalizeMaxTurns(
      src.skillsRecentMessageLimit,
      DEFAULT_SKILLS_RECENT_MESSAGE_LIMIT,
    ),
  };
}

/** Resolve the 1:1 opening role line from a template + bot display name. */
export function resolveAssistantRoleLine(template: string | undefined | null, botName: string): string {
  const name = (botName || '').trim() || 'OkBot';
  const raw = (template ?? '').trim() || DEFAULT_ASSISTANT_ROLE_TEMPLATE;
  return raw.replaceAll('{name}', name);
}

/**
 * Memory refresh / global memory knobs (`settings.json` → `memory`).
 * `scopeInstruction` is the single line that teaches the model global vs bot scope.
 */
export interface MemorySettings {
  /** Injected into refreshMemories system prompt as the scope=global vs scope=bot rule line. */
  scopeInstruction: string;
  /** How many recent messages refreshMemories analyzes. Default 20; clamp 1–100. */
  recentMessageLimit: number;
  /** Max memory bullets injected into the system prompt. Default 40; clamp 5–200. */
  promptMaxEntries: number;
  /** Max chars for memory bullets in the system prompt. Default 4000; clamp 500–20000. */
  promptMaxChars: number;
}

export const DEFAULT_MEMORY_SCOPE_INSTRUCTION =
  '默认 scope=bot（本助手记忆）。仅当内容属于：用户身份/称呼、长期习惯与偏好、本机电脑环境、跨助手通用配置，或用户明确要求写入全局记忆时，才用 scope=global；其余一律 scope=bot。拿不准时选 bot。';

export const DEFAULT_MEMORY_RECENT_MESSAGE_LIMIT = 20;

export const DEFAULT_MEMORY_PROMPT_MAX_ENTRIES = 40;
export const DEFAULT_MEMORY_PROMPT_MAX_CHARS = 4_000;

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  scopeInstruction: DEFAULT_MEMORY_SCOPE_INSTRUCTION,
  recentMessageLimit: DEFAULT_MEMORY_RECENT_MESSAGE_LIMIT,
  promptMaxEntries: DEFAULT_MEMORY_PROMPT_MAX_ENTRIES,
  promptMaxChars: DEFAULT_MEMORY_PROMPT_MAX_CHARS,
};

/** Clamp / fill memory settings. Empty scope instruction → default; limit → 1–100. */
export function normalizeMemorySettings(raw: unknown): MemorySettings {
  const src =
    raw && typeof raw === 'object'
      ? (raw as Partial<Record<keyof MemorySettings, unknown>>)
      : {};
  const scopeInstruction =
    typeof src.scopeInstruction === 'string' ? src.scopeInstruction.trim() : '';
  // null/'' → defaults (Number(null)===0 would clamp to the floor extremes).
  let promptMaxEntries: number;
  if (src.promptMaxEntries == null || src.promptMaxEntries === '') {
    promptMaxEntries = DEFAULT_MEMORY_PROMPT_MAX_ENTRIES;
  } else if (typeof src.promptMaxEntries === 'string' && !src.promptMaxEntries.trim()) {
    promptMaxEntries = DEFAULT_MEMORY_PROMPT_MAX_ENTRIES;
  } else {
    promptMaxEntries =
      typeof src.promptMaxEntries === 'number' ? src.promptMaxEntries : Number(src.promptMaxEntries);
    if (!Number.isFinite(promptMaxEntries)) promptMaxEntries = DEFAULT_MEMORY_PROMPT_MAX_ENTRIES;
  }
  promptMaxEntries = Math.min(200, Math.max(5, Math.floor(promptMaxEntries)));

  let promptMaxChars: number;
  if (src.promptMaxChars == null || src.promptMaxChars === '') {
    promptMaxChars = DEFAULT_MEMORY_PROMPT_MAX_CHARS;
  } else if (typeof src.promptMaxChars === 'string' && !src.promptMaxChars.trim()) {
    promptMaxChars = DEFAULT_MEMORY_PROMPT_MAX_CHARS;
  } else {
    promptMaxChars =
      typeof src.promptMaxChars === 'number' ? src.promptMaxChars : Number(src.promptMaxChars);
    if (!Number.isFinite(promptMaxChars)) promptMaxChars = DEFAULT_MEMORY_PROMPT_MAX_CHARS;
  }
  promptMaxChars = Math.min(20_000, Math.max(500, Math.floor(promptMaxChars)));

  return {
    scopeInstruction: scopeInstruction || DEFAULT_MEMORY_SCOPE_INSTRUCTION,
    recentMessageLimit: normalizeMaxTurns(
      src.recentMessageLimit,
      DEFAULT_MEMORY_RECENT_MESSAGE_LIMIT,
    ),
    promptMaxEntries,
    promptMaxChars,
  };
}

/**
 * Post-turn silent maintenance throttle (`settings.json` → `maintenance`).
 * Memory refreshes more often than SOUL.md / skills. User phrases like
 * 「记住」/ remember / 「别忘了」 force an immediate memory refresh.
 */
export interface MaintenanceSettings {
  /** Run memory refresh every N successful turns (default 2). Clamp 1–50. */
  memoryEveryTurns: number;
  /** Or when user chars since last memory refresh ≥ this (default 400). Clamp 50–20000. */
  memoryEveryUserChars: number;
  /** SOUL.md refresh every N turns (default 5). Clamp 1–50. Settings key migrates from agentsEveryTurns. */
  soulEveryTurns: number;
  /** Or when user chars since last SOUL refresh ≥ this (default 1200). Migrates from agentsEveryUserChars. */
  soulEveryUserChars: number;
  /** Skills refresh every N turns (default 5). Clamp 1–50. */
  skillsEveryTurns: number;
  /** Or when user chars since last skills refresh ≥ this (default 1200). */
  skillsEveryUserChars: number;
}

export const DEFAULT_MAINTENANCE_SETTINGS: MaintenanceSettings = {
  memoryEveryTurns: 2,
  memoryEveryUserChars: 400,
  soulEveryTurns: 5,
  soulEveryUserChars: 1200,
  skillsEveryTurns: 5,
  skillsEveryUserChars: 1200,
};

function clampMaintTurns(raw: unknown, fallback: number): number {
  // null/'' → fallback (Number(null)===0 would wrongly clamp to 1 = every turn).
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'string' && !raw.trim()) return fallback;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

function clampMaintChars(raw: unknown, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'string' && !raw.trim()) return fallback;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(20_000, Math.max(50, Math.floor(n)));
}

export function normalizeMaintenanceSettings(raw: unknown): MaintenanceSettings {
  const src =
    raw && typeof raw === 'object'
      ? (raw as Partial<Record<keyof MaintenanceSettings, unknown>>)
      : {};
  return {
    memoryEveryTurns: clampMaintTurns(src.memoryEveryTurns, DEFAULT_MAINTENANCE_SETTINGS.memoryEveryTurns),
    memoryEveryUserChars: clampMaintChars(
      src.memoryEveryUserChars,
      DEFAULT_MAINTENANCE_SETTINGS.memoryEveryUserChars,
    ),
    soulEveryTurns: clampMaintTurns(
      (src as Partial<Record<string, unknown>>).soulEveryTurns ??
        (src as Partial<Record<string, unknown>>).agentsEveryTurns,
      DEFAULT_MAINTENANCE_SETTINGS.soulEveryTurns,
    ),
    soulEveryUserChars: clampMaintChars(
      (src as Partial<Record<string, unknown>>).soulEveryUserChars ??
        (src as Partial<Record<string, unknown>>).agentsEveryUserChars,
      DEFAULT_MAINTENANCE_SETTINGS.soulEveryUserChars,
    ),
    skillsEveryTurns: clampMaintTurns(src.skillsEveryTurns, DEFAULT_MAINTENANCE_SETTINGS.skillsEveryTurns),
    skillsEveryUserChars: clampMaintChars(
      src.skillsEveryUserChars,
      DEFAULT_MAINTENANCE_SETTINGS.skillsEveryUserChars,
    ),
  };
}

/** Built-in always-on local desktop computer id. */
export const LOCAL_COMPUTER_ID = 'local';

/**
 * Named remote cloud computer (Docker sandbox) registered in settings.
 * Local is always available as `LOCAL_COMPUTER_ID` and is not stored in this list.
 */
export interface ComputerEntry {
  id: string;
  name: string;
  /** Hostname or IP (e.g. 127.0.0.1 or LAN IP of Mac mini). */
  host: string;
  /** Sandbox HTTP port. Default 18790. */
  port: number;
  /** Bearer token matching SANDBOX_TOKEN. */
  token: string;
  /** When false, not offered as a default and not used for routing. Default true. */
  enabled: boolean;
}

export const DEFAULT_SANDBOX_PORT = 18790;

export function generateComputerId(): string {
  return createId('computer');
}

export function generateComputerToken(): string {
  return generateLocalHttpApiToken();
}

export function normalizeComputerEntry(raw: unknown): ComputerEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<ComputerEntry>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const host = typeof o.host === 'string' ? o.host.trim() : '';
  let port =
    typeof o.port === 'number' && Number.isFinite(o.port) ? Math.floor(o.port) : DEFAULT_SANDBOX_PORT;
  if (port < 1 || port > 65535) port = DEFAULT_SANDBOX_PORT;
  const token = typeof o.token === 'string' ? o.token.trim() : '';
  if (!id || id === LOCAL_COMPUTER_ID) return null;
  if (!name || !host || !token) return null;
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(token)) return null;
  const enabled = (o as { enabled?: unknown }).enabled === false ? false : true;
  return { id, name, host, port, token, enabled };
}

export function normalizeComputers(raw: unknown): ComputerEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ComputerEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const c = normalizeComputerEntry(item);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/**
 * Default shell/fs computer. Empty, `local`, or an id that is not in `computers`
 * becomes `local`. Callers do not have to pick one before chat works.
 */
export function normalizeDefaultComputerId(raw: unknown, computers: ComputerEntry[]): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id || id === LOCAL_COMPUTER_ID) return LOCAL_COMPUTER_ID;
  if (computers.some((c) => c.id === id && c.enabled !== false)) return id;
  return LOCAL_COMPUTER_ID;
}

/**
 * User-chosen default assistant (`settings.json` → `defaultAssistantId`).
 * Empty / unknown id → none. Validated against current bot ids when provided.
 */
export function normalizeDefaultAssistantId(
  raw: unknown,
  bots?: ReadonlyArray<{ id: string }> | ReadonlyArray<string>,
): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return '';
  if (!bots) return id;
  for (const b of bots) {
    const bid = typeof b === 'string' ? b : b.id;
    if (bid === id) return id;
  }
  return '';
}

/** True when `tz` is a valid IANA zone for Intl. */
export function isValidIanaTimezone(tz: string): boolean {
  const id = (tz || '').trim();
  if (!id) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: id }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * User timezone preference (`settings.json` → `timezone`).
 * Empty string = auto-detect host local at use time. Invalid → ''.
 */
export function normalizeTimezone(raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return '';
  return isValidIanaTimezone(id) ? id : '';
}

/** Host IANA timezone (Intl); falls back to UTC. */
export function detectHostTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Effective app timezone: explicit settings.timezone when valid, else host local.
 */
export function resolveAppTimezone(settingsTimezone: string | undefined | null): string {
  const n = normalizeTimezone(settingsTimezone);
  return n || detectHostTimezone();
}

/** All IANA zones from Intl when available (sorted). */
export function listIanaTimezones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof fn === 'function') {
      const list = fn.call(Intl, 'timeZone');
      if (Array.isArray(list) && list.length) return list.slice().sort((a, b) => a.localeCompare(b));
    }
  } catch {
    /* fall through */
  }
  return ['UTC'];
}

/** Current wall-clock time label in a zone (HH:MM, 24h). */
export function formatTimezoneLocalTime(timeZone: string, now: Date = new Date()): string {
  const tz = normalizeTimezone(timeZone) || detectHostTimezone();
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(now);
  } catch {
    return '';
  }
}

/**
 * Sidebar session pin order (`settings.json` → `pinnedOwnerIds`).
 * Stable array of bot/squad owner ids (first = leftmost). Dedupe; trim empties.
 * When `knownIds` is provided, drop ids not in the current roster.
 */
export function normalizePinnedOwnerIds(
  raw: unknown,
  knownIds?: ReadonlySet<string> | ReadonlyArray<{ id: string }> | ReadonlyArray<string>,
): string[] {
  if (!Array.isArray(raw)) return [];
  let known: Set<string> | null = null;
  if (knownIds) {
    known = new Set<string>();
    if (knownIds instanceof Set) {
      for (const id of knownIds) known.add(id);
    } else {
      for (const b of knownIds) {
        known.add(typeof b === 'string' ? b : b.id);
      }
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    if (known && !known.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Sidebar hidden assistants/squads (`settings.json` → `hiddenOwnerIds`).
 * Same shape as pinnedOwnerIds: stable owner-id list, deduped, optional roster filter.
 */
export function normalizeHiddenOwnerIds(
  raw: unknown,
  knownIds?: ReadonlySet<string> | ReadonlyArray<{ id: string }> | ReadonlyArray<string>,
): string[] {
  return normalizePinnedOwnerIds(raw, knownIds);
}

/** Sentinel id for the virtual default group 「未分组」 (not stored in ownerGroups). */
export const UNGROUPED_OWNER_GROUP_ID = '__ungrouped__';

/** Default name for a newly created custom owner group. */
export const DEFAULT_NEW_OWNER_GROUP_NAME = '新建分组';

/** One custom sidebar group for assistants/squads (`settings.json` → `ownerGroups`). */
export interface OwnerGroup {
  id: string;
  name: string;
}

/**
 * Pick a unique new-group label: `base`, then `base1`, `base2`, … until unused.
 * Compares against existing custom group names (trimmed).
 */
export function allocateUniqueOwnerGroupName(
  existing: ReadonlyArray<OwnerGroup | string>,
  base: string = DEFAULT_NEW_OWNER_GROUP_NAME,
): string {
  const names = new Set<string>();
  for (const item of existing) {
    const n = typeof item === 'string' ? item.trim() : String(item?.name ?? '').trim();
    if (n) names.add(n);
  }
  const root = base.trim() || DEFAULT_NEW_OWNER_GROUP_NAME;
  if (!names.has(root)) return root;
  let n = 1;
  while (names.has(`${root}${n}`)) n += 1;
  return `${root}${n}`;
}

/**
 * Ordered custom owner groups. Does not include the virtual 「未分组」.
 * Dedupe by id; trim empties; cap name length. Unknown / sentinel ids dropped.
 */
export function normalizeOwnerGroups(raw: unknown): OwnerGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: OwnerGroup[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    if (!id || id === UNGROUPED_OWNER_GROUP_ID || seen.has(id)) continue;
    let name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) name = DEFAULT_NEW_OWNER_GROUP_NAME;
    if (name.length > 64) name = name.slice(0, 64);
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

/**
 * ownerId → custom group id. Absent / null / unknown group → 「未分组」.
 * When `groups` is provided, drop memberships whose groupId is not in that list.
 * When `knownIds` is provided, drop owner ids not in the roster.
 */
export function normalizeOwnerGroupMembership(
  raw: unknown,
  groups?: ReadonlyArray<OwnerGroup>,
  knownIds?: ReadonlySet<string> | ReadonlyArray<{ id: string }> | ReadonlyArray<string>,
): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  let known: Set<string> | null = null;
  if (knownIds) {
    known = new Set<string>();
    if (knownIds instanceof Set) {
      for (const id of knownIds) known.add(id);
    } else {
      for (const b of knownIds) {
        known.add(typeof b === 'string' ? b : b.id);
      }
    }
  }
  const groupIds = groups ? new Set(groups.map((g) => g.id)) : null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ownerId = typeof k === 'string' ? k.trim() : '';
    if (!ownerId) continue;
    if (known && !known.has(ownerId)) continue;
    if (typeof v !== 'string') continue;
    const groupId = v.trim();
    if (!groupId || groupId === UNGROUPED_OWNER_GROUP_ID) continue;
    if (groupIds && !groupIds.has(groupId)) continue;
    out[ownerId] = groupId;
  }
  return out;
}

/** Create a stable new custom owner group id. */
export function createOwnerGroupId(): string {
  return createId('ogroup');
}

/**
 * Full sidebar group display order (`settings.json` → `ownerGroupOrder`).
 * Includes custom group ids and {@link UNGROUPED_OWNER_GROUP_ID}.
 * Missing / partial → customs in `groups` order, then 未分组 at the end.
 */
export function normalizeOwnerGroupOrder(
  raw: unknown,
  groups: ReadonlyArray<OwnerGroup> = [],
): string[] {
  const customIds = groups.map((g) => g.id);
  const allowed = new Set<string>([...customIds, UNGROUPED_OWNER_GROUP_ID]);
  const out: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const id = item.trim();
      if (!id || !allowed.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of customIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  if (!seen.has(UNGROUPED_OWNER_GROUP_ID)) {
    out.push(UNGROUPED_OWNER_GROUP_ID);
  }
  return out;
}

/** Default order: custom groups (as given), then 未分组. */
export function defaultOwnerGroupOrder(groups: ReadonlyArray<OwnerGroup>): string[] {
  return [...groups.map((g) => g.id), UNGROUPED_OWNER_GROUP_ID];
}

/**
 * Loopback HTTP API for external programs (`settings.json` → `localHttpApi`).
 * Default OFF. When enabled, main process binds 127.0.0.1 only.
 * When `bindLan` is true, binds 0.0.0.0 (intranet gateway) and can serve the web UI.
 */
export interface LocalHttpApiSettings {
  /** Master switch. Default false. */
  enabled: boolean;
  /** TCP port. Default 18765; clamp 1024–65535. */
  port: number;
  /** Shared secret; required on every request except health. Empty is allowed. A token is created only when none is saved. */
  token: string;
  /**
   * When true, bind 0.0.0.0 (LAN / desktop gateway) instead of 127.0.0.1.
   * Intranet use; auth token still required. Default false.
   */
  bindLan: boolean;
  /**
   * When true (and enabled), serve the built renderer UI over HTTP for mobile browsers.
   * Normalize defaults serveUi to true when bindLan is true.
   */
  serveUi: boolean;
}

export const DEFAULT_LOCAL_HTTP_API_PORT = 18765;

/** Cryptographically strong token for localHttpApi (48 hex chars). */
export function generateLocalHttpApiToken(): string {
  const bytes = new Uint8Array(24);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const DEFAULT_LOCAL_HTTP_API: LocalHttpApiSettings = {
  enabled: false,
  port: DEFAULT_LOCAL_HTTP_API_PORT,
  token: "", // filled when a server starts and none is saved
  bindLan: false,
  serveUi: false,
};

/** Keep only the token charset external clients can send safely. */
export function sanitizeLocalHttpApiToken(raw: string): string {
  return (raw || "").replace(/[^A-Za-z0-9_-]/g, "");
}

/**
 * Clamp / fill local HTTP API settings.
 * Disallowed characters are stripped (not silently replaced).
 * Does not generate a token. An empty value stays empty so a saved token is reused
 * instead of being replaced on read, on save, or when a window attaches.
 */
export function normalizeLocalHttpApiSettings(raw: unknown): LocalHttpApiSettings {
  const obj =
    raw && typeof raw === "object" ? (raw as Partial<Record<keyof LocalHttpApiSettings, unknown>>) : {};
  const enabled = obj.enabled === true;
  let port = typeof obj.port === "number" && Number.isFinite(obj.port) ? Math.floor(obj.port) : DEFAULT_LOCAL_HTTP_API_PORT;
  if (port < 1024 || port > 65535) port = DEFAULT_LOCAL_HTTP_API_PORT;
  const token = typeof obj.token === "string" ? sanitizeLocalHttpApiToken(obj.token) : "";
  const bindLan = obj.bindLan === true;
  // serveUi defaults to true when bindLan (gateway hosts UI); otherwise false
  const serveUi = obj.serveUi === true || (obj.serveUi !== false && bindLan);
  return { enabled, port, token, bindLan, serveUi };
}

/** Saved remote sources for the assistant marketplace (public URLs only). */
export type AssistantMarketplaceSettings = {
  /** Newest-first list of GitHub / raw / .okbot URLs the user saved. Max 20. */
  savedSources: string[];
};

const MAX_MARKETPLACE_SOURCES = 20;

export function normalizeAssistantMarketplaceSettings(raw: unknown): AssistantMarketplaceSettings {
  const src =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as { savedSources?: unknown }).savedSources
      : undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(src)) {
    for (const item of src) {
      if (typeof item !== 'string') continue;
      const u = item.trim();
      if (!u || u.length > 2000) continue;
      const key = u.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(u);
      if (out.length >= MAX_MARKETPLACE_SOURCES) break;
    }
  }
  return { savedSources: out };
}

export interface AppSettings {
  theme: ThemeMode;
  /** UI language. */
  language: LanguageCode;
  /**
   * Preferred IANA timezone for schedules / time display.
   * Empty string = auto-detect host local at use time.
   */
  timezone: string;
  /** Empty string = system default microphone. */
  microphoneId: string;
  /** Requires app restart when changed. Default true. */
  hardwareAcceleration: boolean;
  /** When true, check GitHub Releases for updates in the background. Default true. */
  autoUpdate: boolean;
  /**
   * Mac Dock–style icon magnification while the session sidebar is collapsed.
   * Default false (off).
   */
  sidebarDockMagnify: boolean;
  /**
   * Frost / glass translucency (sidebar vibrancy, drawers, pills, transparent
   * BrowserWindow on darwin). Default true; missing on disk = on.
   */
  translucent: boolean;
  /**
   * Shows developer-only settings (系统指令). Default false.
   * Missing on disk stays off.
   */
  developerMode: boolean;
  /** Master switch for keyword-based auto tool approval. */
  autoApprovalEnabled: boolean;
  autoApprovalRules: AutoApprovalRule[];
  /** Per-tool enable + default approval policy. */
  tools: ToolPreferences;
  /** Local tool path / shell guardrails. */
  security: SecuritySettings;
  model: ModelSettings;
  /** Summary+Buffer compression policy (sibling of model). */
  contextCompression: ContextCompressionSettings;
  /** 1:1 assistant instruction templates (role sentence, etc.). */
  instructions: InstructionsSettings;
  /** Memory refresh scope rule + global memory manager settings. */
  memory: MemorySettings;
  /** Post-turn AGENTS / skills / memory refresh throttle. */
  maintenance: MaintenanceSettings;
  /** Built-in squad captain defaults (persona / playbook / maxTurns). */
  squad: SquadSettings;
  /** 1:1 peer mesh bag (no caps; reserved). Squads ignore this. */
  mesh: MeshSettings;
  /** Local / LAN HTTP API + optional desktop gateway UI (default OFF). */
  localHttpApi: LocalHttpApiSettings;
  /**
   * Registered remote cloud computers (sandbox containers).
   * Always-on Local is implicit (`LOCAL_COMPUTER_ID`) and not listed here.
   */
  computers: ComputerEntry[];
  /**
   * Shell/fs computer when the conversation does not name one.
   * `local` or a `computers` id. Missing / unknown normalizes to `local`.
   */
  defaultComputerId: string;
  /**
   * User-chosen default assistant bot id (identity / UI only).
   * Empty string = none. Cleared when that bot is deleted or missing.
   */
  defaultAssistantId: string;
  /**
   * Sidebar pin order for assistants and squads (owner ids).
   * First entry is leftmost in the pin strip. Cleared entries when owners are deleted.
   */
  pinnedOwnerIds: string[];
  /**
   * Hidden assistants/squads (owner ids). Shown only in the bottom collapsed
   * 「已隐藏」 group. Cleared when owners are deleted. Hiding also unpins.
   */
  hiddenOwnerIds: string[];
  /**
   * Custom sidebar groups for assistants/squads (metadata + stable ids).
   * Virtual 「未分组」 is not listed here. Empty → main list stays flat.
   * Display order (including 未分组) is {@link ownerGroupOrder}.
   */
  ownerGroups: OwnerGroup[];
  /**
   * Display order of group headers: custom ids + {@link UNGROUPED_OWNER_GROUP_ID}.
   * Missing → customs then 未分组 (via normalizeOwnerGroupOrder).
   */
  ownerGroupOrder: string[];
  /**
   * ownerId → custom group id. Absent / unknown → 「未分组」.
   * Hidden owners still keep membership but only render under 「已隐藏」.
   */
  ownerGroupMembership: Record<string, string>;
  /**
   * System notification + unread when the window is not focused and a reply
   * finishes or a tool approval waits. Default true.
   */
  notifications: boolean;
  /**
   * What the window close button does (desktop Electron).
   * Default `ask`: first close offers Quit vs minimize/hide to tray; optional remember.
   */
  closeAction: CloseAction;
  /**
   * Shows advanced settings (security, gateway, computers, extensions, run limits,
   * compression). Default false for new users; migrated on for users who already
   * use an advanced feature.
   */
  showAdvancedSettings: boolean;
  /** Optional MCP servers ("advanced extensions"). Default off. */
  mcp: McpSettings;
  /**
   * Built-in web tools: third-party search provider + API key,
   * and web_fetch private-network allow flag.
   */
  web: WebSettings;
  /** Assistant marketplace: saved remote package sources. */
  assistantMarketplace: AssistantMarketplaceSettings;
}

/** Max chars for bot/squad roster description (sidebar / gallery blurb). */
export const OWNER_DESCRIPTION_MAX_CHARS = 200;

/** Trim + hard-cap roster description for bots and squads. */
export function clampOwnerDescription(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';
  return s.length <= OWNER_DESCRIPTION_MAX_CHARS
    ? s
    : s.slice(0, OWNER_DESCRIPTION_MAX_CHARS);
}

/**
 * Strip generic product capability / safety boilerplate from roster description.
 * Description is duties + work boundaries for assistant handoff only; tool laundry
 * lists and consent/secrets lines belong in SOUL.md, not bots.json description.
 */
export function sanitizeOwnerDescriptionDuties(raw: unknown): string {
  let s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';
  const cap =
    '(?:查资料|读写(?:本机)?文件|执行命令|生成图片|设定?时(?:提醒|任务)|(?:管理)?定时任务)';
  // Capability laundry lists (file/shell/web/schedule/image — product tools, not duties).
  s = s.replace(
    new RegExp(
      `(?:，|、|；|,|和|与)?(?:也(?:能|可)|并能|并可|可以|能|可|支持)?${cap}(?:(?:，|、|和|与)${cap})*等?`,
      'g',
    ),
    '',
  );
  // English-ish variants sometimes produced by the model.
  s = s.replace(
    /(?:[,;]\s*)?(?:also\s+)?(?:can\s+|supports?\s+)?(?:browse(?:\s+the\s+web)?|read\/?write\s+local\s+files|run\s+shell(?:\s+commands)?|generate\s+images?|set\s+reminders?|schedule\s+tasks?)(?:\s*(?:,|and)\s*(?:browse(?:\s+the\s+web)?|read\/?write\s+local\s+files|run\s+shell(?:\s+commands)?|generate\s+images?|set\s+reminders?|schedule\s+tasks?))*\.?/gi,
    '',
  );
  // Safety boilerplate (destructive-ops consent / secrets) — SOUL.md only.
  s = s.replace(/(?:，|、|；|,)?(?:涉及)?破坏性操作[^。；;!\n]*?(?:征得同意|先问(?:我|你)?)/g, '');
  s = s.replace(/(?:，|、|；|,)?不(?:写入?|传|泄露)[^。；;!\n]*?(?:密钥|令牌|验证码|敏感)[^。；;!\n]*/g, '');
  s = s.replace(/(?:[,;]\s*)?(?:ask\s+before\s+destructive\s+ops?|never\s+(?:write|share|leak)\s+secrets?)[^.;!\n]*/gi, '');
  // Tidy leftover punctuation / empty clauses.
  s = s.replace(/^[，、；,\s]+/g, '').replace(/[，、；,\s]+$/g, '');
  s = s.replace(/[，、]{2,}/g, '，').replace(/\s{2,}/g, ' ');
  s = s.replace(/，([。；;])/g, '$1');
  return clampOwnerDescription(s);
}

/** Max chars for skill frontmatter `description` (Cursor-style). */
export const SKILL_DESCRIPTION_MAX_CHARS = 1024;

/**
 * Soft floor for generated descriptions. Only rejects near-empty crumbs;
 * short Chinese one-liners (e.g. 「导出时用」) still pass.
 */
export const SKILL_DESCRIPTION_MIN_CHARS = 2;

/**
 * Soft-normalize skill description on upsert/write:
 * trim; empty / too-short → fallback; hard-clamp to SKILL_DESCRIPTION_MAX_CHARS.
 */
export function normalizeSkillDescription(raw: unknown, fallback = ''): string {
  let s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || s.length < SKILL_DESCRIPTION_MIN_CHARS) {
    const fb = typeof fallback === 'string' ? fallback.trim() : '';
    s = fb;
  }
  if (!s) return '';
  return s.length <= SKILL_DESCRIPTION_MAX_CHARS
    ? s
    : s.slice(0, SKILL_DESCRIPTION_MAX_CHARS);
}

/** Roster row in `~/.okbot/bots.json` (name card only). */
export interface BotRosterEntry {
  id: string;
  name: string;
  description: string;
}

/** How a bot's avatar is rendered in the UI. */
export type BotAvatarKind = 'emoji' | 'bot-avatar';

/**
 * libraries.dev `bot-avatars` body shapes (18).
 * Keep in sync with `botAvatarTypes` from the `bot-avatars` package.
 */
export const BOT_AVATAR_TYPES = [
  'clover',
  'flower',
  'triangle',
  'square',
  'blob',
  'ghost',
  'circle',
  'drop',
  'star',
  'droid',
  'mech',
  'alien',
  'hexagon',
  'cat',
  'cloud',
  'pill',
  'pebble',
  'puddle',
] as const;

export type BotAvatarShape = (typeof BOT_AVATAR_TYPES)[number];

export function normalizeBotAvatarKind(raw: unknown): BotAvatarKind {
  return raw === 'emoji' ? 'emoji' : 'bot-avatar';
}

export function normalizeBotAvatarType(raw: unknown): BotAvatarShape {
  if (typeof raw === 'string' && (BOT_AVATAR_TYPES as readonly string[]).includes(raw)) {
    return raw as BotAvatarShape;
  }
  return 'clover';
}

/** Random body shape for new-bot create (立体头像 default). */
export function randomBotAvatarType(): BotAvatarShape {
  return BOT_AVATAR_TYPES[Math.floor(Math.random() * BOT_AVATAR_TYPES.length)]!;
}

/** Per-bot detail in `~/.okbot/<botId>/bot.json`. */
export interface BotConfig {
  id: string;
  /**
   * Display name dual-written from `bots.json` so a bot folder is self-contained
   * for export/import. List UI still reads the central roster.
   */
  name: string;
  /** Short persona blurb; kept in sync with `bots.json` description. */
  description: string;
  /**
   * Avatar mode. Missing / unknown values normalize to `bot-avatar` on read
   * (early product: no dual-format shim; 立体头像 is the default).
   */
  avatarKind: BotAvatarKind;
  emoji: string;
  /**
   * Accent color: emoji circle fill, or optional body override for bot-avatar.
   * Empty / invalid → 「默认」: library palette when avatarKind is bot-avatar;
   * no colored circle (transparent) when avatarKind is emoji.
   */
  color: string;
  /** Shape when avatarKind === 'bot-avatar'. */
  botAvatarType?: BotAvatarShape;
  createdAt: string;
  updatedAt: string;
  /** False until the post-create two-step onboarding finishes. */
  onboardingComplete: boolean;
  /**
   * Optional model override. Both empty / omitted → global default provider+model at chat time.
   * Across providers the same model id is allowed; resolution uses providerId.
   */
  providerId?: string;
  modelId?: string;
  /** True when an assistant reply finished while this bot session was not selected. */
  hasUnreadReply?: boolean;
  /**
   * When true, selected skills from `~/.agents/skills` are injected alongside bot-local skills.
   * Default false.
   */
  useGlobalSkills: boolean;
  /**
   * Global skill slugs enabled for this bot when `useGlobalSkills` is on.
   * Default []; each switch starts off until the user enables it.
   */
  enabledGlobalSkills: string[];
}

/** One memory row stored as JSONL inside memory.md */
export interface MemoryEntry {
  id: string;
  /** Owning / related bot id (also set for bot-local memories). */
  bot_id: string;
  memory: string;
  /** ISO timestamp, or null for no expiry. */
  expires: string | null;
  /** When true, prefer keeping this row in the prompt over unpinned locals. */
  pinned?: boolean;
}

export interface BotSkill {
  /** Directory name under skills/, kebab-case. */
  slug: string;
  name: string;
  /**
   * Capability + when to use (Cursor-style). Required; max SKILL_DESCRIPTION_MAX_CHARS.
   * Triggers (何时使用 / Use when / 勿用于 / Do NOT use for) live here only — not in body.
   */
  description: string;
  /** Procedure / Steps markdown only (no When/trigger blurb). */
  body: string;
}

export interface BotOnboardingAnswers {
  scenarioId?: string;
  scenarioLabel?: string;
  howId?: string;
  howLabel?: string;
}

/** Runtime bot = roster + config (+ ephemeral UI fields). */
export interface Bot extends BotRosterEntry, BotConfig {
  /**
   * Latest assistant reply preview for the sidebar (not persisted).
   * Empty when the session has no assistant messages yet.
   */
  lastReplyPreview?: string;
}

/** One member seat inside a squad (role is per-squad, not on the bot). */
export interface SquadMember {
  botId: string;
  /** Short role label shown to captain + injected into that member asTool. */
  role: string;
}

/**
 * Speaker id for built-in virtual captain bubbles in squad transcripts.
 * Not a real bot id — UI uses the squad composite avatar.
 */
export const SQUAD_CAPTAIN_SPEAKER_ID = '__captain__';

/**
 * Squad (小队): star topology, Agents-as-Tools.
 * Captain is a built-in virtual orchestrator (not a roster bot); members are asTool.
 */
export interface Squad {
  id: string;
  name: string;
  description: string;
  members: SquadMember[];
  /**
   * Optional model override. Both empty / omitted → global default at chat time.
   */
  providerId?: string;
  modelId?: string;
  createdAt: string;
  updatedAt: string;
  /** Latest assistant reply preview for the sidebar (not persisted). */
  lastReplyPreview?: string;
  /** True when a squad reply finished while this session was not selected. */
  hasUnreadReply?: boolean;
}

/**
 * Per-squad profile in `~/.okbot/<squadId>/squad.json` (name card dual-write).
 * List UI still reads central `squads.json`; this file stays synced for folder export.
 */
export interface SquadConfig {
  id: string;
  name: string;
  description: string;
}

export interface CreateSquadInput {
  name: string;
  description?: string;
  members: SquadMember[];
  providerId?: string;
  modelId?: string;
}

/** Normalize one squad from disk; drops legacy leaderBotId / captainBotId / guidance. */
export function normalizeSquad(raw: unknown): Squad | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const id = typeof src.id === 'string' ? src.id.trim() : '';
  if (!id) return null;
  const name =
    typeof src.name === 'string' && src.name.trim() ? src.name.trim() : '未命名小队';
  const description = typeof src.description === 'string' ? src.description.trim() : '';
  const membersRaw = Array.isArray(src.members) ? src.members : [];
  const seen = new Set<string>();
  const members: SquadMember[] = [];
  for (const item of membersRaw) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const botId = typeof m.botId === 'string' ? m.botId.trim() : '';
    if (!botId || seen.has(botId)) continue;
    seen.add(botId);
    const role = typeof m.role === 'string' && m.role.trim() ? m.role.trim() : '成员';
    members.push({ botId, role });
  }
  const modelIdRaw = typeof src.modelId === 'string' ? src.modelId.trim() : '';
  const providerIdRaw = typeof src.providerId === 'string' ? src.providerId.trim() : '';
  const createdAt =
    typeof src.createdAt === 'string' && src.createdAt ? src.createdAt : new Date().toISOString();
  const updatedAt =
    typeof src.updatedAt === 'string' && src.updatedAt ? src.updatedAt : createdAt;
  const out: Squad = {
    id,
    name,
    description,
    members,
    createdAt,
    updatedAt,
  };
  // Keep raw fields; FileStorage rewrites legacy modelId-only via resolveModelRef on load.
  if (providerIdRaw) out.providerId = providerIdRaw;
  if (modelIdRaw) out.modelId = modelIdRaw;
  if (src.hasUnreadReply === true) out.hasUnreadReply = true;
  return out;
}

/** Hard cap for per-bot SOUL.md (write + post-refresh merge). */
export const SOUL_MD_MAX_CHARS = 2000;

/** Trim + hard-cap SOUL.md body. */
export function clampSoulMd(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+$/u, '') : '';
  if (!s) return '';
  if (s.length <= SOUL_MD_MAX_CHARS) {
    return s.endsWith('\n') ? s : `${s}\n`;
  }
  const sliced = s.slice(0, SOUL_MD_MAX_CHARS);
  return sliced.endsWith('\n') ? sliced : `${sliced}\n`;
}

export const DEFAULT_SOUL_MD = `# 个性与边界

你是用户的本机个人助手。保持清晰、可靠、有分寸的协作风格；在能力范围内主动帮忙，越界或不确定时先说明。

# 语气与表达

- 简洁清楚；不确定时先说明假设再行动

# 约束

- （随对话自动补充长期约定）

# 安全红线

- 涉及破坏性操作（删除、覆盖、推送、安装）前先征得同意
- 不写入或泄露密钥、令牌、验证码

# 输入输出习惯

- （随对话自动补充偏好的格式与交互方式）
`;


export const DEFAULT_SETTINGS: AppSettings = {
  notifications: true,
  closeAction: 'ask',
  showAdvancedSettings: false,
  mcp: { enabled: false, servers: [] },
  web: {
    search: { provider: 'tavily', apiKey: '', baseURL: '', compat: 'tavily' },
    fetch: { allowPrivateNetwork: false },
  },
  assistantMarketplace: { savedSources: [] },
  theme: 'system',
  language: 'system',
  timezone: '',
  microphoneId: '',
  hardwareAcceleration: true,
  autoUpdate: true,
  sidebarDockMagnify: false,
  translucent: true,
  developerMode: false,
  autoApprovalEnabled: false,
  autoApprovalRules: [],
  tools: {
    run_shell: { ...DEFAULT_TOOL_PREFERENCES.run_shell },
    read_file: { ...DEFAULT_TOOL_PREFERENCES.read_file },
    read_skill: { ...DEFAULT_TOOL_PREFERENCES.read_skill },
    write_file: { ...DEFAULT_TOOL_PREFERENCES.write_file },
    edit_file: { ...DEFAULT_TOOL_PREFERENCES.edit_file },
    generate_image: { ...DEFAULT_TOOL_PREFERENCES.generate_image },
    search_history: { ...DEFAULT_TOOL_PREFERENCES.search_history },
    manage_schedule: { ...DEFAULT_TOOL_PREFERENCES.manage_schedule },
    manage_task_progress: { ...DEFAULT_TOOL_PREFERENCES.manage_task_progress },
    send_message: { ...DEFAULT_TOOL_PREFERENCES.send_message },
    web_fetch: { ...DEFAULT_TOOL_PREFERENCES.web_fetch },
    web_search: { ...DEFAULT_TOOL_PREFERENCES.web_search },
  },
  security: { ...DEFAULT_SECURITY, deniedPathPrefixes: [...DEFAULT_DENIED_PATH_PREFIXES], allowedPathPrefixes: [] },
  model: {
    providers: [],
    defaultProviderId: '',
    defaultModelId: '',
  },
  contextCompression: { ...DEFAULT_CONTEXT_COMPRESSION },
  instructions: { ...DEFAULT_INSTRUCTIONS_SETTINGS },
  memory: { ...DEFAULT_MEMORY_SETTINGS },
  maintenance: { ...DEFAULT_MAINTENANCE_SETTINGS },
  squad: { ...DEFAULT_SQUAD_SETTINGS },
  mesh: { ...DEFAULT_MESH_SETTINGS },
  localHttpApi: { ...DEFAULT_LOCAL_HTTP_API, token: '' },
  computers: [],
  defaultComputerId: LOCAL_COMPUTER_ID,
  defaultAssistantId: '',
  pinnedOwnerIds: [],
  hiddenOwnerIds: [],
  ownerGroups: [],
  ownerGroupOrder: [UNGROUPED_OWNER_GROUP_ID],
  ownerGroupMembership: {},
};

export const EMOJI_PRESETS = [
  '🤖', '👑', '💻', '✍️', '📊', '🔍', '💼', '🌐',
  '🛠️', '📚', '📝', '🎨', '🧠', '📅', '💡', '⚡', '🎯',
] as const;

/** Preset accent colors for flattened emoji avatars. */
export const AVATAR_COLORS = [
  '#F97316',
  '#EF4444',
  '#EC4899',
  '#A855F7',
  '#6366F1',
  '#3B82F6',
  '#06B6D4',
  '#14B8A6',
  '#22C55E',
  '#84CC16',
  '#EAB308',
  '#A1A1AA',
  '#FFFFFF',
] as const;

export function defaultAvatarColor(seed = ''): string {
  if (!seed) return AVATAR_COLORS[4];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
