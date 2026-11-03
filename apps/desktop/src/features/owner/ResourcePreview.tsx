import { useEffect, useMemo, useState } from 'react';
import {
  isAvResourceType,
  isCodeOrTextResourceType,
  isHtmlResourceType,
  isImageResourceType,
  isMarkdownResourceType,
  isNoteResourceType,
  isPdfResourceType,
  type OwnerResourceInfo,
} from '@okbot/shared';
import { MarkdownContent } from '../chat/MarkdownContent';
import { NoteHtmlFrame } from './NoteHtmlFrame';
import { ImageLightbox } from '../chat/ImageLightbox';
import { resolveMediaAssetUrl } from '../../utils/mediaAsset';
import { t, type UiLang } from '../../i18n';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import csharp from 'highlight.js/lib/languages/csharp';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import 'highlight.js/styles/github-dark.min.css';

let hljsReady = false;
function ensureHljs(): void {
  if (hljsReady) return;
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('js', javascript);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('ts', typescript);
  hljs.registerLanguage('tsx', typescript);
  hljs.registerLanguage('jsx', javascript);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('sh', shell);
  hljs.registerLanguage('shell', shell);
  hljs.registerLanguage('zsh', shell);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('py', python);
  hljs.registerLanguage('go', go);
  hljs.registerLanguage('rust', rust);
  hljs.registerLanguage('java', java);
  hljs.registerLanguage('csharp', csharp);
  hljs.registerLanguage('cs', csharp);
  hljs.registerLanguage('cpp', cpp);
  hljs.registerLanguage('c', cpp);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('html', xml);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('svg', xml);
  hljs.registerLanguage('sql', sql);
  hljs.registerLanguage('yaml', yaml);
  hljs.registerLanguage('yml', yaml);
  hljs.registerLanguage('markdown', markdown);
  hljs.registerLanguage('md', markdown);
  hljs.registerLanguage('plaintext', plaintext);
  hljs.registerLanguage('text', plaintext);
  hljsReady = true;
}

function highlightCode(code: string, language: string): string {
  ensureHljs();
  const lang = (language || 'text').toLowerCase();
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return '';
  }
}

export function isOwnerResourceEmbedPreviewable(type: string): boolean {
  return (
    isNoteResourceType(type) ||
    isMarkdownResourceType(type) ||
    isCodeOrTextResourceType(type) ||
    isImageResourceType(type)
  );
}

export function ResourcePreviewBody({
  lang,
  ownerId,
  item,
}: {
  lang: UiLang;
  ownerId: string;
  item: OwnerResourceInfo;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(false);

  const isNote = isNoteResourceType(item.type);
  const needsText =
    !isNote &&
    (isMarkdownResourceType(item.type) || isCodeOrTextResourceType(item.type));

  useEffect(() => {
    setText(null);
    setError(null);
    setImgSrc(null);
    setLightbox(false);
    if (!needsText) return;
    let cancelled = false;
    void (async () => {
      try {
        if (typeof window.okbot.readOwnerResourceText !== 'function') {
          setError(t(lang, 'ownerFormResourcesPreviewUnavailable'));
          return;
        }
        const res = await window.okbot.readOwnerResourceText(ownerId, item.id);
        if (cancelled) return;
        if (res && res.ok && typeof res.text === 'string') setText(res.text);
        else setError(res?.error || t(lang, 'ownerFormResourcesPreviewUnavailable'));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerId, item.id, item.type, needsText, lang]);

  useEffect(() => {
    if (!isImageResourceType(item.type)) return;
    let cancelled = false;
    void (async () => {
      try {
        if (item.assetRel) {
          const mediaUrl = await resolveMediaAssetUrl(item.assetRel);
          if (cancelled) return;
          if (mediaUrl) {
            setImgSrc(mediaUrl);
            return;
          }
          if (typeof window.okbot.readGeneratedAssetDataUrl === 'function') {
            const res = await window.okbot.readGeneratedAssetDataUrl(item.assetRel);
            if (cancelled) return;
            if (res && 'ok' in res && res.ok && res.dataUrl) {
              setImgSrc(res.dataUrl);
            }
          }
        }
      } catch {
        /* keep empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item]);

  // Notes: interactive HTML preview + edit (required; generic html still skipped).
  const [noteHtml, setNoteHtml] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    if (!isNote) return;
    let cancelled = false;
    setNoteHtml(null);
    setNoteDraft('');
    setNoteEditing(false);
    setNoteError(null);
    void (async () => {
      try {
        if (typeof window.okbot.readOwnerResourceText !== 'function') {
          if (!cancelled) setNoteError(t(lang, 'ownerFormResourcesPreviewUnavailable'));
          return;
        }
        const res = await window.okbot.readOwnerResourceText(ownerId, item.id);
        if (cancelled) return;
        if (res && res.ok && typeof res.text === 'string') {
          setNoteHtml(res.text);
          setNoteDraft(res.text);
        } else {
          setNoteError(res?.error || t(lang, 'ownerFormResourcesPreviewUnavailable'));
        }
      } catch (err) {
        if (!cancelled) setNoteError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNote, ownerId, item.id, lang]);

  const highlighted = useMemo(() => {
    if (!text || !isCodeOrTextResourceType(item.type) || isMarkdownResourceType(item.type)) {
      return '';
    }
    return highlightCode(text, item.type === 'txt' ? 'text' : item.type);
  }, [text, item.type]);


  if (isNote) {
    if (noteError) {
      return (
        <div className="settings-hint" style={{ color: 'var(--danger, #c44)' }}>
          {noteError}
        </div>
      );
    }
    if (noteHtml == null) {
      return <div className="settings-hint">{t(lang, 'ownerFormResourcesLoading')}</div>;
    }
    return (
      <div className="owner-resource-note">
        <div className="owner-resource-note-toolbar">
          <button
            type="button"
            className="owner-resources-tool-btn"
            disabled={noteSaving}
            onClick={() => {
              if (noteEditing) {
                setNoteDraft(noteHtml);
                setNoteEditing(false);
              } else {
                setNoteEditing(true);
              }
            }}
          >
            {noteEditing
              ? t(lang, 'ownerFormResourcesNoteCancelEdit')
              : t(lang, 'ownerFormResourcesNoteEdit')}
          </button>
          {noteEditing ? (
            <button
              type="button"
              className="owner-resources-tool-btn"
              disabled={noteSaving}
              onClick={() => {
                void (async () => {
                  if (typeof window.okbot.writeOwnerResourceText !== 'function') {
                    setNoteError(t(lang, 'ownerFormResourcesAddFailed'));
                    return;
                  }
                  setNoteSaving(true);
                  try {
                    const res = await window.okbot.writeOwnerResourceText(
                      ownerId,
                      item.id,
                      noteDraft,
                    );
                    if (!res?.ok) {
                      setNoteError(res?.error || t(lang, 'ownerFormResourcesAddFailed'));
                      return;
                    }
                    setNoteHtml(noteDraft);
                    setNoteEditing(false);
                  } catch (err) {
                    setNoteError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setNoteSaving(false);
                  }
                })();
              }}
            >
              {t(lang, 'ownerFormResourcesNoteSave')}
            </button>
          ) : null}
        </div>
        {noteEditing ? (
          <textarea
            className="owner-resource-note-editor scroll-fade"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <NoteHtmlFrame
            className="owner-resource-note-frame"
            title={item.name}
            html={noteHtml}
          />
        )}
      </div>
    );
  }

  if (item.type === 'url' || item.type === 'folder') {
    return (
      <div className="settings-hint">
        {t(lang, 'ownerFormResourcesOpenExternalHint')}
      </div>
    );
  }

  if (isHtmlResourceType(item.type)) {
    // No iframe/webview browser embed; weui unavailable — skip fancy HTML preview.
    return (
      <div className="settings-hint">{t(lang, 'ownerFormResourcesHtmlSkip')}</div>
    );
  }

  if (isImageResourceType(item.type)) {
    if (!imgSrc) {
      return <div className="settings-hint">{t(lang, 'ownerFormResourcesPreviewUnavailable')}</div>;
    }
    return (
      <>
        <button
          type="button"
          className="owner-resource-preview-img-btn"
          onClick={() => setLightbox(true)}
        >
          <img src={imgSrc} alt={item.name} className="owner-resource-preview-img" />
        </button>
        {lightbox ? (
          <ImageLightbox
            lang={lang}
            target={{ src: imgSrc, alt: item.name, fileName: item.name }}
            onClose={() => setLightbox(false)}
            variant="cover"
          />
        ) : null}
      </>
    );
  }

  if (isPdfResourceType(item.type) || isAvResourceType(item.type)) {
    return (
      <div className="settings-hint">{t(lang, 'ownerFormResourcesOpenExternalHint')}</div>
    );
  }

  if (needsText) {
    if (error) {
      return (
        <div className="settings-hint" style={{ color: 'var(--danger, #c44)' }}>
          {error}
        </div>
      );
    }
    if (text == null) {
      return <div className="settings-hint">{t(lang, 'ownerFormResourcesLoading')}</div>;
    }
    if (isMarkdownResourceType(item.type)) {
      return (
        <div className="owner-resource-preview-md scroll-fade">
          <MarkdownContent lang={lang}>{text}</MarkdownContent>
        </div>
      );
    }
    return (
      <div className="md-code owner-resource-preview-code scroll-fade">
        <div className="md-code-bar">
          <span className="md-code-lang">{item.type || 'text'}</span>
        </div>
        <pre className="hljs">
          {highlighted ? (
            <code
              className={`language-${item.type}`}
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          ) : (
            <code>{text}</code>
          )}
        </pre>
      </div>
    );
  }

  return (
    <div className="settings-hint">{t(lang, 'ownerFormResourcesOpenExternalHint')}</div>
  );
}
