/**
 * Built-in web tools settings (`settings.web`).
 * Search needs a user-configured third-party provider + API key.
 * Fetch needs no key; SSRF defaults block localhost / private nets.
 */

/** Built-in search APIs (official endpoints only; no base URL override). */
export const WEB_SEARCH_COMPAT_IDS = ['tavily', 'brave', 'serper'] as const;
export type WebSearchCompatId = (typeof WEB_SEARCH_COMPAT_IDS)[number];

export const WEB_SEARCH_PROVIDER_IDS = [...WEB_SEARCH_COMPAT_IDS, 'custom'] as const;
export type WebSearchProviderId = (typeof WEB_SEARCH_PROVIDER_IDS)[number];

export interface WebSearchSettings {
  /** Search API provider. Default tavily. */
  provider: WebSearchProviderId;
  /** Provider API key (stored in settings.json like model keys). */
  apiKey: string;
  /**
   * Custom API base URL. Used only when `provider` is `custom`.
   * Empty = not configured for custom. Built-in providers ignore this field.
   */
  baseURL: string;
  /**
   * Wire format when `provider` is `custom` (which official API the endpoint speaks).
   * Ignored for built-in providers.
   */
  compat: WebSearchCompatId;
}

export interface WebFetchSettings {
  /**
   * When true, web_fetch may target localhost / private / link-local hosts.
   * Default false (SSRF-safe).
   */
  allowPrivateNetwork: boolean;
}

export interface WebSettings {
  search: WebSearchSettings;
  fetch: WebFetchSettings;
}

export const DEFAULT_WEB_SEARCH: WebSearchSettings = {
  provider: 'tavily',
  apiKey: '',
  baseURL: '',
  compat: 'tavily',
};

export const DEFAULT_WEB_FETCH: WebFetchSettings = {
  allowPrivateNetwork: false,
};

export const DEFAULT_WEB_SETTINGS: WebSettings = {
  search: { ...DEFAULT_WEB_SEARCH },
  fetch: { ...DEFAULT_WEB_FETCH },
};

export function normalizeWebSearchCompat(raw: unknown): WebSearchCompatId {
  if (typeof raw === 'string' && (WEB_SEARCH_COMPAT_IDS as readonly string[]).includes(raw)) {
    return raw as WebSearchCompatId;
  }
  return 'tavily';
}

export function normalizeWebSearchProvider(raw: unknown): WebSearchProviderId {
  if (typeof raw === 'string' && (WEB_SEARCH_PROVIDER_IDS as readonly string[]).includes(raw)) {
    return raw as WebSearchProviderId;
  }
  return 'tavily';
}

export function normalizeWebSearchSettings(raw: unknown): WebSearchSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WEB_SEARCH };
  const o = raw as Partial<WebSearchSettings>;
  return {
    provider: normalizeWebSearchProvider(o.provider),
    apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
    baseURL: typeof o.baseURL === 'string' ? o.baseURL.trim() : '',
    compat: normalizeWebSearchCompat(o.compat),
  };
}

export function normalizeWebFetchSettings(raw: unknown): WebFetchSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WEB_FETCH };
  const o = raw as Partial<WebFetchSettings>;
  return {
    allowPrivateNetwork: o.allowPrivateNetwork === true,
  };
}

export function normalizeWebSettings(raw: unknown): WebSettings {
  if (!raw || typeof raw !== 'object') {
    return {
      search: { ...DEFAULT_WEB_SEARCH },
      fetch: { ...DEFAULT_WEB_FETCH },
    };
  }
  const o = raw as { search?: unknown; fetch?: unknown };
  return {
    search: normalizeWebSearchSettings(o.search),
    fetch: normalizeWebFetchSettings(o.fetch),
  };
}

/**
 * True when search can call a provider:
 * - built-in: non-empty API key
 * - custom: non-empty API key and base URL
 */
export function isWebSearchConfigured(search: WebSearchSettings | undefined | null): boolean {
  if (!search?.apiKey?.trim()) return false;
  if (search.provider === 'custom') return Boolean(search.baseURL?.trim());
  return true;
}
