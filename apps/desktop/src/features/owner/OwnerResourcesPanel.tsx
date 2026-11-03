import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OwnerResourceInfo } from '@okbot/shared';
import { isImageResourceType } from '@okbot/shared';
import { FileAttachIcon, TrashIcon } from '../../components/ui/icons';
import { requestConfirm } from '../../components/ui';
import { ImageLightbox, type ImageLightboxTarget } from '../chat/ImageLightbox';
import { t, type UiLang } from '../../i18n';
import { resolveMediaAssetUrl } from '../../utils/mediaAsset';
import { OWNER_LIST_PAGE_SIZE } from './ownerListPage';
import { ResourceFullscreenPreview } from './ResourceFullscreenPreview';
import { isOwnerResourceEmbedPreviewable } from './ResourcePreview';

function shortTime(iso: string | undefined): string {
  if (!iso) return '—';
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return iso;
  try {
    return new Date(d).toLocaleString();
  } catch {
    return iso;
  }
}

function typeLabel(_lang: UiLang, type: string): string {
  return type;
}

function ResourceThumb({
  item,
  src,
}: {
  item: OwnerResourceInfo;
  src: string | undefined;
}) {
  if (isImageResourceType(item.type) && src) {
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
  /** Non-image embed preview opened fullscreen (md / note / code-text). */
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [imageLightbox, setImageLightbox] = useState<ImageLightboxTarget | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
    setPreviewId(null);
    setImageLightbox(null);
  }, [id]);

  const visible = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const hasMore = items.length > visibleCount;
  const previewItem = useMemo(
    () => (previewId ? items.find((x) => x.id === previewId) || null : null),
    [items, previewId],
  );

  useEffect(() => {
    if (!active || visible.length === 0) return;
    let cancelled = false;
    const images = visible.filter((item) => isImageResourceType(item.type) && item.assetRel);
    if (images.length === 0) return;

    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        images.map(async (item) => {
          const rel = item.assetRel!;
          try {
            const mediaUrl = await resolveMediaAssetUrl(rel);
            if (mediaUrl) {
              next[rel] = mediaUrl;
              return;
            }
            if (typeof window.okbot.readGeneratedAssetDataUrl === 'function') {
              const res = await window.okbot.readGeneratedAssetDataUrl(rel);
              if (res && 'ok' in res && res.ok && res.dataUrl) {
                next[rel] = res.dataUrl;
              }
            }
          } catch {
            /* keep file icon */
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

  const onDelete = useCallback(
    async (item: OwnerResourceInfo) => {
      if (!id || typeof window.okbot.deleteOwnerResource !== 'function') return;
      const ok = await requestConfirm({
        message: t(lang, 'ownerFormResourcesDeleteConfirm'),
        confirmLabel: t(lang, 'ownerFormResourcesDelete'),
      });
      if (!ok) return;
      setDeletingId(item.id);
      try {
        const res = await window.okbot.deleteOwnerResource(id, item.id);
        if (!res?.ok) {
          setError(res?.error || t(lang, 'ownerFormResourcesDeleteFailed'));
          return;
        }
        if (previewId === item.id) setPreviewId(null);
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : t(lang, 'ownerFormResourcesDeleteFailed'));
      } finally {
        setDeletingId(null);
      }
    },
    [id, lang, reload, previewId],
  );

  const resolveImageSrc = useCallback(async (item: OwnerResourceInfo): Promise<string | null> => {
    if (!isImageResourceType(item.type)) return null;
    if (item.assetRel) {
      try {
        const mediaUrl = await resolveMediaAssetUrl(item.assetRel);
        if (mediaUrl) return mediaUrl;
        if (typeof window.okbot.readGeneratedAssetDataUrl === 'function') {
          const res = await window.okbot.readGeneratedAssetDataUrl(item.assetRel);
          if (res && 'ok' in res && res.ok && res.dataUrl) return res.dataUrl;
        }
      } catch {
        /* fall through */
      }
    }
    return null;
  }, []);

  const openOrPreview = useCallback(
    async (item: OwnerResourceInfo) => {
      // System-open only: url / folder / pdf / av / office / archives / non-note html.
      if (!isOwnerResourceEmbedPreviewable(item.type)) {
        if (typeof window.okbot.openOwnerResource === 'function') {
          const res = await window.okbot.openOwnerResource(id, item.id);
          if (!res?.ok) setError(res?.error || t(lang, 'ownerFormResourcesOpenFailed'));
        }
        return;
      }
      if (isImageResourceType(item.type)) {
        setPreviewId(null);
        const src = await resolveImageSrc(item);
        if (!src) {
          setError(t(lang, 'ownerFormResourcesPreviewUnavailable'));
          return;
        }
        setImageLightbox({ src, alt: item.name, fileName: item.name });
        return;
      }
      setImageLightbox(null);
      setPreviewId((prev) => (prev === item.id ? null : item.id));
    },
    [id, lang, resolveImageSrc],
  );

  return (
    <div className="settings-aar-inline list-card owner-resources-panel">
      {!id ? (
        <div className="settings-hint">{t(lang, 'ownerFormNeedSave')}</div>
      ) : (
        <>
          {error ? (
            <div className="settings-hint" style={{ color: 'var(--danger, #c44)' }}>
              {error}
            </div>
          ) : null}
          {loading && items.length === 0 ? (
            <div className="settings-hint">{t(lang, 'ownerFormResourcesLoading')}</div>
          ) : items.length === 0 ? (
            <div className="settings-hint">{t(lang, 'ownerFormResourcesEmpty')}</div>
          ) : (
            <>
              <ul className="owner-resources-list">
                {visible.map((item) => {
                  const src = item.assetRel ? thumbs[item.assetRel] : undefined;
                  const open = previewId === item.id;
                  return (
                    <li key={item.id} className={`owner-resource-row${open ? ' selected' : ''}`}>
                      <button
                        type="button"
                        className="owner-resource-row-btn"
                        onClick={() => void openOrPreview(item)}
                        title={item.name}
                        aria-label={item.name}
                      >
                        <ResourceThumb item={item} src={src} />
                        <span className="owner-resource-meta">
                          <span className="owner-resource-name" title={item.name}>
                            {item.name}
                          </span>
                          <span className="owner-resource-sub">
                            <span className="owner-resource-type">{typeLabel(lang, item.type)}</span>
                            <span className="owner-resource-time">
                              {shortTime(item.updatedAt || item.createdAt)}
                            </span>
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="owner-resource-delete"
                        title={t(lang, 'ownerFormResourcesDelete')}
                        aria-label={t(lang, 'ownerFormResourcesDelete')}
                        disabled={deletingId === item.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDelete(item);
                        }}
                      >
                        <TrashIcon />
                      </button>
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
          {previewItem && !isImageResourceType(previewItem.type) ? (
            <ResourceFullscreenPreview
              lang={lang}
              ownerId={id}
              item={previewItem}
              onClose={() => setPreviewId(null)}
            />
          ) : null}
          {imageLightbox ? (
            <ImageLightbox
              lang={lang}
              target={imageLightbox}
              onClose={() => setImageLightbox(null)}
              variant="cover"
            />
          ) : null}
        </>
      )}
    </div>
  );
}
