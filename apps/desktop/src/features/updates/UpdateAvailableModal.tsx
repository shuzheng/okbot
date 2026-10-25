import { useEffect, useId } from 'react';
import type { LocalizedChangelogNotes, UpdaterStatus } from '@okbot/shared';
import { CloseIcon } from '../../components/ui/icons';
import { t, type UiLang } from '../../i18n';
import { ChangelogNotesBody } from './ChangelogNotesBody';

export function UpdateAvailableModal({
  lang,
  status,
  notes,
  force,
  onDismiss,
  onDownload,
  onInstall,
  busy,
}: {
  lang: UiLang;
  status: UpdaterStatus;
  notes: LocalizedChangelogNotes | null;
  force: boolean;
  onDismiss: () => void;
  onDownload: () => void;
  onInstall: () => void;
  busy?: boolean;
}) {
  const titleId = useId();
  const version = status.availableVersion ?? notes?.version ?? '';
  const phase = status.phase;
  const isDownloading = phase === 'downloading';
  const isReady = phase === 'downloaded';

  useEffect(() => {
    if (force) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [force, onDismiss]);

  const title =
    notes?.title ||
    t(lang, 'updateAvailable', { version });

  return (
    <div
      className={`modal-backdrop${force ? ' changelog-force-backdrop' : ''}`}
      onClick={force ? undefined : onDismiss}
      role="presentation"
    >
      <div
        className="modal changelog-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          {!force ? (
            <button
              type="button"
              className="modal-close"
              onClick={onDismiss}
              aria-label={t(lang, 'close')}
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
        <p className="changelog-version-meta">
          {force
            ? t(lang, 'forceUpdateRequired', { version })
            : t(lang, 'updateAvailable', { version })}
        </p>
        {notes ? <ChangelogNotesBody notes={notes} lang={lang} /> : null}
        {isDownloading ? (
          <p className="changelog-progress">
            {t(lang, 'updateDownloading', {
              progress: String(status.progress ?? 0),
            })}
          </p>
        ) : null}
        <div className="changelog-modal-actions">
          {!force ? (
            <button type="button" className="ghost" onClick={onDismiss} disabled={busy}>
              {t(lang, 'updateLater')}
            </button>
          ) : null}
          {isReady ? (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={onInstall}
            >
              {t(lang, 'installUpdate')}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy || isDownloading}
              onClick={onDownload}
            >
              {isDownloading ? t(lang, 'downloadingUpdate') : t(lang, 'downloadUpdate')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
