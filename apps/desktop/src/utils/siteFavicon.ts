/**
 * Resolve and probe a chat-link site favicon (same-origin candidates only).
 * Prefer the site's own icon; callers fall back to WebsiteIcon on failure.
 * No third-party favicon CDN — avoids leaking every linked host to a tracker,
 * and those CDNs often always return a placeholder (breaking real fallback).
 */

export type FaviconCacheEntry =
  | { status: 'ok'; url: string }
  | { status: 'fail' };

/** Module cache: one outcome per origin for the lifetime of the renderer. */
const cache = new Map<string, FaviconCacheEntry>();
const inflight = new Map<string, Promise<FaviconCacheEntry>>();

/** Origin key for caching (`https://example.com`), or null if not http(s). */
export function siteOriginKey(href: string): string | null {
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Same-origin favicon candidates, most common first.
 * Keep the list short — each miss waits on a network round-trip.
 */
export function siteFaviconCandidates(href: string): string[] {
  const origin = siteOriginKey(href);
  if (!origin) return [];
  return [
    `${origin}/favicon.ico`,
    `${origin}/favicon.svg`,
    `${origin}/apple-touch-icon.png`,
  ];
}

export function getCachedFavicon(origin: string): FaviconCacheEntry | undefined {
  return cache.get(origin);
}

/** Mark an origin as failed (e.g. cached URL later 404s in <img>). */
export function rememberFaviconFailure(origin: string): void {
  cache.set(origin, { status: 'fail' });
}

/** Test helper — clears probe cache between cases. */
export function clearFaviconCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

function loadImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      // Node unit tests: skip network; treat as miss so callers stay sync-safe.
      resolve(false);
      return;
    }
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/**
 * Probe candidates until one loads. Caches ok/fail per origin.
 * Concurrent callers for the same origin share one in-flight probe.
 */
export function probeSiteFavicon(href: string): Promise<FaviconCacheEntry> {
  const origin = siteOriginKey(href);
  if (!origin) return Promise.resolve({ status: 'fail' });

  const hit = cache.get(origin);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(origin);
  if (pending) return pending;

  const candidates = siteFaviconCandidates(href);
  const work = (async (): Promise<FaviconCacheEntry> => {
    for (const url of candidates) {
      const ok = await loadImage(url);
      if (ok) {
        const entry: FaviconCacheEntry = { status: 'ok', url };
        cache.set(origin, entry);
        return entry;
      }
    }
    const fail: FaviconCacheEntry = { status: 'fail' };
    cache.set(origin, fail);
    return fail;
  })().finally(() => {
    inflight.delete(origin);
  });

  inflight.set(origin, work);
  return work;
}
