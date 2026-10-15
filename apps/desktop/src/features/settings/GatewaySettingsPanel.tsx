import { CopyIcon, EyeIcon, EyeOffIcon } from '../../components/ui/icons';
import {
  sanitizeLocalHttpApiToken,
  generateLocalHttpApiToken,
} from '@okbot/shared';
import { toast } from '../../components/ui';
import { SettingsHelpTip } from './SettingsHelpTip';
import { SettingsToggle } from './SettingsToggle';
import { gatewayWebUiUrl, readSavedGatewayToken } from './settingsHelpers';

import { t, type UiLang } from '../../i18n';

export function GatewaySettingsPanel({
  lang,
  localHttpApiBindLan,
  localHttpApiEnabled,
  localHttpApiPort,
  localHttpApiServeUi,
  localHttpApiToken,
  setLocalHttpApiBindLan,
  setLocalHttpApiEnabled,
  setLocalHttpApiPort,
  setLocalHttpApiServeUi,
  setLocalHttpApiToken,
  setShowLocalHttpApiToken,
  showLocalHttpApiToken,
  saveTimerRef,
  pendingSaveRef,
}: {
  pendingSaveRef: React.MutableRefObject<(() => void | Promise<void>) | null>;
  saveTimerRef: React.MutableRefObject<number | null>;
  lang: UiLang;
  localHttpApiBindLan: any;
  localHttpApiEnabled: any;
  localHttpApiPort: any;
  localHttpApiServeUi: any;
  localHttpApiToken: any;
  setLocalHttpApiBindLan: React.Dispatch<React.SetStateAction<any>>;
  setLocalHttpApiEnabled: React.Dispatch<React.SetStateAction<any>>;
  setLocalHttpApiPort: React.Dispatch<React.SetStateAction<any>>;
  setLocalHttpApiServeUi: React.Dispatch<React.SetStateAction<any>>;
  setLocalHttpApiToken: React.Dispatch<React.SetStateAction<any>>;
  setShowLocalHttpApiToken: React.Dispatch<React.SetStateAction<any>>;
  showLocalHttpApiToken: any;
}) {
  return (

    <div>
      <div className="settings-section-label" data-settings-id="localHttpApi">
        {t(lang, 'localHttpApi')}
      </div>
      <div className="settings-card">
        <div className="settings-row" data-settings-id="localHttpApiEnable">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'localHttpApiEnable')}</span>
            <SettingsHelpTip text={t(lang, 'localHttpApiHint')} />
          </span>
          <SettingsToggle
            checked={localHttpApiEnabled}
            onChange={() => setLocalHttpApiEnabled((v: any) => !v)}
          />
        </div>
        <div className="settings-row" data-settings-id="localHttpApiPort">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'localHttpApiPort')}</span>
            <SettingsHelpTip text={t(lang, 'localHttpApiPortHint')} />
          </span>
          <input
            spellCheck={false}
            className="wide"
            type="number"
            min={1024}
            max={65535}
            step={1}
            value={localHttpApiPort}
            disabled={!localHttpApiEnabled}
            onChange={(e) => setLocalHttpApiPort(e.target.value)}
          />
        </div>
        <div className="settings-row settings-row-stack" data-settings-id="localHttpApiToken">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'localHttpApiToken')}</span>
            <SettingsHelpTip text={t(lang, 'localHttpApiTokenHint')} />
          </span>
          <div className="settings-secret settings-secret-multi">
            <input
              type={showLocalHttpApiToken ? 'text' : 'password'}
              className="wide"
              value={localHttpApiToken}
              disabled={!localHttpApiEnabled}
              onChange={(e) => setLocalHttpApiToken(sanitizeLocalHttpApiToken(e.target.value))}
              spellCheck={false}
              autoComplete="off"
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
            />
            <div className="settings-secret-actions">
              <button
                type="button"
                className="settings-eye"
                disabled={!localHttpApiEnabled}
                aria-label={t(lang, showLocalHttpApiToken ? 'localHttpApiHideToken' : 'localHttpApiShowToken')}
                title={t(lang, showLocalHttpApiToken ? 'localHttpApiHideToken' : 'localHttpApiShowToken')}
                onClick={() => setShowLocalHttpApiToken((v: any) => !v)}
              >
                {showLocalHttpApiToken ? <EyeOffIcon /> : <EyeIcon />}
              </button>
              <button
                type="button"
                className="settings-eye"
                disabled={!localHttpApiEnabled}
                aria-label={t(lang, 'localHttpApiCopyToken')}
                title={t(lang, 'localHttpApiCopyToken')}
                onClick={() => {
                  void (async () => {
                    if (saveTimerRef.current != null) {
                      window.clearTimeout(saveTimerRef.current);
                      saveTimerRef.current = null;
                    }
                    const pending = pendingSaveRef.current;
                    pendingSaveRef.current = null;
                    if (pending) await pending();
                    const token = await readSavedGatewayToken();
                    if (!token) {
                      toast.info(t(lang, 'localHttpApiTokenEmpty'));
                      return;
                    }
                    if (token !== localHttpApiToken) {
                      setLocalHttpApiToken(token);
                      toast.info(t(lang, 'localHttpApiTokenSynced'));
                    }
                    await window.okbot.copyText(token);
                    toast.success(t(lang, 'localHttpApiTokenCopied'));
                  })();
                }}
              >
                <CopyIcon />
              </button>
              <button
                type="button"
                className="settings-eye"
                disabled={!localHttpApiEnabled}
                aria-label={t(lang, 'localHttpApiRegenerateToken')}
                title={t(lang, 'localHttpApiRegenerateToken')}
                onClick={() => {
                  setLocalHttpApiToken(generateLocalHttpApiToken());
                  toast.success(t(lang, 'localHttpApiTokenRegenerated'));
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 16h5v5" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div className="settings-row" data-settings-id="localHttpApiBindLan">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'localHttpApiBindLan')}</span>
            <SettingsHelpTip text={t(lang, 'localHttpApiBindLanHint')} />
          </span>
          <SettingsToggle
            checked={localHttpApiBindLan}
            disabled={!localHttpApiEnabled}
            onChange={() => setLocalHttpApiBindLan((v: any) => !v)}
          />
        </div>
        <div className="settings-row" data-settings-id="localHttpApiServeUi">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'localHttpApiServeUi')}</span>
            <SettingsHelpTip text={t(lang, 'localHttpApiServeUiHint')} />
          </span>
          <span className="settings-row-trailing">
            {localHttpApiServeUi ? (
              <a
                className="settings-inline-link"
                href={gatewayWebUiUrl(localHttpApiPort, localHttpApiToken)}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t(lang, 'localHttpApiOpenUi')}
              </a>
            ) : null}
            <SettingsToggle
              checked={localHttpApiServeUi}
              disabled={!localHttpApiEnabled}
              onChange={() => setLocalHttpApiServeUi((v: any) => !v)}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
