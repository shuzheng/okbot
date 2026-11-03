import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  isCodeOrTextResourceType,
  isMarkdownResourceType,
  isNoteResourceType,
  type OwnerResourceInfo,
} from '@okbot/shared';
import { CloseIcon, DownloadUpdateIcon } from '../../components/ui/icons';
import { downloadTextBlob } from '../chat/ImageLightbox';
import { t, type UiLang } from '../../i18n';
import { ResourcePreviewBody } from './ResourcePreview';

function downloadFileName(item: OwnerResourceInfo): string {
  const raw = (item.name || 'download').replace(/[\\/]/g, '_').trim() || 'download';
  if (isNoteResourceType(item.type) && !/\.html?$/i.test(raw)) {
    return `${raw}.html`;
  }
  if (isMarkdownResourceType(item.type) && !/\.md$/i.test(raw)) {
    return `${raw}.md`;
  }
  return raw;
}

function downloadMime(item: OwnerResourceInfo): string {
  if (isNoteResourceType(item.type)) return 'text/html;charset=utf-8';
  if (isMarkdownResourceType(item.type)) return 'text/markdown;charset=utf-8';
  if (isCodeOrTextResourceType(item.type)) return 'text/plain;charset=utf-8';
  return 'text/plain;charset=utf-8';
}

/**
 * Fullscreen resource preview: same chrome as ImageLightbox (cover portal),
 * download + close only (no zoom). For md / note / code-text embeddables.
 */
export function ResourceFullscreenPreview(props: {
  lang: UiLang;
  ownerId: string;
  item: OwnerResourceInfo;
  onClose: () => void;
}) {
  const { lang, ownerId, item, onClose } = props;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const requestClose = useCallback(() => {
    onCloseRef.current();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [requestClose]);

  const onDownload = useCallback(() => {
    void (async () => {
      try {
        if (typeof window.okbot.readOwnerResourceText !== 'function') return;
        const res = await window.okbot.readOwnerResourceText(ownerId, item.id);
        if (!res?.ok || typeof res.text !== 'string') return;
        downloadTextBlob(res.text, downloadFileName(item), downloadMime(item));
      } catch {
        /* ignore */
      }
    })();
  }, [ownerId, item]);

  const node = (
    <div
      className="chat-image-lightbox chat-image-lightbox--cover"
      role="dialog"
      aria-modal="true"
      aria-label={t(lang, 'ownerFormResourcePreview')}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        className="chat-image-lightbox-backdrop"
        aria-hidden
        onClick={requestClose}
      />

      <div className="chat-image-lightbox-toolbar">
        <button
          type="button"
          className="chat-image-lightbox-btn"
          onClick={onDownload}
          title={t(lang, 'imagePreviewDownload')}
          aria-label={t(lang, 'imagePreviewDownload')}
        >
          <DownloadUpdateIcon />
        </button>
        <button
          type="button"
          className="chat-image-lightbox-btn"
          onClick={requestClose}
          title={t(lang, 'close')}
          aria-label={t(lang, 'close')}
        >
          <CloseIcon />
        </button>
      </div>

      <div
        className="chat-image-lightbox-stage chat-image-lightbox-stage--resource scroll-fade"
        onClick={(e) => {
          if (e.target === e.currentTarget) requestClose();
        }}
      >
        <div className="owner-resource-fullscreen-body">
          <div className="owner-resource-preview-title">{item.name}</div>
          <ResourcePreviewBody lang={lang} ownerId={ownerId} item={item} />
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(node, document.body);
  }
  return node;
}
