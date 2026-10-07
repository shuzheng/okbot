/**
 * Built-in web tools settings (`settings.web`).
 * Search needs a user-configured third-party provider + API key.
 * Fetch needs no key; SSRF defaults block localhost / private nets.
 */

export const WEB_SEARCH_PROVIDER_IDS = ['tavily', 'brave', 'serper'] as const;
export type WebSearchProviderId = (typeof WEB_SEARCH_PROVIDER_IDS)[number];

export interface WebSearchSettings {
  /** Search API provider. Default tavily. */
  provider: WebSearchProviderId;
  /** Provider API key (stored in settings.json like model keys). */
  apiKey: string;
  /**
   * Optional base URL override (proxy / self-host).
   * Empty = provider default endpoint.
   */
  baseURL: string;
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
};

export const DEFAULT_WEB_FETCH: WebFetchSettings = {
  allowPrivateNetwork: false,
};

export const DEFAULT_WEB_SETTINGS: WebSettings = {
  search: { ...DEFAULT_WEB_SEARCH },
  fetch: { ...DEFAULT_WEB_FETCH },
};

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

/** True when search has a non-empty API key (tool can call the provider). */
export function isWebSearchConfigured(search: WebSearchSettings | undefined | null): boolean {
  return Boolean(search?.apiKey?.trim());
}
