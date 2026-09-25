import { useEffect, useState } from 'react';
import type { AppInfo } from '@okbot/shared';
import { resolveUiLang, t, type UiLang } from '../../i18n';
import { CloseIcon } from '../../components/ui/icons';
import okbotIcon from '../../assets/okbot-icon.png';

function formatVersionBlob(info: AppInfo): string {
  return [
    `OkBot ${info.version}`,
    `Build date: ${info.buildDate}`,
    info.copyright,
    `Platform: ${info.platform} ${info.arch}`,
    `Electron: ${info.electron}`,
    `Chrome: ${info.chrome}`,
    `Node: ${info.node}`,
  ].join('\n');
}

type ErrorLogRow = {
  ts: string;
  ownerId: string;
  messageId?: string;
  phase: string;
  error: string;
};

export function AboutModal({
  lang,
  onClose,
}: {
  lang: UiLang;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorLogOpen, setErrorLogOpen] = useState(false);
  const [errorEntries, setErrorEntries] = useState<ErrorLogRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.okbot.getAppInfo().then((next) => {
      if (!cancelled) setInfo(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (errorLogOpen) {
          setErrorLogOpen(false);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, errorLogOpen]);

  async function openErrorLog() {
    setErrorLogOpen(true);
    setErrorEntries(null);
    try {
      const res = await window.okbot.getRecentErrorLog(40);
      setErrorEntries(res.entries ?? []);
    } catch (err) {
      setErrorEntries([
        {
          ts: new Date().toISOString(),
          ownerId: '-',
          phase: 'ui',
          error: err instanceof Error ? err.message : String(err),
        },
      ]);
    }
  }

  const version = info?.version ?? '…';
  const buildDate = info?.buildDate ?? '…';
  const copyright = info?.copyright ?? '© OkBot';

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal about-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, 'aboutTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label={t(lang, 'close')}
        >
          <CloseIcon />
        </button>
        <img className="about-icon" src={okbotIcon} alt="" width={72} height={72} />
        <h2 className="about-name">OkBot</h2>
        <p className="about-meta">
          {t(lang, 'aboutVersion', { version })}
          <br />
          {t(lang, 'aboutBuildDate', { date: buildDate })}
          <br />
          {copyright}
        </p>
        <button
          type="button"
          className={`about-copy-btn${copied ? ' copied' : ''}`}
          disabled={!info}
          onClick={() => {
            if (!info) return;
            void (async () => {
              await window.okbot.copyText(formatVersionBlob(info));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })();
          }}
        >
          {copied ? t(lang, 'aboutCopied') : t(lang, 'aboutCopy')}
        </button>
        <button type="button" className="about-copy-btn" onClick={() => void openErrorLog()}>
          {t(lang, 'errorLogOpen')}
        </button>
        {errorLogOpen ? (
          <div className="about-error-log" role="region" aria-label={t(lang, 'errorLogTitle')}>
            <div className="about-error-log-head">
              <strong>{t(lang, 'errorLogTitle')}</strong>
              <span className="about-error-log-hint">{t(lang, 'errorLogHint')}</span>
            </div>
            {errorEntries == null ? (
              <p className="about-error-log-empty">…</p>
            ) : errorEntries.length === 0 ? (
              <p className="about-error-log-empty">{t(lang, 'errorLogEmpty')}</p>
            ) : (
              <ul className="about-error-log-list">
                {errorEntries.map((e, i) => (
                  <li key={`${e.ts}-${i}`}>
                    <code>{e.ts}</code> · {e.phase} · {e.ownerId}
                    <div>{e.error}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Convenience for callers that only have LanguageCode settings. */
export function AboutModalFromSettings({
  language,
  onClose,
}: {
  language?: Parameters<typeof resolveUiLang>[0];
  onClose: () => void;
}) {
  return <AboutModal lang={resolveUiLang(language)} onClose={onClose} />;
}
