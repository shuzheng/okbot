import {
  DEFAULT_DANGEROUS_SHELL_PATTERNS,
} from '@okbot/shared';
import { ShellPatternsList } from './ShellPatternsList';
import { SettingsHelpTip } from './SettingsHelpTip';
import { SettingsToggle } from './SettingsToggle';

import { t, type UiLang } from '../../i18n';

export function SecuritySettingsPanel({
  lang,
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
}: {
  lang: UiLang;
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
}) {
  return (

    <div>
      <div className="settings-section-label" data-settings-id="securityMaster">
        {t(lang, 'security')}
      </div>
      <div className="settings-card settings-card-security">
        <div className="settings-row" data-settings-id="securityMaster">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'securityMaster')}</span>
            <SettingsHelpTip text={t(lang, 'securityMasterHint')} />
          </span>
            <SettingsToggle checked={securityEnabled} onChange={() => setSecurityEnabled((v: any) => !v)} />
        </div>
        <div className="settings-row" data-settings-id="securityBlockMode">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'securityBlockMode')}</span>
            <SettingsHelpTip text={t(lang, 'securityBlockModeHint')} />
          </span>
          <select
            value={blockMode}
            disabled={!securityEnabled}
            onChange={(e) =>
              setBlockMode(e.target.value === 'tripwire' ? 'tripwire' : 'reject')
            }
          >
            <option value="reject">{t(lang, 'securityBlockReject')}</option>
            <option value="tripwire">{t(lang, 'securityBlockTripwire')}</option>
          </select>
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
            <SettingsToggle checked={restrictToHome} onChange={() => setRestrictToHome((v: any) => !v)} disabled={!securityEnabled} />
        </div>
        <div className="settings-row settings-row-stack" data-settings-id="securityAllowedPaths">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'securityAllowedPaths')}</span>
            <SettingsHelpTip text={t(lang, 'securityAllowedPathsHint')} />
          </span>
          <textarea
            className="settings-paths-textarea"
            spellCheck={false}
            disabled={!securityEnabled}
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
            disabled={!securityEnabled}
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
              disabled={!securityEnabled || !shellPatternsEnabled}
              onClick={() => setShellPatternAddRequest((n: any) => n + 1)}
            >
              {t(lang, 'securityShellPatternAdd')}
            </button>
            <button
              type="button"
              className="settings-aar-add-btn"
              disabled={!securityEnabled || !shellPatternsEnabled || shellPatterns === undefined}
              onClick={() => setShellPatterns(undefined)}
              title={t(lang, 'securityShellPatternsResetHint')}
            >
              {t(lang, 'securityShellPatternsReset')}
            </button>
            <SettingsToggle
              checked={shellPatternsEnabled}
              onChange={() => setShellPatternsEnabled((v: any) => !v)}
              disabled={!securityEnabled}
            />
          </div>
        </div>
        {shellPatternsEnabled ? (
          <div className="settings-row settings-row-stack" data-settings-id="securityShellPatternsList">
            <ShellPatternsList
              lang={lang}
              patterns={shellPatterns ?? DEFAULT_DANGEROUS_SHELL_PATTERNS}
              disabled={!securityEnabled}
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
    </div>
  );
}
