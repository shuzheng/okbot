import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { WebsiteIcon } from '../../components/ui/icons';
import {
  getCachedFavicon,
  probeSiteFavicon,
  rememberFaviconFailure,
  siteOriginKey,
  type FaviconCacheEntry,
} from '../../utils/siteFavicon';

function initialFaviconState(href: string): FaviconCacheEntry | 'pending' {
  const origin = siteOriginKey(href);
  if (!origin) return { status: 'fail' };
  return getCachedFavicon(origin) ?? 'pending';
}

/**
 * Chat hyperlink with site favicon prefix (WebsiteIcon fallback).
 * Underline applies to the label only — the icon stays undecorated.
 */
export const ChatExternalLink = memo(function ChatExternalLink({
  href,
  children,
}: {
  href: string;
  children?: ReactNode;
}) {
  const [favicon, setFavicon] = useState<FaviconCacheEntry | 'pending'>(() =>
    initialFaviconState(href),
  );

  // Re-sync when href changes (rare) or cache was filled by a sibling link.
  const cacheKey = useMemo(() => siteOriginKey(href), [href]);

  useEffect(() => {
    const origin = siteOriginKey(href);
    if (!origin) {
      setFavicon({ status: 'fail' });
      return;
    }
    const cached = getCachedFavicon(origin);
    if (cached) {
      setFavicon(cached);
      return;
    }
    setFavicon('pending');
    let cancelled = false;
    void probeSiteFavicon(href).then((entry) => {
      if (!cancelled) setFavicon(entry);
    });
    return () => {
      cancelled = true;
    };
  }, [href, cacheKey]);

  return (
    <a
      className="chat-ext-link"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      <span className="chat-ext-link-ico" aria-hidden>
        {favicon !== 'pending' && favicon.status === 'ok' ? (
          <img
            className="chat-ext-link-favicon"
            src={favicon.url}
            alt=""
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => {
              // Rare: cached URL later 404s — drop back to the globe.
              const origin = siteOriginKey(href);
              if (origin) rememberFaviconFailure(origin);
              setFavicon({ status: 'fail' });
            }}
          />
        ) : (
          <WebsiteIcon />
        )}
      </span>
      <span className="chat-ext-link-label">{children}</span>
    </a>
  );
});
