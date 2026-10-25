import { useEffect, useState } from 'react';
import type { LocalizedChangelogNotes, UpdaterStatus } from '@okbot/shared';
import { ChevronDownIcon } from '../../components/ui/icons';
import { t, type UiLang } from '../../i18n';
import { ChangelogNotesBody } from '../updates/ChangelogNotesBody';
import { SettingsHelpTip } from './SettingsHelpTip';
import { SettingsToggle } from './SettingsToggle';

export function UpdatesSettingsPanel({
  lang,
  autoUpdate,
  setAutoUpdate,
  updaterStatus,
  setUpdaterStatus,
  updaterBusy,
  setUpdaterBusy,
}: {
  lang: UiLang;
  autoUpdate: boolean;
  setAutoUpdate: React.Dispatch<React.SetStateAction<boolean>>;
  updaterStatus: UpdaterStatus | null;
  setUpdaterStatus: React.Dispatch<React.SetStateAction<UpdaterStatus | null>>;
  updaterBusy: boolean;
  setUpdaterBusy: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [history, setHistory] = useState<LocalizedChangelogNotes[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const getHistory = window.okbot.updaterGetChangelogHistory;
    if (typeof getHistory !== 'function') {
      setHistory([]);
      return;
    }
    void getHistory(lang).then((rows) => {
      if (!cancelled) setHistory(rows ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  return (
    <div>
      <div className="settings-section-label" data-settings-id="updateSection">
        {t(lang, 'updateSection')}
      </div>
      <div className="settings-card">
        <div className="settings-row" data-settings-id="currentVersion">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'currentVersion')}</span>
            <SettingsHelpTip text={t(lang, 'currentVersionHint')} />
          </span>
          <span className="settings-row-meta">{updaterStatus?.currentVersion || '—'}</span>
        </div>
        <div className="settings-row" data-settings-id="autoUpdate">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'autoUpdate')}</span>
            <SettingsHelpTip text={t(lang, 'autoUpdateHint')} />
          </span>
          <SettingsToggle checked={autoUpdate} onChange={() => setAutoUpdate((v) => !v)} />
        </div>
        <div className="settings-row" data-settings-id="checkUpdate">
          <span className="settings-row-label">
            {updaterStatus?.phase === 'available' && updaterStatus.availableVersion
              ? t(lang, 'updateAvailable', { version: updaterStatus.availableVersion })
              : updaterStatus?.phase === 'downloading'
                ? t(lang, 'updateDownloading', {
                    progress: String(updaterStatus.progress ?? 0),
                  })
                : updaterStatus?.phase === 'downloaded'
                  ? t(lang, 'updateDownloaded')
                  : updaterStatus?.phase === 'error' && updaterStatus.error
                    ? t(lang, 'updateError', { error: updaterStatus.error })
                    : updaterStatus?.phase === 'not-available'
                      ? t(lang, 'updateNotAvailable')
                      : t(lang, 'checkUpdate')}
          </span>
          <button
            type="button"
            className="settings-aar-add-btn"
            disabled={updaterBusy || updaterStatus?.phase === 'downloading'}
            onClick={() => {
              void (async () => {
                setUpdaterBusy(true);
                try {
                  if (updaterStatus?.phase === 'downloaded') {
                    await window.okbot.updaterInstall();
                  } else if (updaterStatus?.phase === 'available') {
                    setUpdaterStatus(await window.okbot.updaterDownload());
                  } else {
                    setUpdaterStatus(await window.okbot.updaterCheck());
                  }
                } finally {
                  setUpdaterBusy(false);
                }
              })();
            }}
          >
            {updaterStatus?.phase === 'downloaded'
              ? t(lang, 'installUpdate')
              : updaterStatus?.phase === 'available'
                ? t(lang, 'downloadUpdate')
                : updaterStatus?.phase === 'downloading'
                  ? t(lang, 'downloadingUpdate')
                  : updaterBusy || updaterStatus?.phase === 'checking'
                    ? t(lang, 'checkingUpdate')
                    : t(lang, 'checkUpdate')}
          </button>
        </div>
      </div>

      <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="changelogHistory">
        {t(lang, 'changelogHistory')}
      </div>
      <div className="settings-card changelog-history-card">
        {history == null ? (
          <p className="changelog-history-empty">{t(lang, 'changelogHistoryLoading')}</p>
        ) : history.length === 0 ? (
          <p className="changelog-history-empty">{t(lang, 'changelogHistoryEmpty')}</p>
        ) : (
          <ul className="changelog-history-timeline">
            {history.map((entry) => {
              const open = expanded === entry.version;
              return (
                <li
                  key={entry.version}
                  className={`changelog-history-item${open ? ' open' : ''}`}
                >
                  <button
                    type="button"
                    className="changelog-history-toggle"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : entry.version)}
                  >
                    <span className="changelog-history-dot" aria-hidden />
                    <span className="changelog-history-version">v{entry.version}</span>
                    <span className="changelog-history-title">{entry.title}</span>
                    <span
                      className={`model-icon-btn aar-expand-btn changelog-history-expand${open ? ' expanded' : ''}`}
                      aria-hidden
                    >
                      <ChevronDownIcon />
                    </span>
                  </button>
                  {open ? (
                    <div className="changelog-history-body">
                      <ChangelogNotesBody notes={entry} lang={lang} compact />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
