import {
  DEFAULT_DANGEROUS_SHELL_PATTERNS,
} from '@okbot/shared';
import { ShellPatternsList } from './ShellPatternsList';
import { SettingsHelpTip } from './SettingsHelpTip';
import { SettingsToggle } from './SettingsToggle';
import { SlidingPillTabs } from '../../components/ui';

import { t, type UiLang } from '../../i18n';

export type SecuritySubTab = 'tool' | 'agent';

export function SecuritySettingsPanel({
  lang,
  readOnly = false,
  securitySubTab,
  setSecuritySubTab,
  allowedPathsText,
  blockMode,
  deniedPathsText,
  restrictToHome,
  securityEnabled,
  setAllowedPathsText,
  setBlockMode,
  setDeniedPathsText,
  setRestrictToHome,
  setSecurityEnabled,
  setShellPatternAddRequest,
  setShellPatterns,
  setShellPatternsEnabled,
  shellPatternAddRequest,
  shellPatterns,
  shellPatternsEnabled,
  agentMaxInputCharsEnabled,
  setAgentMaxInputCharsEnabled,
  agentMaxInputChars,
  setAgentMaxInputChars,
  agentRejectEmptyInput,
  setAgentRejectEmptyInput,
  agentJailbreakEnabled,
  setAgentJailbreakEnabled,
  agentInjectionHygiene,
  setAgentInjectionHygiene,
  agentPiiPasteWarn,
  setAgentPiiPasteWarn,
  agentOutputSecretsEnabled,
  setAgentOutputSecretsEnabled,
  agentToolOutputSecretsEnabled,
  setAgentToolOutputSecretsEnabled,
}: {
  lang: UiLang;
  /** User-token / non-admin gateway client: host security is admin-only over HTTP. */
  readOnly?: boolean;
  securitySubTab: SecuritySubTab;
  setSecuritySubTab: React.Dispatch<React.SetStateAction<SecuritySubTab>>;
  allowedPathsText: any;
  blockMode: any;
  deniedPathsText: any;
  restrictToHome: any;
  securityEnabled: any;
  setAllowedPathsText: React.Dispatch<React.SetStateAction<any>>;
  setBlockMode: React.Dispatch<React.SetStateAction<any>>;
  setDeniedPathsText: React.Dispatch<React.SetStateAction<any>>;
  setRestrictToHome: React.Dispatch<React.SetStateAction<any>>;
  setSecurityEnabled: React.Dispatch<React.SetStateAction<any>>;
  setShellPatternAddRequest: React.Dispatch<React.SetStateAction<any>>;
  setShellPatterns: React.Dispatch<React.SetStateAction<any>>;
  setShellPatternsEnabled: React.Dispatch<React.SetStateAction<any>>;
  shellPatternAddRequest: any;
  shellPatterns: any;
  shellPatternsEnabled: any;
  agentMaxInputCharsEnabled: boolean;
  setAgentMaxInputCharsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  agentMaxInputChars: string;
  setAgentMaxInputChars: React.Dispatch<React.SetStateAction<string>>;
  agentRejectEmptyInput: boolean;
  setAgentRejectEmptyInput: React.Dispatch<React.SetStateAction<boolean>>;
  agentJailbreakEnabled: boolean;
  setAgentJailbreakEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  agentInjectionHygiene: boolean;
  setAgentInjectionHygiene: React.Dispatch<React.SetStateAction<boolean>>;
  agentPiiPasteWarn: boolean;
  setAgentPiiPasteWarn: React.Dispatch<React.SetStateAction<boolean>>;
  agentOutputSecretsEnabled: boolean;
  setAgentOutputSecretsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  agentToolOutputSecretsEnabled: boolean;
  setAgentToolOutputSecretsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const disabled = readOnly || !securityEnabled;

  return (
    <div>
      <SlidingPillTabs
        ariaLabel={t(lang, 'security')}
        value={securitySubTab}
        onChange={setSecuritySubTab}
        options={[
          { id: 'tool', label: t(lang, 'securityTabTool') },
          { id: 'agent', label: t(lang, 'securityTabAgent') },
        ]}
      />

      {securitySubTab === 'tool' ? (
        <>
          <div className="settings-section-label" data-settings-id="securityMaster">
            {t(lang, 'security')}
          </div>
          <div className="settings-card settings-card-security">
            <div className="settings-row" data-settings-id="securityMaster">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'securityMaster')}</span>
                <SettingsHelpTip text={t(lang, 'securityMasterHint')} />
              </span>
              <SettingsToggle disabled={readOnly} checked={securityEnabled} onChange={() => setSecurityEnabled((v: any) => !v)} />
            </div>
            <div className="settings-row" data-settings-id="securityBlockMode">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'securityBlockMode')}</span>
                <SettingsHelpTip text={t(lang, 'securityBlockModeHint')} />
              </span>
              <span className="settings-select-chevron-host">
                <select
                  value={blockMode}
                  disabled={disabled}
                  onChange={(e) =>
                    setBlockMode(e.target.value === 'tripwire' ? 'tripwire' : 'reject')
                  }
                >
                  <option value="reject">{t(lang, 'securityBlockReject')}</option>
                  <option value="tripwire">{t(lang, 'securityBlockTripwire')}</option>
                </select>
              </span>
            </div>
          </div>

          <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="securityRestrictToHome">
            {t(lang, 'securityPathScope')}
          </div>
          <div className="settings-card settings-card-security">
            <div className="settings-row" data-settings-id="securityRestrictToHome">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'securityRestrictToHome')}</span>
                <SettingsHelpTip text={t(lang, 'securityRestrictToHomeHint')} />
              </span>
              <SettingsToggle checked={restrictToHome} onChange={() => setRestrictToHome((v: any) => !v)} disabled={disabled} />
            </div>
            <div className="settings-row settings-row-stack" data-settings-id="securityAllowedPaths">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'securityAllowedPaths')}</span>
                <SettingsHelpTip text={t(lang, 'securityAllowedPathsHint')} />
              </span>
              <textarea
                className="settings-paths-textarea"
                spellCheck={false}
                disabled={disabled}
                placeholder={t(lang, 'securityAllowedPathsPlaceholder')}
                value={allowedPathsText}
                onChange={(e) => setAllowedPathsText(e.target.value)}
                rows={3}
              />
            </div>
            <div className="settings-row settings-row-stack" data-settings-id="securityDeniedPaths">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'securityDeniedPaths')}</span>
                <SettingsHelpTip text={t(lang, 'securityDeniedPathsHint')} />
              </span>
              <textarea
                className="settings-paths-textarea"
                spellCheck={false}
                disabled={disabled}
                placeholder={t(lang, 'securityDeniedPathsPlaceholder')}
                value={deniedPathsText}
                onChange={(e) => setDeniedPathsText(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="securityShellPatterns">
            {t(lang, 'securityShellPolicy')}
          </div>
          <div className="settings-card settings-card-security">
            <div className="settings-row" data-settings-id="securityShellPatterns">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'securityShellPatterns')}</span>
                <SettingsHelpTip text={t(lang, 'securityShellPatternsHint')} />
              </span>
              <div className="settings-row-trailing">
                <button
                  type="button"
                  className="settings-aar-add-btn"
                  disabled={disabled || !shellPatternsEnabled}
                  onClick={() => setShellPatternAddRequest((n: any) => n + 1)}
                >
                  {t(lang, 'securityShellPatternAdd')}
                </button>
                <button
                  type="button"
                  className="settings-aar-add-btn"
                  disabled={disabled || !shellPatternsEnabled || shellPatterns === undefined}
                  onClick={() => setShellPatterns(undefined)}
                  title={t(lang, 'securityShellPatternsResetHint')}
                >
                  {t(lang, 'securityShellPatternsReset')}
                </button>
                <SettingsToggle
                  checked={shellPatternsEnabled}
                  onChange={() => setShellPatternsEnabled((v: any) => !v)}
                  disabled={disabled}
                />
              </div>
            </div>
            {shellPatternsEnabled ? (
              <div className="settings-row settings-row-stack" data-settings-id="securityShellPatternsList">
                <ShellPatternsList
                  lang={lang}
                  patterns={shellPatterns ?? DEFAULT_DANGEROUS_SHELL_PATTERNS}
                  disabled={disabled}
                  requestAdd={shellPatternAddRequest}
                  onChange={(next) => setShellPatterns(next)}
                />
              </div>
            ) : null}
          </div>

          <div className="settings-hint settings-security-approval-hint" data-settings-id="securityApprovalRelation">
            <strong>{t(lang, 'securityApprovalRelation')}</strong>
            {' — '}
            {t(lang, 'securityApprovalRelationHint')}
          </div>
        </>
      ) : (
        <>
          <div className="settings-section-label" data-settings-id="securityAgentInput">
            {t(lang, 'securityAgentInput')}
          </div>
          <div className="settings-card settings-card-security">
            <div className="settings-row" data-settings-id="securityAgentRejectEmpty">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'securityAgentRejectEmpty')}</span>
                <SettingsHelpTip text={t(lang, 'securityAgentRejectEmptyHint')} />
              </span>
              <SettingsToggle
                checked={agentRejectEmptyInput}
                onChange={() => setAgentRejectEmptyInput((v) => !v)}
                disabled={disabled}
              />
            </div>
            <div className="settings-row" data-settings-id="securityAgentMaxInput">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'securityAgentMaxInput')}</span>
                <SettingsHelpTip text={t(lang, 'securityAgentMaxInputHint')} />
              </span>
              <div className="settings-row-trailing">
                <input
                  type="number"
                  className="settings-number-input"
                  min={1000}
                  max={2000000}
                  step={1000}
                  disabled={disabled || !agentMaxInputCharsEnabled}
                  value={agentMaxInputChars}
                  onChange={(e) => setAgentMaxInputChars(e.target.value)}
                  style={{ width: 110, marginRight: 8 }}
                />
                <SettingsToggle
                  checked={agentMaxInputCharsEnabled}
                  onChange={() => setAgentMaxInputCharsEnabled((v) => !v)}
                  disabled={disabled}
                />
              </div>
            </div>
            <div className="settings-row" data-settings-id="securityAgentJailbreak">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'securityAgentJailbreak')}</span>
                <SettingsHelpTip text={t(lang, 'securityAgentJailbreakHint')} />
              </span>
              <SettingsToggle
                checked={agentJailbreakEnabled}
                onChange={() => setAgentJailbreakEnabled((v) => !v)}
                disabled={disabled}
              />
            </div>
            <div className="settings-row" data-settings-id="securityAgentInjection">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'securityAgentInjection')}</span>
                <SettingsHelpTip text={t(lang, 'securityAgentInjectionHint')} />
              </span>
              <SettingsToggle
                checked={agentInjectionHygiene}
                onChange={() => setAgentInjectionHygiene((v) => !v)}
                disabled={disabled}
              />
            </div>
            <div className="settings-row" data-settings-id="securityAgentPiiPaste">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'securityAgentPiiPaste')}</span>
                <SettingsHelpTip text={t(lang, 'securityAgentPiiPasteHint')} />
              </span>
              <SettingsToggle
                checked={agentPiiPasteWarn}
                onChange={() => setAgentPiiPasteWarn((v) => !v)}
                disabled={disabled}
              />
            </div>
          </div>

          <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="securityAgentOutput">
            {t(lang, 'securityAgentOutput')}
          </div>
          <div className="settings-card settings-card-security">
            <div className="settings-row" data-settings-id="securityAgentOutputSecrets">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'securityAgentOutputSecrets')}</span>
                <SettingsHelpTip text={t(lang, 'securityAgentOutputSecretsHint')} />
              </span>
              <SettingsToggle
                checked={agentOutputSecretsEnabled}
                onChange={() => setAgentOutputSecretsEnabled((v) => !v)}
                disabled={disabled}
              />
            </div>
          </div>

          <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="securityAgentToolOutput">
            {t(lang, 'securityAgentToolOutput')}
          </div>
          <div className="settings-card settings-card-security">
            <div className="settings-row" data-settings-id="securityAgentToolOutputSecrets">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'securityAgentToolOutputSecrets')}</span>
                <SettingsHelpTip text={t(lang, 'securityAgentToolOutputSecretsHint')} />
              </span>
              <SettingsToggle
                checked={agentToolOutputSecretsEnabled}
                onChange={() => setAgentToolOutputSecretsEnabled((v) => !v)}
                disabled={disabled}
              />
            </div>
          </div>

          <div className="settings-hint settings-security-approval-hint" data-settings-id="securityAgentNote">
            {t(lang, 'securityAgentNote')}
          </div>
        </>
      )}
    </div>
  );
}
