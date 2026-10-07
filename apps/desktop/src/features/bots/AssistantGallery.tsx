import { useEffect, useState } from 'react';
import type { Bot } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { CloseIcon } from '../../components/ui/icons';
import { FlatAvatar, toast } from '../../components/ui';
import { formatSystemError } from '../../utils/formatSystemError';

type GalleryItem = Awaited<ReturnType<typeof window.okbot.listAssistantGallery>>[number];

/** Starter assistant cards. One tap installs a ready-to-chat assistant. */
export function AssistantGalleryList({
  lang,
  disabled = false,
  existingNames = [],
  onInstalled,
}: {
  lang: UiLang;
  /** Looks and acts read-only (e.g. no model yet). */
  disabled?: boolean;
  /** Names of current assistants. A card whose name is here shows 「已添加」. */
  existingNames?: readonly string[];
  onInstalled: (bot: Bot) => void;
}) {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    let cancelled = false;
    void window.okbot
      .listAssistantGallery(lang)
      .then((list) => {
        if (!cancelled) setItems(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const existing = new Set(existingNames.map((n) => n.trim()));

  async function install(id: string) {
    if (disabled || busyId) return;
    setBusyId(id);
    try {
      const bot = await window.okbot.installGalleryAssistant(id, lang);
      onInstalled(bot);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      toast.error(raw.includes('gallery_not_found') ? t(lang, 'galleryNotFound') : formatSystemError(err));
    } finally {
      setBusyId('');
    }
  }

  if (items == null) return <div className="assistant-gallery-empty">…</div>;
  if (items.length === 0) return <div className="assistant-gallery-empty">{t(lang, 'galleryEmpty')}</div>;

  return (
    <div className="assistant-gallery-grid" aria-disabled={disabled ? 'true' : undefined}>
      {items.map((item) => {
        const added = existing.has(item.name.trim());
        return (
        <button
          key={item.id}
          type="button"
          className="assistant-gallery-card"
          disabled={disabled || added || Boolean(busyId)}
          onClick={() => void install(item.id)}
        >
          <FlatAvatar emoji={item.emoji} color={item.color} className="assistant-gallery-avatar" />
          <span className="assistant-gallery-text">
            <span className="assistant-gallery-name">{item.name}</span>
            <span className="assistant-gallery-desc">{item.description}</span>
          </span>
          <span className="assistant-gallery-add">
            {busyId === item.id
              ? t(lang, 'galleryAdding')
              : added
                ? t(lang, 'galleryAlreadyAdded')
                : t(lang, 'galleryAdd')}
          </span>
        </button>
        );
      })}
    </div>
  );
}

/** 「市场」 modal opened from the create menu. */
export function AssistantGalleryModal({
  lang,
  modelReady,
  existingNames,
  onClose,
  onInstalled,
}: {
  lang: UiLang;
  /** False when no provider has a model. Cards are read-only until one is set. */
  modelReady: boolean;
  existingNames: readonly string[];
  onClose: () => void;
  onInstalled: (bot: Bot) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal assistant-gallery-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, 'galleryTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{t(lang, 'galleryTitle')}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t(lang, 'close')}>
            <CloseIcon />
          </button>
        </div>
        <p className="assistant-gallery-hint">
          {modelReady ? t(lang, 'galleryHint') : t(lang, 'galleryNeedsModel')}
        </p>
        <AssistantGalleryList
          lang={lang}
          disabled={!modelReady}
          existingNames={existingNames}
          onInstalled={onInstalled}
        />
      </div>
    </div>
  );
}
