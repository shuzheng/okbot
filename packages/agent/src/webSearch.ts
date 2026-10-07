/**
 * Built-in `web_search`: user-configured third-party search (Tavily / Brave / Serper).
 * No key → clear Chinese error pointing at Settings → Tools → Web.
 */
import {
  isWebSearchConfigured,
  type WebSearchProviderId,
  type WebSearchSettings,
} from '@okbot/shared';

export const WEB_SEARCH_TIMEOUT_MS = 20_000;
export const WEB_SEARCH_DEFAULT_LIMIT = 5;
export const WEB_SEARCH_MAX_LIMIT = 10;

export const WEB_SEARCH_PROVIDER_DEFAULTS: Record<
  WebSearchProviderId,
  { label: string; defaultBaseURL: string }
> = {
  tavily: { label: 'Tavily', defaultBaseURL: 'https://api.tavily.com' },
  brave: { label: 'Brave Search', defaultBaseURL: 'https://api.search.brave.com' },
  serper: { label: 'Serper', defaultBaseURL: 'https://google.serper.dev' },
};

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchResult = {
  provider: WebSearchProviderId;
  query: string;
  hits: WebSearchHit[];
};

export type WebSearchOptions = {
  limit?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export function webSearchNotConfiguredMessage(): string {
  return (
    '错误：尚未配置网页搜索。请打开设置 → 工具 → 网页，选择搜索服务商（Tavily / Brave / Serper）并填写 API Key 后再试。'
  );
}

function resolveBaseURL(settings: WebSearchSettings): string {
  const override = (settings.baseURL || '').trim().replace(/\/$/, '');
  if (override) return override;
  return WEB_SEARCH_PROVIDER_DEFAULTS[settings.provider].defaultBaseURL.replace(/\/$/, '');
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

async function searchTavily(
  settings: WebSearchSettings,
  query: string,
  limit: number,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<WebSearchHit[]> {
  const base = resolveBaseURL(settings);
  const res = await fetchImpl(`${base}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      api_key: settings.apiKey.trim(),
      query,
      max_results: limit,
      include_answer: false,
      search_depth: 'basic',
    }),
    signal,
  });
  const raw = await res.text();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Tavily 返回非 JSON（HTTP ${res.status}）：${raw.slice(0, 300)}`);
  }
  if (!res.ok) {
    const err = asRecord(json)?.error ?? asRecord(json)?.detail ?? raw.slice(0, 300);
    throw new Error(`Tavily 搜索失败（HTTP ${res.status}）：${String(err)}`);
  }
  const results = asRecord(json)?.results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, limit).map((item) => {
    const o = asRecord(item) ?? {};
    return {
      title: str(o.title) || '(untitled)',
      url: str(o.url),
      snippet: str(o.content) || str(o.snippet),
    };
  });
}

async function searchBrave(
  settings: WebSearchSettings,
  query: string,
  limit: number,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<WebSearchHit[]> {
  const base = resolveBaseURL(settings);
  const u = new URL(`${base}/res/v1/web/search`);
  u.searchParams.set('q', query);
  u.searchParams.set('count', String(limit));
  const res = await fetchImpl(u.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': settings.apiKey.trim(),
    },
    signal,
  });
  const raw = await res.text();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Brave 返回非 JSON（HTTP ${res.status}）：${raw.slice(0, 300)}`);
  }
  if (!res.ok) {
    const err = asRecord(json)?.message ?? asRecord(json)?.error ?? raw.slice(0, 300);
    throw new Error(`Brave 搜索失败（HTTP ${res.status}）：${String(err)}`);
  }
  const web = asRecord(asRecord(json)?.web);
  const results = web?.results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, limit).map((item) => {
    const o = asRecord(item) ?? {};
    return {
      title: str(o.title) || '(untitled)',
      url: str(o.url),
      snippet: str(o.description) || str(o.snippet),
    };
  });
}

async function searchSerper(
  settings: WebSearchSettings,
  query: string,
  limit: number,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<WebSearchHit[]> {
  const base = resolveBaseURL(settings);
  const res = await fetchImpl(`${base}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': settings.apiKey.trim(),
    },
    body: JSON.stringify({ q: query, num: limit }),
    signal,
  });
  const raw = await res.text();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Serper 返回非 JSON（HTTP ${res.status}）：${raw.slice(0, 300)}`);
  }
  if (!res.ok) {
    const err = asRecord(json)?.message ?? asRecord(json)?.error ?? raw.slice(0, 300);
    throw new Error(`Serper 搜索失败（HTTP ${res.status}）：${String(err)}`);
  }
  const organic = asRecord(json)?.organic;
  if (!Array.isArray(organic)) return [];
  return organic.slice(0, limit).map((item) => {
    const o = asRecord(item) ?? {};
    return {
      title: str(o.title) || '(untitled)',
      url: str(o.link) || str(o.url),
      snippet: str(o.snippet),
    };
  });
}

export async function webSearch(
  settings: WebSearchSettings | null | undefined,
  query: string,
  opts?: WebSearchOptions,
): Promise<WebSearchResult> {
  const q = (query || '').trim();
  if (!q) throw new Error('query 不能为空');
  if (!isWebSearchConfigured(settings ?? null)) {
    throw new Error(webSearchNotConfiguredMessage().replace(/^错误：/, ''));
  }
  const cfg = settings!;
  const limit = Math.min(
    WEB_SEARCH_MAX_LIMIT,
    Math.max(1, Math.floor(opts?.limit ?? WEB_SEARCH_DEFAULT_LIMIT)),
  );
  const timeoutMs = opts?.timeoutMs ?? WEB_SEARCH_TIMEOUT_MS;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = opts?.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let hits: WebSearchHit[];
  switch (cfg.provider) {
    case 'brave':
      hits = await searchBrave(cfg, q, limit, fetchImpl, signal);
      break;
    case 'serper':
      hits = await searchSerper(cfg, q, limit, fetchImpl, signal);
      break;
    case 'tavily':
    default:
      hits = await searchTavily(cfg, q, limit, fetchImpl, signal);
      break;
  }
  return { provider: cfg.provider, query: q, hits };
}

export function formatWebSearchToolOutput(result: WebSearchResult): string {
  const label = WEB_SEARCH_PROVIDER_DEFAULTS[result.provider].label;
  if (!result.hits.length) {
    return `网页搜索（${label}）「${result.query}」无结果。`;
  }
  const blocks = result.hits.map((h, i) => {
    const parts = [`${i + 1}. ${h.title || '(untitled)'}`];
    if (h.url) parts.push(`   ${h.url}`);
    if (h.snippet) parts.push(`   ${h.snippet}`);
    return parts.join('\n');
  });
  return [`网页搜索（${label}）「${result.query}」共 ${result.hits.length} 条：`, '', ...blocks].join(
    '\n',
  );
}
