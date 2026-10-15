import {
  normalizeCloseAction,
  normalizeDefaultAssistantId,
  type Bot,
  type ThemeMode,
} from '@okbot/shared';
import { applyTheme } from '../../utils/theme';
import { SettingsHelpTip } from './SettingsHelpTip';
import { SettingsToggle } from './SettingsToggle';

import { t, type UiLang } from '../../i18n';

export function GeneralSettingsPanel({
  lang,
  backupBusy,
  backupExcludeSecrets,
  closeAction,
  developerMode,
  hardwareAcceleration,
  language,
  micOptions,
  microphoneId,
  notifications,
  setBackupExcludeSecrets,
  setCloseAction,
  setDeveloperMode,
  setHardwareAcceleration,
  setLanguage,
  setMicrophoneId,
  setNotifications,
  setRevealAdvanced,
  setShowAdvancedSettings,
  setSidebarDockMagnify,
  setTheme,
  showAdvancedSettings,
  sidebarDockMagnify,
  theme,
  bots,
  defaultAssistantId,
  setDefaultAssistantId,
  gatewayClient,
  needsHwRestart,
  dataDir,
  exportBackup,
  restoreBackup,
}: {
  restoreBackup: () => void | Promise<void>;
  exportBackup: () => void | Promise<void>;
  dataDir: string;
  needsHwRestart: boolean;
  gatewayClient: boolean;
  lang: UiLang;
  backupBusy: any;
  backupExcludeSecrets: any;
  closeAction: any;
  developerMode: any;
  hardwareAcceleration: any;
  language: any;
  micOptions: any;
  microphoneId: any;
  notifications: any;
  setBackupExcludeSecrets: React.Dispatch<React.SetStateAction<any>>;
  setCloseAction: React.Dispatch<React.SetStateAction<any>>;
  setDeveloperMode: React.Dispatch<React.SetStateAction<any>>;
  setHardwareAcceleration: React.Dispatch<React.SetStateAction<any>>;
  setLanguage: React.Dispatch<React.SetStateAction<any>>;
  setMicrophoneId: React.Dispatch<React.SetStateAction<any>>;
  setNotifications: React.Dispatch<React.SetStateAction<any>>;
  setRevealAdvanced: React.Dispatch<React.SetStateAction<any>>;
  setShowAdvancedSettings: React.Dispatch<React.SetStateAction<any>>;
  setSidebarDockMagnify: React.Dispatch<React.SetStateAction<any>>;
  setTheme: React.Dispatch<React.SetStateAction<any>>;
  showAdvancedSettings: any;
  sidebarDockMagnify: any;
  theme: any;
  bots: Bot[];
  defaultAssistantId: string;
  setDefaultAssistantId: React.Dispatch<React.SetStateAction<string>>;
}) {
  return (

    <div>
      <div className="settings-section-label">{t(lang, 'appearance')}</div>
      <div className="settings-card">
        <div className="settings-row" data-settings-id="theme">
          <span className="settings-row-label">{t(lang, 'theme')}</span>
          <select
            value={theme}
            onChange={(e) => {
              const next = e.target.value as ThemeMode;
              setTheme(next);
              applyTheme(next);
            }}
          >
            <option value="system">{t(lang, 'themeSystem')}</option>
            <option value="light">{t(lang, 'themeLight')}</option>
            <option value="dark">{t(lang, 'themeDark')}</option>
          </select>
        </div>
        <div className="settings-row" data-settings-id="language">
          <span className="settings-row-label">{t(lang, 'language')}</span>
          <select
            value={language}
            onChange={(e) => {
              const v = e.target.value;
              setLanguage(v === 'en' || v === 'zh' || v === 'system' ? v : 'system');
            }}
          >
            <option value="system">{t(lang, 'langSystem')}</option>
            <option value="zh">{t(lang, 'langZh')}</option>
            <option value="en">{t(lang, 'langEn')}</option>
          </select>
        </div>
        <div className="settings-row" data-settings-id="defaultAssistant">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'defaultAssistant')}</span>
            <SettingsHelpTip text={t(lang, 'defaultAssistantHint')} />
          </span>
          <select
            value={normalizeDefaultAssistantId(defaultAssistantId, bots)}
            aria-label={t(lang, 'defaultAssistant')}
            onChange={(e) => setDefaultAssistantId(normalizeDefaultAssistantId(e.target.value, bots))}
          >
            <option value="">{t(lang, 'defaultAssistantNone')}</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row" data-settings-id="sidebarDockMagnify">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'sidebarDockMagnify')}</span>
            <SettingsHelpTip text={t(lang, 'sidebarDockMagnifyHint')} />
          </span>
          <SettingsToggle
            checked={sidebarDockMagnify}
            onChange={() => setSidebarDockMagnify((v: any) => !v)}
          />
        </div>
      </div>

      <div className="settings-section-label" style={{ marginTop: 16 }}>
        {t(lang, 'system')}
      </div>
      <div className="settings-card">
        <div className="settings-row" data-settings-id="microphone">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'microphone')}</span>
            <SettingsHelpTip text={t(lang, 'micSpeechDeviceHint')} />
          </span>
          <select
            value={microphoneId}
            onChange={(e) => setMicrophoneId(e.target.value)}
          >
            <option value="">{t(lang, 'micDefault')}</option>
            {micOptions.map((m: any) => (
              <option key={m.id || m.label} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row" data-settings-id="hardwareAcceleration">
          <span className="settings-row-label">{t(lang, 'hardwareAcceleration')}</span>
            <SettingsToggle checked={hardwareAcceleration} onChange={() => setHardwareAcceleration((v: any) => !v)} />
        </div>
        <div className="settings-row" data-settings-id="notifications">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'notificationsSetting')}</span>
            <SettingsHelpTip text={t(lang, 'notificationsSettingHint')} />
          </span>
          <SettingsToggle checked={notifications} onChange={() => setNotifications((v: any) => !v)} />
        </div>
        <div
          className="settings-row"
          data-settings-id="closeAction"
          aria-disabled={gatewayClient ? 'true' : undefined}
          title={gatewayClient ? t(lang, 'closeActionDesktopOnly') : undefined}
        >
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'closeActionSetting')}</span>
            <SettingsHelpTip text={t(lang, 'closeActionSettingHint')} />
          </span>
          <select
            value={closeAction}
            disabled={gatewayClient}
            onChange={(e) => setCloseAction(normalizeCloseAction(e.target.value))}
          >
            <option value="ask">{t(lang, 'closeActionAsk')}</option>
            <option value="tray">{t(lang, 'closeActionTray')}</option>
            <option value="quit">{t(lang, 'closeActionQuit')}</option>
          </select>
        </div>
      </div>
      {needsHwRestart ? (
        <div className="settings-restart-hint">{t(lang, 'hardwareRestart')}</div>
      ) : null}


      <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="advanced">
        {t(lang, 'advanced')}
      </div>
      <div className="settings-card">
        <div className="settings-row" data-settings-id="showAdvancedSettings">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'showAdvancedSettings')}</span>
            <SettingsHelpTip text={t(lang, 'showAdvancedSettingsHint')} />
          </span>
          <SettingsToggle
            checked={showAdvancedSettings}
            onChange={() => {
              setShowAdvancedSettings((v: any) => !v);
              setRevealAdvanced(false);
            }}
          />
        </div>
        <div className="settings-row" data-settings-id="developerMode">
          <span className="settings-row-label">{t(lang, 'developerMode')}</span>
          <SettingsToggle
            checked={developerMode}
            onChange={() => setDeveloperMode((v: any) => !v)}
          />
        </div>
      </div>

      <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="data">
        {t(lang, 'data')}
      </div>
      <div
        className="settings-card"
        aria-disabled={gatewayClient ? 'true' : undefined}
        title={gatewayClient ? t(lang, 'backupDesktopOnly') : undefined}
      >
        <div className="settings-row settings-row-stack" data-settings-id="dataDir">
          <span className="settings-row-label">{t(lang, 'dataDir')}</span>
          <span className="settings-hint settings-data-dir">{dataDir}</span>
        </div>
        <div className="settings-row" data-settings-id="backupExcludeSecrets">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'backupExcludeSecrets')}</span>
            <SettingsHelpTip text={t(lang, 'backupExcludeSecretsHint')} />
          </span>
          <SettingsToggle
            checked={backupExcludeSecrets}
            disabled={gatewayClient}
            onChange={() => setBackupExcludeSecrets((v: any) => !v)}
          />
        </div>
        <div className="settings-row" data-settings-id="backupExport">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'backupExport')}</span>
            <SettingsHelpTip text={t(lang, 'backupExportHint')} />
          </span>
          <button
            type="button"
            className="settings-aar-add-btn"
            disabled={gatewayClient || backupBusy}
            onClick={() => void exportBackup()}
          >
            {t(lang, 'backupExportAction')}
          </button>
        </div>
        <div className="settings-row" data-settings-id="backupRestore">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'backupRestore')}</span>
            <SettingsHelpTip text={t(lang, 'backupRestoreHint')} />
          </span>
          <button
            type="button"
            className="settings-aar-add-btn"
            disabled={gatewayClient || backupBusy}
            onClick={() => void restoreBackup()}
          >
            {t(lang, 'backupRestoreAction')}
          </button>
        </div>
      </div>
    </div>
  );
}
