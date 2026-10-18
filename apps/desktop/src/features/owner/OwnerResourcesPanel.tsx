import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OwnerResourceInfo } from '@okbot/shared';
import { FileAttachIcon } from '../../components/ui/icons';
import { t, type UiLang } from '../../i18n';
import { OWNER_LIST_PAGE_SIZE } from './ownerListPage';

function ResourceThumb({
  item,
  dataUrl,
}: {
  item: OwnerResourceInfo;
  dataUrl: string | undefined;
}) {
  const isImage = item.mime.startsWith('image/');
  if (isImage && dataUrl) {
    return (
      <span className="owner-resource-thumb">
        <img src={dataUrl} alt="" />
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
  }, [id]);

  const visible = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const hasMore = items.length > visibleCount;

  // Load square image thumbnails for visible image resources (edit 资源 tab).
  useEffect(() => {
    if (!active || visible.length === 0) return;
    let cancelled = false;
    const images = visible.filter((item) => item.mime.startsWith('image/'));
    if (images.length === 0) return;

    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        images.map(async (item) => {
          try {
            const res = await window.okbot.readGeneratedAssetDataUrl(item.assetRel);
            if (res && 'ok' in res && res.ok && res.dataUrl) {
              next[item.assetRel] = res.dataUrl;
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

  return (
    <div className="settings-aar-inline list-card">
    {!id ? (
      <div className="settings-hint">{t(lang, 'ownerFormNeedSave')}</div>
    ) : error ? (
      <div className="settings-hint" style={{ color: 'var(--danger, #c44)' }}>{error}</div>
    ) : loading && items.length === 0 ? (
      <div className="settings-hint">{t(lang, 'ownerFormResourcesLoading')}</div>
    ) : items.length === 0 ? (
      <div className="settings-hint">{t(lang, 'ownerFormResourcesEmpty')}</div>
    ) : (
    <>
    <ul className="owner-resources-list">
      {visible.map((item) => (
        <li key={item.assetRel} className="owner-resource-row">
          <ResourceThumb item={item} dataUrl={thumbs[item.assetRel]} />
          <span className="owner-resource-name" title={item.name}>
            {item.name}
          </span>
        </li>
      ))}
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
    </div>
  );
}
