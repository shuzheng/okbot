import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OwnerResourceInfo } from '@okbot/shared';
import { FileAttachIcon } from '../../components/ui/icons';
import { t, type UiLang } from '../../i18n';
import { resolveMediaAssetUrl } from '../../utils/mediaAsset';
import { ImageLightbox, type ImageLightboxTarget } from '../chat/ImageLightbox';
import { OWNER_LIST_PAGE_SIZE } from './ownerListPage';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i;

function isImageResource(item: OwnerResourceInfo): boolean {
  if ((item.mime || '').startsWith('image/')) return true;
  return IMAGE_EXT.test(item.name || '') || IMAGE_EXT.test(item.assetRel || '');
}

function ResourceThumb({
  item,
  src,
}: {
  item: OwnerResourceInfo;
  src: string | undefined;
}) {
  const isImage = isImageResource(item);
  if (isImage && src) {
    return (
      <span className="owner-resource-thumb">
        <img src={src} alt="" />
      </span>
    );
  }
  return (
    <span className="owner-resource-thumb owner-resource-thumb-file" aria-hidden>
      <FileAttachIcon />
    </span>
  );
}

export function OwnerResourcesPanel({
  lang,
  ownerId,
  active,
}: {
  lang: UiLang;
  ownerId: string | null | undefined;
  active: boolean;
}) {
  const [items, setItems] = useState<OwnerResourceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [visibleCount, setVisibleCount] = useState(OWNER_LIST_PAGE_SIZE);
  const [preview, setPreview] = useState<ImageLightboxTarget | null>(null);
  const id = (ownerId || '').trim();

  const reload = useCallback(async () => {
    if (!id || typeof window.okbot.listOwnerResources !== 'function') {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await window.okbot.listOwnerResources(id);
      setItems(Array.isArray(list) ? list : []);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!active) return;
    void reload();
  }, [active, reload]);

  useEffect(() => {
    setThumbs({});
    setVisibleCount(OWNER_LIST_PAGE_SIZE);
    setPreview(null);
  }, [id]);

  useEffect(() => {
    if (!active) setPreview(null);
  }, [active]);

  const visible = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const hasMore = items.length > visibleCount;

  // Prefer gateway /v1/media URL; fall back to IPC/data URL so thumbs work offline.
  useEffect(() => {
    if (!active || visible.length === 0) return;
    let cancelled = false;
    const images = visible.filter(isImageResource);
    if (images.length === 0) return;

    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        images.map(async (item) => {
          try {
            const mediaUrl = await resolveMediaAssetUrl(item.assetRel);
            if (mediaUrl) {
              next[item.assetRel] = mediaUrl;
              return;
            }
            if (typeof window.okbot.readGeneratedAssetDataUrl === 'function') {
              const res = await window.okbot.readGeneratedAssetDataUrl(item.assetRel);
              if (res && 'ok' in res && res.ok && res.dataUrl) {
                next[item.assetRel] = res.dataUrl;
              }
            }
          } catch {
            // keep file icon fallback
          }
        }),
      );
      if (!cancelled && Object.keys(next).length > 0) {
        setThumbs((prev) => ({ ...prev, ...next }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, visible]);

  const openImage = (item: OwnerResourceInfo) => {
    if (!isImageResource(item)) return;
    const src = thumbs[item.assetRel];
    if (!src) return;
    setPreview({
      src,
      alt: item.name,
      fileName: item.name,
    });
  };

  return (
    <div className="settings-aar-inline list-card owner-resources-panel">
      {!id ? (
        <div className="settings-hint">{t(lang, 'ownerFormNeedSave')}</div>
      ) : error ? (
        <div className="settings-hint" style={{ color: 'var(--danger, #c44)' }}>
          {error}
        </div>
      ) : loading && items.length === 0 ? (
        <div className="settings-hint">{t(lang, 'ownerFormResourcesLoading')}</div>
      ) : items.length === 0 ? (
        <div className="settings-hint">{t(lang, 'ownerFormResourcesEmpty')}</div>
      ) : (
        <>
          <ul className="owner-resources-list">
            {visible.map((item) => {
              const image = isImageResource(item);
              const src = thumbs[item.assetRel];
              const clickable = image && !!src;
              return (
                <li key={item.assetRel} className="owner-resource-row">
                  {clickable ? (
                    <button
                      type="button"
                      className="owner-resource-row-btn"
                      onClick={() => openImage(item)}
                      title={item.name}
                      aria-label={item.name}
                    >
                      <ResourceThumb item={item} src={src} />
                      <span className="owner-resource-name" title={item.name}>
                        {item.name}
                      </span>
                    </button>
                  ) : (
                    <>
                      <ResourceThumb item={item} src={src} />
                      <span className="owner-resource-name" title={item.name}>
                        {item.name}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {hasMore ? (
            <button
              type="button"
              className="owner-list-load-more"
              onClick={() => setVisibleCount((n) => n + OWNER_LIST_PAGE_SIZE)}
            >
              {t(lang, 'ownerFormLoadMore')}
            </button>
          ) : null}
        </>
      )}
      {preview ? (
        <ImageLightbox lang={lang} target={preview} onClose={() => setPreview(null)} variant="cover" />
      ) : null}
    </div>
  );
}
