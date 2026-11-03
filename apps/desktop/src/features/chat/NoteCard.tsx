import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { NoteCardMeta, OwnerResourceInfo } from '@okbot/shared';
import { FileAttachIcon } from '../../components/ui/icons';
import { t, type UiLang } from '../../i18n';
import { NoteHtmlFrame } from '../owner/NoteHtmlFrame';
import { ResourceFullscreenPreview } from '../owner/ResourceFullscreenPreview';

/**
 * Chat bubble card for a note resource.
 * Top = one-shot live HTML preview (Electron capturePage, else NoteHtmlFrame; pointer-events none on thumb).
 * Bottom = title without .html. Thumbnail is never written to disk.
 * Click / Enter / Space opens the same fullscreen note preview as 资料库.
 */
export function NoteCard({
  lang,
  ownerId,
  note,
}: {
  lang: UiLang;
  ownerId: string;
  note: NoteCardMeta;
}) {
  const [shot, setShot] = useState<string | null>(null);
  const [iframeHtml, setIframeHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setShot(null);
    setIframeHtml(null);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        if (typeof window.okbot.readOwnerResourceText !== 'function') {
          if (!cancelled) {
            setError(t(lang, 'ownerFormResourcesPreviewUnavailable'));
            setLoading(false);
          }
          return;
        }
        const res = await window.okbot.readOwnerResourceText(ownerId, note.resourceId);
        if (cancelled) return;
        if (!res?.ok || typeof res.text !== 'string') {
          setError(res?.error || t(lang, 'ownerFormResourcesPreviewUnavailable'));
          setLoading(false);
          return;
        }
        const html = res.text;
        if (typeof window.okbot.captureNoteHtmlPreview === 'function') {
          const cap = await window.okbot.captureNoteHtmlPreview(html, {
            width: 720,
            height: 900,
          });
          if (cancelled) return;
          if (cap?.ok && cap.dataUrl) {
            setShot(cap.dataUrl);
            setLoading(false);
            return;
          }
        }
        // Web / capture unavailable: NoteHtmlFrame thumb (pointer-events none; no disk thumb).
        setIframeHtml(html);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally once per message mount / resource id (no continuous refresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on load
  }, [ownerId, note.resourceId, lang]);

  const title = (note.title || '').replace(/\.html?$/i, '').replace(/\.md$/i, '') || note.resourceId;

  const previewItem = useMemo<OwnerResourceInfo>(
    () => ({
      id: note.resourceId,
      type: 'note',
      name: title,
      path: '',
      createdBy: 'assistant',
      createdAt: '',
      updatedAt: '',
    }),
    [note.resourceId, title],
  );

  const openPreview = useCallback(() => {
    setPreviewOpen(true);
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPreview();
      }
    },
    [openPreview],
  );

  return (
    <>
      <div
        className="note-card"
        role="button"
        tabIndex={0}
        aria-label={title}
        onClick={openPreview}
        onKeyDown={onKeyDown}
      >
        <div className="note-card-preview">
          {loading ? (
            <div className="note-card-placeholder">{t(lang, 'noteCardLoading')}</div>
          ) : error ? (
            <div className="note-card-placeholder note-card-error">{error}</div>
          ) : shot ? (
            <img className="note-card-shot" src={shot} alt="" />
          ) : iframeHtml ? (
            <NoteHtmlFrame className="note-card-iframe" title={title} html={iframeHtml} />
          ) : (
            <div className="note-card-placeholder">{t(lang, 'ownerFormResourcesPreviewUnavailable')}</div>
          )}
        </div>
        <div className="note-card-footer" title={title}>
          <span className="note-card-footer-icon" aria-hidden>
            <FileAttachIcon />
          </span>
          <span className="note-card-footer-title">{title}</span>
        </div>
      </div>
      {previewOpen ? (
        <ResourceFullscreenPreview
          lang={lang}
          ownerId={ownerId}
          item={previewItem}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </>
  );
}
