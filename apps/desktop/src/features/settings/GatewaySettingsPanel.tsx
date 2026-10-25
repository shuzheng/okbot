import {
  type Bot,
  type ComputerEntry,
  type GatewayApiTokenEntry,
  type Squad,
} from '@okbot/shared';
import { SettingsHelpTip } from './SettingsHelpTip';
import { SettingsToggle } from './SettingsToggle';
import { ComputersSettingsPanel } from './ComputersSettingsPanel';
import { GatewayApiTokensPanel } from './GatewayApiTokensPanel';
import { gatewayWebUiUrl } from './settingsHelpers';

import { t, type UiLang } from '../../i18n';

export function GatewaySettingsPanel({
  lang,
  gatewayHttpApiBindLan,
  gatewayHttpApiPort,
  gatewayHttpApiServeUi,
  gatewayHttpApiToken,
  gatewayApiTokens,
  setGatewayHttpApiBindLan,
  setGatewayHttpApiPort,
  setGatewayHttpApiServeUi,
  onGatewayApiTokensChange,
  computers,
  defaultComputerId,
  onComputersChange,
  onDefaultComputerIdChange,
  gatewayClient,
  dataDir,
  backupBusy,
  backupExcludeSecrets,
  setBackupExcludeSecrets,
  exportBackup,
  restoreBackup,
  bots = [],
  squads = [],
}: {
  lang: UiLang;
  gatewayHttpApiBindLan: boolean;
  gatewayHttpApiPort: string;
  gatewayHttpApiServeUi: boolean;
  /** Primary access token (for Open Web UI link). */
  gatewayHttpApiToken: string;
  gatewayApiTokens: GatewayApiTokenEntry[];
  setGatewayHttpApiBindLan: React.Dispatch<React.SetStateAction<boolean>>;
  setGatewayHttpApiPort: React.Dispatch<React.SetStateAction<string>>;
  setGatewayHttpApiServeUi: React.Dispatch<React.SetStateAction<boolean>>;
  onGatewayApiTokensChange: (next: GatewayApiTokenEntry[]) => void;
  computers: ComputerEntry[];
  defaultComputerId: string;
  onComputersChange: (next: ComputerEntry[]) => void;
  onDefaultComputerIdChange: (id: string) => void;
  gatewayClient: boolean;
  dataDir: string;
  backupBusy: boolean;
  backupExcludeSecrets: boolean;
  setBackupExcludeSecrets: React.Dispatch<React.SetStateAction<boolean>>;
  exportBackup: () => void | Promise<void>;
  restoreBackup: () => void | Promise<void>;
  bots?: Bot[];
  squads?: Squad[];
}) {
  return (
    <div>
      <div className="settings-section-label" data-settings-id="gatewayHttpApi">
        {t(lang, 'gatewayHttpApi')}
        <span className="settings-scope-tag" title={t(lang, 'settingsGatewayScopeHint')}>
          {t(lang, 'settingsGatewayScope')}
        </span>
      </div>
      <p className="settings-hint" style={{ marginTop: -4, marginBottom: 8 }}>
        {t(lang, 'gatewayHttpApiHostHint')}
      </p>
      <div className="settings-card">
        <div className="settings-row" data-settings-id="gatewayHttpApiPort">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'gatewayHttpApiPort')}</span>
            <SettingsHelpTip text={t(lang, 'gatewayHttpApiPortHint')} />
          </span>
          <input
            spellCheck={false}
            className="wide"
            type="number"
            min={1024}
            max={65535}
            step={1}
            value={gatewayHttpApiPort}
            onChange={(e) => setGatewayHttpApiPort(e.target.value)}
          />
        </div>
        <div className="settings-row" data-settings-id="gatewayHttpApiBindLan">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'gatewayHttpApiBindLan')}</span>
            <SettingsHelpTip text={t(lang, 'gatewayHttpApiBindLanHint')} />
          </span>
          <SettingsToggle
            checked={gatewayHttpApiBindLan}
            onChange={() => setGatewayHttpApiBindLan((v) => !v)}
          />
        </div>
        <div className="settings-row" data-settings-id="gatewayHttpApiServeUi">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'gatewayHttpApiServeUi')}</span>
            <SettingsHelpTip text={t(lang, 'gatewayHttpApiServeUiHint')} />
          </span>
          <span className="settings-row-trailing">
            {gatewayHttpApiServeUi ? (
              <a
                className="settings-inline-link"
                href={gatewayWebUiUrl(gatewayHttpApiPort, gatewayHttpApiToken)}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t(lang, 'gatewayHttpApiOpenUi')}
              </a>
            ) : null}
            <SettingsToggle
              checked={gatewayHttpApiServeUi}
              onChange={() => setGatewayHttpApiServeUi((v) => !v)}
            />
          </span>
        </div>
      </div>

      <GatewayApiTokensPanel
        lang={lang}
        apiTokens={gatewayApiTokens}
        onChange={onGatewayApiTokensChange}
        bots={bots}
        squads={squads}
        readOnly={gatewayClient}
      />

      <ComputersSettingsPanel
        lang={lang}
        computers={computers}
        defaultComputerId={defaultComputerId}
        onChange={onComputersChange}
        onDefaultComputerIdChange={onDefaultComputerIdChange}
        embedded
      />

      <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="data">
        {t(lang, 'data')}
        <span className="settings-scope-tag" title={t(lang, 'settingsGatewayScopeHint')}>
          {t(lang, 'settingsGatewayScope')}
        </span>
      </div>
      <p className="settings-hint" style={{ marginTop: -4, marginBottom: 8 }}>
        {t(lang, 'dataGatewayHint')}
      </p>
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
            onChange={() => setBackupExcludeSecrets((v) => !v)}
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
