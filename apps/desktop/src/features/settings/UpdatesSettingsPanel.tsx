import type { UpdaterStatus } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
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
    </div>
  );
}
