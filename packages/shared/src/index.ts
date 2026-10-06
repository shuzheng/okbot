import { isMcpToolName } from './mcp.js';
import type { McpSettings } from './mcp.js';

export * from './mcp.js';
export type ThemeMode = 'system' | 'light' | 'dark';
export type LanguageCode = 'system' | 'zh' | 'en';

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
   * When true (default if missing), render `<think>…</think>` as a collapsible block.
   * When false, strip think spans from display and from persisted assistant content.
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
  /** Resolved showThinking (`!== false` → true). */
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
export const CONTEXT_COMPRESS_RATIO = 0.8;
export const CONTEXT_KEEP_RECENT_MESSAGES = 5;
/** Floor for the recent buffer when fitting a smaller model window. */
export const CONTEXT_KEEP_RECENT_MIN = 5;
/** Soft cap for the rolling summary (Chinese chars / punctuation). */
export const CONTEXT_SUMMARY_MAX_CHARS = 800;
/** Rough chars→tokens for CJK-heavy chat (conservative). */
export const CHARS_PER_TOKEN_ESTIMATE = 2;

export const DEFAULT_CONTEXT_COMPRESSION: ContextCompressionSettings = {
  ratio: CONTEXT_COMPRESS_RATIO,
  keepRecentMax: CONTEXT_KEEP_RECENT_MESSAGES,
  keepRecentMin: CONTEXT_KEEP_RECENT_MIN,
  summaryMaxChars: CONTEXT_SUMMARY_MAX_CHARS,
  autoTopicCompress: true,
};

export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  // Mixed heuristic: CJK-ish ~2 chars/token; Latin-heavy ~4 chars/token.
  // Pure length/2 overestimated English by ~2× and triggered compress too early.
  let cjk = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      (c >= 0x3400 && c <= 0x9fff) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0x3040 && c <= 0x30ff) ||
      (c >= 0xac00 && c <= 0xd7af)
    ) {
      cjk += 1;
    }
  }
  const latin = Math.max(0, text.length - cjk);
  return Math.max(1, Math.ceil(cjk / 2 + latin / 4));
}

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
    // Default true when missing; only persist false when explicitly off.
    showThinking: src.showThinking === false ? false : undefined,
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

function normalizeCatalogModelsList(raw: unknown): CatalogModel[] {
  if (!Array.isArray(raw)) return [];
  const list: CatalogModel[] = [];
  for (const item of raw) {
    const m = normalizeCatalogModel(item);
    if (m) list.push(m);
  }
  return dedupeCatalogModels(list);
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
    showThinking: pick?.showThinking !== false,
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

/** Open/close tags MiniMax-style models emit for chain-of-thought. */
const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

export type ThinkParseResult = {
  /** Trimmed thinking segments in order (finished and unfinished open tags). */
  thinking: string[];
  /** Text outside think tags (leading/trailing newlines from tag removal cleaned). */
  answer: string;
  /** True when at least one `<think>` open tag was present. */
  hasThinking: boolean;
};

/**
 * Best-effort parse of `<think>…</think>` spans (multiple + unfinished open while streaming).
 * Skips fenced code blocks (``` / ~~~) so literal tags in examples stay in the answer.
 * Unclosed open tags only consume the rest when the tag sits on its own line (or file start);
 * otherwise the literal is left in the answer to avoid irreversible truncation.
 * Nested/malformed tags are not specially handled; never throws.
 */
export function parseThinkContent(text: string): ThinkParseResult {
  if (!text || !text.includes(THINK_OPEN)) {
    return { thinking: [], answer: text || '', hasThinking: false };
  }

  // Mask fenced regions so indexOf never matches tags inside ``` / ~~~ blocks.
  const masked = text.split('');
  const n = text.length;
  let p = 0;
  while (p < n) {
    const fence = text.startsWith('```', p) ? '```' : text.startsWith('~~~', p) ? '~~~' : null;
    if (!fence) {
      p += 1;
      continue;
    }
    const openEnd = text.indexOf('\n', p);
    const contentStart = openEnd < 0 ? n : openEnd + 1;
    let close = -1;
    let q = contentStart;
    while (q < n) {
      const lineStart = q;
      const lineEnd = text.indexOf('\n', q);
      const end = lineEnd < 0 ? n : lineEnd;
      const line = text.slice(lineStart, end);
      if (line.trimStart().startsWith(fence)) {
        close = lineStart;
        break;
      }
      q = end < n ? end + 1 : n;
    }
    const maskUntil = close < 0 ? n : Math.min(n, close + fence.length);
    for (let k = p; k < maskUntil; k++) masked[k] = ' ';
    p = maskUntil;
  }
  const scan = masked.join('');

  const thinking: string[] = [];
  let answer = '';
  let i = 0;
  let hasThinking = false;
  while (i < text.length) {
    const openIdx = scan.indexOf(THINK_OPEN, i);
    if (openIdx < 0) {
      answer += text.slice(i);
      break;
    }
    answer += text.slice(i, openIdx);
    const contentStart = openIdx + THINK_OPEN.length;
    const closeIdx = scan.indexOf(THINK_CLOSE, contentStart);
    if (closeIdx < 0) {
      // Only treat as open thinking when `<think>` is alone on a line (streaming mid-think).
      const before = text.slice(0, openIdx);
      const lineStart = before.lastIndexOf('\n') + 1;
      const prefix = text.slice(lineStart, openIdx);
      const standalone = prefix.trim() === '';
      if (standalone) {
        hasThinking = true;
        const partial = text.slice(contentStart).trim();
        if (partial) thinking.push(partial);
      } else {
        answer += text.slice(openIdx);
      }
      break;
    }
    hasThinking = true;
    const segment = text.slice(contentStart, closeIdx).trim();
    if (segment) thinking.push(segment);
    i = closeIdx + THINK_CLOSE.length;
  }
  answer = answer.replace(/^\n+/, '').replace(/\n+$/, '');
  return { thinking, answer, hasThinking };
}

/** Remove all think spans; return answer-only text. */
export function stripThinkContent(text: string): string {
  return parseThinkContent(text).answer;
}

/** When showThinking is false, strip think spans; otherwise return text unchanged. */
export function applyShowThinkingToContent(text: string, showThinking: boolean): string {
  if (showThinking) return text;
  return stripThinkContent(text);
}

/**
 * Redact API keys / Bearer tokens from error strings before persist / toast / traces.
 * Mirrors testConnection; safe to run on already-redacted text.
 */
export function redactSensitiveText(msg: string, apiKey?: string): string {
  let s = String(msg ?? '');
  const key = (apiKey || '').trim();
  if (key) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(escaped, 'g'), '***');
  }
  s = s.replace(/Bearer\s+\S+/gi, 'Bearer ***');
  s = s.replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-***');
  s = s.replace(/sk-or-[A-Za-z0-9_\-]{8,}/g, 'sk-or-***');
  s = s.replace(/key-[A-Za-z0-9_\-]{8,}/g, 'key-***');
  return s.slice(0, 500);
}

/**
 * Strip `<think>` from assistant-role AgentInputItem-like objects (model / prompt-context).
 * Preserves shape (string content or Responses-style text parts). Non-assistant items unchanged.
 * Does not mutate `item`.
 */
export function stripThinkFromAgentInputItem<T extends Record<string, unknown>>(item: T): T {
  const role = typeof item.role === 'string' ? item.role : '';
  if (role !== 'assistant') return item;

  const content = item.content;
  if (typeof content === 'string') {
    const next = stripThinkContent(content);
    if (next === content) return item;
    return { ...item, content: next };
  }
  if (Array.isArray(content)) {
    let changed = false;
    const next = content.map((part) => {
      if (typeof part === 'string') {
        const stripped = stripThinkContent(part);
        if (stripped !== part) changed = true;
        return stripped;
      }
      if (!part || typeof part !== 'object') return part;
      const p = part as Record<string, unknown>;
      if (typeof p.text === 'string') {
        const stripped = stripThinkContent(p.text);
        if (stripped !== p.text) {
          changed = true;
          return { ...p, text: stripped };
        }
      }
      if (typeof p.refusal === 'string') {
        const stripped = stripThinkContent(p.refusal);
        if (stripped !== p.refusal) {
          changed = true;
          return { ...p, refusal: stripped };
        }
      }
      return part;
    });
    if (!changed) return item;
    return { ...item, content: next };
  }
  return item;
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
 * Global 1:1 chat max agent turns (`settings.json` root key `maxTurns`).
 * One turn ≈ one model call (tool executions in that loop do not add turns).
 * Missing / invalid → DEFAULT_MAX_TURNS; clamped to 1–100. No dual-format shims.
 */
export const DEFAULT_MAX_TURNS = 50;

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
 * Per-run tool circuit breakers + trajectory (`settings.json` root key `toolRun`).
 * 0 = unlimited for maxToolCalls / maxDurationSec. Missing → defaults. No dual-format shims.
 */
export interface ToolRunSettings {
  /** Max tool executions per single chat run (1:1 or squad outer run). 0 = unlimited. */
  maxToolCalls: number;
  /** Max wall-clock seconds per single chat run. 0 = unlimited. */
  maxDurationSec: number;
  /** When true, record per-run tool/error trajectory for viewing. */
  recordTrajectory: boolean;
}

export const DEFAULT_TOOL_RUN: ToolRunSettings = {
  maxToolCalls: 40,
  maxDurationSec: 600,
  recordTrajectory: true,
};

/** Clamp 0–500; null/empty/missing/invalid → DEFAULT_TOOL_RUN.maxToolCalls (not 0=unlimited). */
export function normalizeToolRunMaxToolCalls(raw: unknown): number {
  if (raw == null || raw === '') return DEFAULT_TOOL_RUN.maxToolCalls;
  if (typeof raw === 'string' && !raw.trim()) return DEFAULT_TOOL_RUN.maxToolCalls;
  let n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) n = DEFAULT_TOOL_RUN.maxToolCalls;
  return Math.min(500, Math.max(0, Math.floor(n)));
}

/** Clamp 0–86400; null/empty/missing/invalid → DEFAULT_TOOL_RUN.maxDurationSec (not 0=unlimited). */
export function normalizeToolRunMaxDurationSec(raw: unknown): number {
  if (raw == null || raw === '') return DEFAULT_TOOL_RUN.maxDurationSec;
  if (typeof raw === 'string' && !raw.trim()) return DEFAULT_TOOL_RUN.maxDurationSec;
  let n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) n = DEFAULT_TOOL_RUN.maxDurationSec;
  return Math.min(86400, Math.max(0, Math.floor(n)));
}

export function normalizeToolRunSettings(raw: unknown): ToolRunSettings {
  const src =
    raw && typeof raw === 'object'
      ? (raw as Partial<Record<keyof ToolRunSettings, unknown>>)
      : {};
  return {
    maxToolCalls: normalizeToolRunMaxToolCalls(src.maxToolCalls),
    maxDurationSec: normalizeToolRunMaxDurationSec(src.maxDurationSec),
    recordTrajectory: src.recordTrajectory !== false,
  };
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

export type AutoApprovalAction = 'allow' | 'ask';

/** One auto-approval rule: keywords matched against tool name + arguments. */
export interface AutoApprovalRule {
  id: string;
  /** Keywords / short phrase; matched case-insensitively against the tool call. */
  description: string;
  action: AutoApprovalAction;
  createdAt: string;
  updatedAt: string;
}

/** True for AbortSignal / fetch / SDK aborts (steer, Stop, duration breaker). */
export function isAbortLikeError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
    if (e.name === 'AbortError' || e.code === 'ABORT_ERR') return true;
    const msg = String(e.message ?? '');
    if (
      /request was aborted/i.test(msg) ||
      /this operation was aborted/i.test(msg) ||
      /the operation was aborted/i.test(msg) ||
      /aborted without reason/i.test(msg)
    ) {
      return true;
    }
    if (e.cause != null && e.cause !== err) return isAbortLikeError(e.cause);
  }
  if (typeof err === 'string') {
    return (
      /request was aborted/i.test(err) ||
      /this operation was aborted/i.test(err) ||
      /the operation was aborted/i.test(err)
    );
  }
  return false;
}

export const TOOL_IDS = ['read_file', 'read_skill', 'write_file', 'edit_file', 'run_shell', 'generate_image'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface ToolPreference {
  /** When false, the tool is omitted from the agent. */
  enabled: boolean;
  /** allow = run without HITL; ask = require approval (keyword rules may still auto-allow). */
  approval: AutoApprovalAction;
}

export type ToolPreferences = Record<ToolId, ToolPreference>;

export const DEFAULT_TOOL_PREFERENCES: ToolPreferences = {
  read_file: { enabled: true, approval: 'allow' },
  read_skill: { enabled: true, approval: 'allow' },
  write_file: { enabled: true, approval: 'allow' },
  edit_file: { enabled: true, approval: 'allow' },
  run_shell: { enabled: true, approval: 'allow' },
  generate_image: { enabled: true, approval: 'allow' },
};

export function normalizeToolPreferences(raw: unknown): ToolPreferences {
  const out: ToolPreferences = {
    run_shell: { ...DEFAULT_TOOL_PREFERENCES.run_shell },
    read_file: { ...DEFAULT_TOOL_PREFERENCES.read_file },
    read_skill: { ...DEFAULT_TOOL_PREFERENCES.read_skill },
    write_file: { ...DEFAULT_TOOL_PREFERENCES.write_file },
    edit_file: { ...DEFAULT_TOOL_PREFERENCES.edit_file },
    generate_image: { ...DEFAULT_TOOL_PREFERENCES.generate_image },
  };
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Partial<Record<ToolId, Partial<ToolPreference>>>;
  for (const id of TOOL_IDS) {
    const item = obj[id];
    if (!item || typeof item !== 'object') continue;
    out[id] = {
      enabled: item.enabled !== false,
      approval: item.approval === 'allow' ? 'allow' : 'ask',
    };
  }
  return out;
}

/** How tool input guardrails short-circuit a blocked call. */
export type SecurityBlockMode = 'reject' | 'tripwire';

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
  /** Scan run_shell commands for obvious dangerous patterns. */
  shellPatternsEnabled: boolean;
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

/** Clamp / fill security from disk or UI. Missing fields → DEFAULT_SECURITY. */
export function normalizeSecuritySettings(raw: unknown): SecuritySettings {
  const src =
    raw && typeof raw === 'object' ? (raw as Partial<Record<keyof SecuritySettings, unknown>>) : {};
  const blockMode: SecurityBlockMode = src.blockMode === 'tripwire' ? 'tripwire' : 'reject';
  return {
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
  captainMaxTurns: 20,
  memberMaxTurns: 10,
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
 * Also holds AGENTS.md / skills silent-refresh knobs (UI under 设置 → 指令).
 */
export interface InstructionsSettings {
  /** Opening role sentence for 1:1 assistants. Empty / whitespace → default. */
  assistantRoleTemplate: string;
  /** Full system prompt for refreshAgentsMd. Empty → default. */
  agentsMdRefreshSystemPrompt: string;
  /** How many recent user/assistant messages refreshAgentsMd analyzes. Default 12; clamp 1–100. */
  agentsMdRecentMessageLimit: number;
  /** The create/update decision line injected into refreshBotSkills system prompt. Empty → default. */
  skillsCreateUpdateInstruction: string;
  /** How many recent messages refreshBotSkills analyzes. Default 20; clamp 1–100. */
  skillsRecentMessageLimit: number;
}

export const DEFAULT_ASSISTANT_ROLE_TEMPLATE =
  '你是「{name}」，一个可使用本机工具的桌面个人助手。';

/**
 * Older AGENTS.md refresh system prompts (exact text). Persisted settings that still
 * store any of these exact defaults are upgraded to DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT.
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

/** Full default system prompt for silent AGENTS.md maintenance (section patches only). */
export const DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT = [
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

export const DEFAULT_AGENTS_MD_RECENT_MESSAGE_LIMIT = 12;

/** Default create/update gate line for refreshBotSkills (one system line only). */
export const DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION =
  '仅当对话中出现「固定多步流程」，或同一类事情已做/将做至少两遍时，才新增或更新 skill。技能 slug（目录名）必须以 okbot- 为前缀。';

export const DEFAULT_SKILLS_RECENT_MESSAGE_LIMIT = 20;

export const DEFAULT_INSTRUCTIONS_SETTINGS: InstructionsSettings = {
  assistantRoleTemplate: DEFAULT_ASSISTANT_ROLE_TEMPLATE,
  agentsMdRefreshSystemPrompt: DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT,
  agentsMdRecentMessageLimit: DEFAULT_AGENTS_MD_RECENT_MESSAGE_LIMIT,
  skillsCreateUpdateInstruction: DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION,
  skillsRecentMessageLimit: DEFAULT_SKILLS_RECENT_MESSAGE_LIMIT,
};

/** Clamp / fill instructions settings. Empty strings → defaults; limits → 1–100. */
export function normalizeInstructionsSettings(raw: unknown): InstructionsSettings {
  const src =
    raw && typeof raw === 'object'
      ? (raw as Partial<Record<keyof InstructionsSettings, unknown>>)
      : {};
  const template =
    typeof src.assistantRoleTemplate === 'string' ? src.assistantRoleTemplate.trim() : '';
  const agentsPromptRaw =
    typeof src.agentsMdRefreshSystemPrompt === 'string'
      ? src.agentsMdRefreshSystemPrompt.trim()
      : '';
  // Upgrade exact legacy defaults (pre-vision-guard / vision-guard+NO_CHANGE) in place.
  const agentsPrompt =
    !agentsPromptRaw ||
    agentsPromptRaw === LEGACY_DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT ||
    agentsPromptRaw === LEGACY_AGENTS_MD_REFRESH_WITH_VISION_GUARD ||
    agentsPromptRaw === LEGACY_AGENTS_MD_REFRESH_FULL_FILE
      ? ''
      : agentsPromptRaw;
  const skillsInstr =
    typeof src.skillsCreateUpdateInstruction === 'string'
      ? src.skillsCreateUpdateInstruction.trim()
      : '';
  return {
    assistantRoleTemplate: template || DEFAULT_ASSISTANT_ROLE_TEMPLATE,
    agentsMdRefreshSystemPrompt: agentsPrompt || DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT,
    agentsMdRecentMessageLimit: normalizeMaxTurns(
      src.agentsMdRecentMessageLimit,
      DEFAULT_AGENTS_MD_RECENT_MESSAGE_LIMIT,
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
}

export const DEFAULT_MEMORY_SCOPE_INSTRUCTION =
  '默认 scope=bot（本助手记忆）。仅当内容属于：用户身份/称呼、长期习惯与偏好、本机电脑环境、跨助手通用配置，或用户明确要求写入全局记忆时，才用 scope=global；其余一律 scope=bot。拿不准时选 bot。';

export const DEFAULT_MEMORY_RECENT_MESSAGE_LIMIT = 20;

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  scopeInstruction: DEFAULT_MEMORY_SCOPE_INSTRUCTION,
  recentMessageLimit: DEFAULT_MEMORY_RECENT_MESSAGE_LIMIT,
};

/** Clamp / fill memory settings. Empty scope instruction → default; limit → 1–100. */
export function normalizeMemorySettings(raw: unknown): MemorySettings {
  const src =
    raw && typeof raw === 'object'
      ? (raw as Partial<Record<keyof MemorySettings, unknown>>)
      : {};
  const scopeInstruction =
    typeof src.scopeInstruction === 'string' ? src.scopeInstruction.trim() : '';
  return {
    scopeInstruction: scopeInstruction || DEFAULT_MEMORY_SCOPE_INSTRUCTION,
    recentMessageLimit: normalizeMaxTurns(
      src.recentMessageLimit,
      DEFAULT_MEMORY_RECENT_MESSAGE_LIMIT,
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

export interface AppSettings {
  theme: ThemeMode;
  /** UI language. */
  language: LanguageCode;
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
  /**
   * Max agent turns per 1:1 chat run (`runner.run` maxTurns).
   * Separate from settings.squad captain/member maxTurns. Default 50; clamp 1–100.
   */
  maxTurns: number;
  /** 1:1 assistant instruction templates (role sentence, etc.). */
  instructions: InstructionsSettings;
  /** Memory refresh scope rule + global memory manager settings. */
  memory: MemorySettings;
  /** Built-in squad captain defaults (persona / playbook / maxTurns). */
  squad: SquadSettings;
  /** Per-run tool call / duration circuit breakers + trajectory recording. */
  toolRun: ToolRunSettings;
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
   * System notification + unread when the window is not focused and a reply
   * finishes or a tool approval waits. Default true.
   */
  notifications: boolean;
  /**
   * Shows advanced settings (security, gateway, computers, extensions, run limits,
   * compression). Default false for new users; migrated on for users who already
   * use an advanced feature.
   */
  showAdvancedSettings: boolean;
  /** Optional MCP servers ("advanced extensions"). Default off. */
  mcp: McpSettings;
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
}

export interface BotSkill {
  /** Directory name under skills/, kebab-case. */
  slug: string;
  name: string;
  /** One-line when-to-use. */
  description: string;
  /** Full markdown body (without the title line if present). */
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

/** Prompt / completion / cache token counts for one turn or aggregate. */
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

/** Lifetime + daily + per-owner aggregates (`~/.okbot/usage.json`). */
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

export type ChatRole = 'user' | 'assistant' | 'system';

/** Renderer-only lifecycle for optimistic user bubbles (not persisted). */
export type MessageSendStatus = 'pending' | 'sent' | 'failed';

/** User-message file/folder/image attachment (UI chips; paths also kept in content for the model). */
export type MessageAttachmentKind = 'image' | 'file' | 'folder';

export interface MessageAttachment {
  kind: MessageAttachmentKind;
  /** Absolute path on the local machine. */
  path: string;
  /** Display basename. */
  name: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  /** @deprecated Unused. Full context is projected live from Session; kept optional for old payloads. */
  hasPromptContext?: boolean;
  /** Squad chat: member bot id, or SQUAD_CAPTAIN_SPEAKER_ID for the virtual captain. */
  speakerBotId?: string;
  /** When set, this user message quotes another transcript message (UI strip; not `>` in content). */
  quoteMessageId?: string;
  /** Short plain snapshot of the quoted message for the quote strip / composer preview. */
  quotePreview?: string;
  /**
   * User attachments shown as chips outside the text bubble.
   * Wire `content` may still include an `[Attached]` block so tools see file/folder paths.
   * Image attachments are also injected as multimodal vision (`input_image` / data URL) for the current turn.
   */
  attachments?: MessageAttachment[];
  /** Token usage for this assistant turn (omitted for user / legacy rows). */
  usage?: TokenUsage;
  /**
   * Renderer-only: optimistic user bubble send state.
   * `pending` while chatStart awaits; `failed` shows retry; cleared/`sent` after IPC succeeds.
   */
  sendStatus?: MessageSendStatus;
}

/** One page of session messages (jsonl tail / older pages). */
export interface MessagesPage {
  messages: ChatMessage[];
  /** Pass as beforeMessageId to load the next older page. null = no older messages. */
  nextBeforeMessageId: string | null;
  hasMore: boolean;
}

export const MESSAGE_PAGE_SIZE = 50;

/** One chat-history hit from global search (assistant and squad chats). */
export interface MessageSearchHit {
  /** Chat owner id (bot or squad). */
  botId: string;
  /** Owner type; omitted means `bot`. */
  ownerKind?: 'bot' | 'squad';
  botName: string;
  botEmoji: string;
  botColor: string;
  botAvatarKind: BotAvatarKind;
  botAvatarType?: BotAvatarShape;
  message: ChatMessage;
  /** Short plain-text snippet around the match. */
  snippet: string;
  /** Squad hits: name of the member who wrote the message (assistant rows). */
  speakerName?: string;
}


/** Default system prompt file for each bot (`AGENTS.md`). Editable under bot Advanced; also auto-maintained. */
export const DEFAULT_AGENTS_MD = `# 角色与目标

你是用户的本机个人助手。根据对话持续学习用户习惯与当前任务上下文。

# 用户偏好

- （暂无）

# 项目与环境

- （暂无）

# 工作备注

- （暂无）
`;


export const DEFAULT_SETTINGS: AppSettings = {
  notifications: true,
  showAdvancedSettings: false,
  mcp: { enabled: false, servers: [] },
  theme: 'system',
  language: 'system',
  microphoneId: '',
  hardwareAcceleration: true,
  autoUpdate: true,
  sidebarDockMagnify: false,
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
  },
  security: { ...DEFAULT_SECURITY, deniedPathPrefixes: [...DEFAULT_DENIED_PATH_PREFIXES], allowedPathPrefixes: [] },
  model: {
    providers: [],
    defaultProviderId: '',
    defaultModelId: '',
  },
  contextCompression: { ...DEFAULT_CONTEXT_COMPRESSION },
  maxTurns: DEFAULT_MAX_TURNS,
  instructions: { ...DEFAULT_INSTRUCTIONS_SETTINGS },
  memory: { ...DEFAULT_MEMORY_SETTINGS },
  squad: { ...DEFAULT_SQUAD_SETTINGS },
  toolRun: { ...DEFAULT_TOOL_RUN },
  localHttpApi: { ...DEFAULT_LOCAL_HTTP_API, token: '' },
  computers: [],
  defaultComputerId: LOCAL_COMPUTER_ID,
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

export const IpcChannels = {
  getBootstrap: 'okbot:get-bootstrap',
  listBots: 'okbot:list-bots',
  createBot: 'okbot:create-bot',
  finishBotOnboarding: 'okbot:finish-bot-onboarding',
  updateBot: 'okbot:update-bot',
  deleteBot: 'okbot:delete-bot',
  listSquads: 'okbot:list-squads',
  createSquad: 'okbot:create-squad',
  updateSquad: 'okbot:update-squad',
  deleteSquad: 'okbot:delete-squad',
  getSettings: 'okbot:get-settings',
  /** Live gateway access token this process checks (or the saved one when owning the server). */
  getGatewayAccessToken: 'okbot:get-gateway-access-token',
  /** One-shot: attach preload reads the gateway token. Never put it on the command line. */
  attachGatewayToken: 'okbot:attach-gateway-token',
  saveSettings: 'okbot:save-settings',
  discoverModels: 'okbot:discover-models',
  testModelConnection: 'okbot:test-model-connection',
  probeComputer: 'okbot:probe-computer',
  getMessages: 'okbot:get-messages',
  getMessagesPage: 'okbot:get-messages-page',
  searchMessages: 'okbot:search-messages',
  getPromptContext: 'okbot:get-prompt-context',
  getLastRunTrace: 'okbot:get-last-run-trace',
  chatStart: 'okbot:chat-start',
  chatAbort: 'okbot:chat-abort',
  /** Manual Summary+Buffer pass (bypass ratio). Payload: { botId?|squadId?, mode:'compress'|'newTopic' }. */
  compressSessionNow: 'okbot:compress-session-now',
  chatEvent: 'okbot:chat-event',
  setChatUnread: 'okbot:set-chat-unread',
  toolRespond: 'okbot:tool-respond',
  copyText: 'okbot:copy-text',
  setTrafficLightPosition: 'okbot:set-traffic-light-position',
  windowMinimize: 'okbot:window-minimize',
  windowMaximizeToggle: 'okbot:window-maximize-toggle',
  windowClose: 'okbot:window-close',
  windowIsMaximized: 'okbot:window-is-maximized',
  windowMaximizedChanged: 'okbot:window-maximized-changed',
  /** Main → renderer: OS native theme flipped (esp. Windows when matchMedia is sticky). */
  nativeThemeUpdated: 'okbot:native-theme-updated',
  ensureMicrophoneAccess: 'okbot:ensure-microphone-access',
  openMicrophoneSettings: 'okbot:open-microphone-settings',
  getAppInfo: 'okbot:get-app-info',
  updaterGetStatus: 'okbot:updater-get-status',
  updaterCheck: 'okbot:updater-check',
  updaterDownload: 'okbot:updater-download',
  updaterInstall: 'okbot:updater-install',
  updaterEvent: 'okbot:updater-event',
  getUsageStats: 'okbot:get-usage-stats',
  /** Recent error-log lines from ~/.okbot/logs (redacted). */
  getRecentErrorLog: 'okbot:get-recent-error-log',
  clearModelBindingsForProvider: 'okbot:clear-model-bindings-for-provider',
  readAgentsMd: 'okbot:read-agents-md',
  writeAgentsMd: 'okbot:write-agents-md',
  listBotMemories: 'okbot:list-bot-memories',
  upsertBotMemory: 'okbot:upsert-bot-memory',
  deleteBotMemory: 'okbot:delete-bot-memory',
  listGlobalMemories: 'okbot:list-global-memories',
  upsertGlobalMemory: 'okbot:upsert-global-memory',
  deleteGlobalMemory: 'okbot:delete-global-memory',
  listBotSkills: 'okbot:list-bot-skills',
  writeBotSkill: 'okbot:write-bot-skill',
  deleteBotSkill: 'okbot:delete-bot-skill',
  listGlobalAgentsSkills: 'okbot:list-global-agents-skills',
  /** Renderer → main: native open-dialog for composer attachments. */
  pickPaths: 'okbot:pick-paths',
  /** Renderer → main: read ~/.okbot/<owner>/resources/* as a data URL for markdown images. */
  readGeneratedAssetDataUrl: 'okbot:read-generated-asset-data-url',
  /** Export assistant install package (folder or .okbot zip). */
  exportAssistantPackage: 'okbot:export-assistant-package',
  /** Import assistant install package (folder or .okbot zip). */
  importAssistantPackage: 'okbot:import-assistant-package',
  /** Built-in starter assistants (gallery). */
  listAssistantGallery: 'okbot:list-assistant-gallery',
  installGalleryAssistant: 'okbot:install-gallery-assistant',
  /** Desktop only: MCP connection status / one-off test. */
  mcpStatus: 'okbot:mcp-status',
  mcpTestServer: 'okbot:mcp-test-server',
  /** Desktop only: full data directory backup / restore. */
  backupExport: 'okbot:backup-export',
  backupRestore: 'okbot:backup-restore',
  /** Bring this window to the front (notification click). */
  windowFocus: 'okbot:window-focus',
  claimNotification: 'okbot:claim-notification',
} as const;

export type PendingToolRequest = {
  requestId: string;
  botId: string;
  messageId: string;
  toolName: string;
  arguments: unknown;
};

/**
 * Unified agent runtime event stream — one model for desktop IPC, local HTTP API /
 * Gateway SSE, and UI. Adapters must not invent divergent turn state machines.
 */
export type SessionsChangedReason = 'message' | 'created' | 'updated' | 'deleted';

export type RuntimeEvent =
  | { type: 'delta'; botId: string; messageId: string; delta: string }
  | { type: 'done'; botId: string; messageId: string; content: string; usage?: TokenUsage; aborted?: boolean }
  | { type: 'error'; botId: string; messageId: string; error: string }
  | { type: 'user_message'; botId: string; message: ChatMessage }
  | { type: 'assistant_message'; botId: string; message: ChatMessage }
  | {
      type: 'tool_request';
      botId: string;
      messageId: string;
      requestId: string;
      toolName: string;
      arguments: unknown;
    }
  | {
      type: 'tool_result';
      botId: string;
      messageId: string;
      requestId: string;
      toolName: string;
      approved: boolean;
      output?: string;
    }
  | {
      /** Skills catalog changed on disk (hot reload); UI may refresh lists. */
      type: 'skills_changed';
      botId: string;
      paths?: string[];
      at: string;
    }
  | {
      /**
       * Roster, order, or preview changed (message, create, rename, delete).
       * Clients refetch bots and squads. Not a chat-turn event.
       */
      type: 'sessions_changed';
      botId: string;
      reason: SessionsChangedReason;
    };

/** About dialog / clipboard blob. */
export interface AppInfo {
  name: string;
  version: string;
  buildDate: string;
  copyright: string;
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
  isPackaged: boolean;
}

export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdaterStatus {
  phase: UpdaterPhase;
  currentVersion: string;
  availableVersion?: string;
  progress?: number;
  error?: string;
  /**
   * The update could not start installing when the app last quit (reason code, for
   * example `no_space`, `not_writable`). Set on the next launch so the UI can tell the user.
   */
  lastInstallFailed?: string;
}

export interface BootstrapPayload {
  bots: Bot[];
  squads: Squad[];
  settings: AppSettings;
  dataDir: string;
  /** Effective HW accel for this process (set before app ready). */
  hardwareAccelerationActive: boolean;
  /** Bots with an in-flight run and/or disk-persisted HITL waiting for approval. */
  busyBotIds?: string[];
  /** Live + cold-start pending tool approval cards. */
  pendingToolRequests?: PendingToolRequest[];
  /** Corrupt settings.json detected on load (backup kept; defaults not written over it). */
  settingsLoadWarning?: string;
  /** Set once after a restore turned MCP off (the user must turn it on again). */
  restoreMcpTurnedOff?: boolean;
}



/** Build model-facing user text when a turn quotes another message (no markdown `>` lines). */
export function formatUserTextWithQuote(body: string, quotedContent: string): string {
  const q = quotedContent.replace(/\r\n/g, '\n').trim();
  const b = body.replace(/\r\n/g, '\n').trim();
  if (!q) return b;
  if (!b) return `引用：\n${q}`;
  return `引用：\n${q}\n\n${b}`;
}

/** Clamp quote preview for composer / bubble strip (plain text, ~2 lines). */
export function clipQuotePreview(raw: string, maxChars = 160): string {
  const plain = plainTextFromMarkdown(raw || '').replace(/\s+/g, ' ').trim();
  if (plain.length <= maxChars) return plain;
  return `${plain.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/** Strip common Markdown so sidebar previews stay readable as plain text. */
export function plainTextFromMarkdown(input: string): string {
  let s = input.replace(/\r\n/g, '\n');
  // Fenced code → keep a short plain hint
  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code: string) => {
    const line = String(code).trim().split('\n').find((l) => l.trim()) || '';
    return line ? line.trim() : '';
  });
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/^>\s?/gm, '');
  s = s.replace(/^\s*[-*+]\s+/gm, '');
  s = s.replace(/^\s*\d+\.\s+/gm, '');
  s = s.replace(/(\*\*|__)(\S(?:.*?\S)?)\1/g, '$2');
  s = s.replace(/(\*|_)(\S(?:.*?\S)?)\1/g, '$2');
  s = s.replace(/~~(\S(?:.*?\S)?)~~/g, '$1');
  s = s.replace(/^\|?\s*[-:| ]+\|?\s*$/gm, '');
  s = s.replace(/\|/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}


/** Build searchable text for a tool approval request. */
export function toolCallHaystack(toolName: string, toolArgs: unknown): string {
  let argsText = '';
  try {
    argsText = typeof toolArgs === 'string' ? toolArgs : JSON.stringify(toolArgs ?? {}, null, 0);
  } catch {
    argsText = String(toolArgs ?? '');
  }
  return `${toolName}\n${argsText}`.toLowerCase();
}

/**
 * Decide HITL outcome from auto-approval settings.
 * When disabled or no match → ask. If any matching rule is ask → ask (ask wins).
 * Otherwise if any matching rule is allow → allow.
 */
export function resolveAutoApproval(
  enabled: boolean,
  rules: AutoApprovalRule[] | undefined,
  toolName: string,
  toolArgs: unknown,
): AutoApprovalAction {
  if (!enabled) return 'ask';
  const list = Array.isArray(rules) ? rules : [];
  const haystack = toolCallHaystack(toolName, toolArgs);
  let matchedAsk = false;
  let matchedAllow = false;
  for (const rule of list) {
    if (!ruleMatchesKeywords(rule?.description ?? '', haystack)) continue;
    if (rule.action === 'ask') matchedAsk = true;
    else if (rule.action === 'allow') matchedAllow = true;
  }
  if (matchedAsk) return 'ask';
  if (matchedAllow) return 'allow';
  return 'ask';
}

/** Rule text that is exactly a built-in tool id matches that tool by name only. */
const BUILT_IN_TOOL_RULE_IDS: ReadonlySet<string> = new Set<string>(TOOL_IDS);

/**
 * Tool approval for one call. MCP tools (`mcp_` prefix) always ask: keyword rules
 * written for built-in tools (for example `run_shell`) must not match
 * `mcp_<server>_run_shell`, and MCP calls are never whitelisted.
 */
export function resolveToolApproval(
  settings: { autoApprovalEnabled?: boolean; autoApprovalRules?: AutoApprovalRule[] },
  toolName: string,
  toolArgs: unknown,
): AutoApprovalAction {
  if (isMcpToolName(toolName)) return 'ask';
  return resolveAutoApproval(settings.autoApprovalEnabled === true, settings.autoApprovalRules, toolName, toolArgs);
}

function ruleMatchesKeywords(description: string, haystack: string): boolean {
  const raw = description.trim().toLowerCase();
  if (!raw) return false;
  if (BUILT_IN_TOOL_RULE_IDS.has(raw)) {
    const nl = haystack.indexOf('\n');
    return (nl >= 0 ? haystack.slice(0, nl) : haystack) === raw;
  }
  if (haystack.includes(raw)) return true;
  const parts = raw
    .split(/[,，、;；\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length <= 1) return haystack.includes(raw);
  // Comma-separated keywords: any phrase matches (OR).
  return parts.some((p) => haystack.includes(p));
}

export function createId(prefix: string): string {
  const id =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  return `${prefix}_${id}`;
}
