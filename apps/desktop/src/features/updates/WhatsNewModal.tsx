import { useEffect, useId } from 'react';
import type { LocalizedChangelogNotes } from '@okbot/shared';
import { CloseIcon } from '../../components/ui/icons';
import { t, type UiLang } from '../../i18n';
import { ChangelogNotesBody } from './ChangelogNotesBody';

export function WhatsNewModal({
  lang,
  notes,
  onClose,
}: {
  lang: UiLang;
  notes: LocalizedChangelogNotes;
  onClose: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal changelog-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId}>{notes.title || t(lang, 'whatsNewTitle')}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label={t(lang, 'close')}
          >
            <CloseIcon />
          </button>
        </div>
        <p className="changelog-version-meta">
          {t(lang, 'whatsNewVersion', { version: notes.version })}
        </p>
        <ChangelogNotesBody notes={notes} lang={lang} />
      </div>
    </div>
  );
}
