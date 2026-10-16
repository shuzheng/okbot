import {
  TOOL_IDS,
  WEB_SEARCH_COMPAT_IDS,
  WEB_SEARCH_PROVIDER_IDS,
  type WebSearchCompatId,
  type WebSearchProviderId,
} from '@okbot/shared';

import { AutoApprovalRulesList } from './AutoApprovalRulesList';
import { SettingsHelpTip } from './SettingsHelpTip';
import { SettingsToggle } from './SettingsToggle';
import { EyeIcon, EyeOffIcon } from '../../components/ui/icons';
import { t, type UiLang } from '../../i18n';

export function ToolsSettingsPanel({
  lang,
  aarAddRequest,
  autoApprovalEnabled,
  autoApprovalRules,
  setAarAddRequest,
  setAutoApprovalEnabled,
  setAutoApprovalRules,
  setShowWebSearchKey,
  setTools,
  setWebDraft,
  showWebSearchKey,
  tools,
  webDraft,
  gatewayClient,
}: {
  gatewayClient: boolean;
  lang: UiLang;
  aarAddRequest: any;
  autoApprovalEnabled: any;
  autoApprovalRules: any;
  setAarAddRequest: React.Dispatch<React.SetStateAction<any>>;
  setAutoApprovalEnabled: React.Dispatch<React.SetStateAction<any>>;
  setAutoApprovalRules: React.Dispatch<React.SetStateAction<any>>;
  setShowWebSearchKey: React.Dispatch<React.SetStateAction<any>>;
  setTools: React.Dispatch<React.SetStateAction<any>>;
  setWebDraft: React.Dispatch<React.SetStateAction<any>>;
  showWebSearchKey: any;
  tools: any;
  webDraft: any;
}) {
  const isCustomSearch = webDraft.search.provider === 'custom';

  return (

    <div>
      <div className="settings-section-label" data-settings-id="toolManagement">{t(lang, 'toolManagement')}</div>
      <div className="settings-card tool-mgmt-card">
        {TOOL_IDS.map((id) => {
          const pref = tools[id];
          const labelKey =
            (
              {
                run_shell: 'toolRunShell',
                read_file: 'toolReadFile',
                read_skill: 'toolReadSkill',
                write_file: 'toolWriteFile',
                edit_file: 'toolEditFile',
                generate_image: 'toolGenerateImage',
                search_history: 'toolSearchHistory',
                manage_schedule: 'toolManageSchedule',
                manage_task_progress: 'toolManageTaskProgress',
                send_message: 'toolSendMessage',
                web_fetch: 'toolWebFetch',
                web_search: 'toolWebSearch',
              } as const
            )[id];
          return (
            <div
              key={id}
              className="tool-mgmt-row settings-row"
              data-settings-id={labelKey}
            >
              <span className="settings-row-label">{t(lang, labelKey)}</span>
              <div className="tool-mgmt-controls">
                <select
                  className="tool-mgmt-approval-select"
                  aria-label={t(lang, 'toolApproval')}
                  aria-hidden={!pref.enabled}
                  tabIndex={pref.enabled ? 0 : -1}
                  disabled={!pref.enabled}
                  value={pref.approval}
                  onChange={(e) => {
                    const approval = e.target.value === 'allow' ? 'allow' : 'ask';
                    setTools((prev: any) => ({
                      ...prev,
                      [id]: { ...prev[id], approval },
                    }));
                  }}
                  style={pref.enabled ? undefined : { visibility: 'hidden' }}
                >
                  <option value="ask">{t(lang, 'autoApprovalAsk')}</option>
                  <option value="allow">{t(lang, 'autoApprovalAllow')}</option>
                </select>
                  <SettingsToggle checked={pref.enabled} onChange={() =>
                    setTools((prev: any) => ({
                      ...prev,
                      [id]: { ...prev[id], enabled: !prev[id].enabled },
                    }))} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="webTools">
        {t(lang, 'webTools')}
      </div>
      <div className="settings-card" aria-disabled={gatewayClient ? 'true' : undefined}>
        <div className="settings-hint" data-settings-id="webSearchHint" style={{ marginBottom: 8 }}>
          {t(lang, 'webSearchHint')}
        </div>
        <div className="settings-row" data-settings-id="webSearchProvider">
          <span className="settings-row-label">{t(lang, 'webSearchProvider')}</span>
          <select
            className="wide"
            disabled={gatewayClient}
            value={webDraft.search.provider}
            onChange={(e) => {
              const provider = e.target.value as WebSearchProviderId;
              if (!(WEB_SEARCH_PROVIDER_IDS as readonly string[]).includes(provider)) return;
              setWebDraft((prev: any) => ({
                ...prev,
                search: { ...prev.search, provider },
              }));
            }}
          >
            <option value="tavily">Tavily</option>
            <option value="brave">Brave</option>
            <option value="serper">Serper</option>
            <option value="custom">{t(lang, 'webSearchProviderCustom')}</option>
          </select>
        </div>
        <div className="settings-row" data-settings-id="webSearchApiKey">
          <span className="settings-row-label">{t(lang, 'webSearchApiKey')}</span>
          <div className="settings-secret">
            <input
              spellCheck={false}
              className="wide"
              type={showWebSearchKey ? 'text' : 'password'}
              placeholder={t(lang, 'webSearchApiKeyPlaceholder')}
              value={webDraft.search.apiKey}
              disabled={gatewayClient}
              autoComplete="off"
              onChange={(e) =>
                setWebDraft((prev: any) => ({
                  ...prev,
                  search: { ...prev.search, apiKey: e.target.value },
                }))
              }
            />
            <button
              type="button"
              className="settings-eye"
              disabled={gatewayClient}
              aria-label={showWebSearchKey ? 'Hide' : 'Show'}
              onClick={() => setShowWebSearchKey((v: any) => !v)}
            >
              {showWebSearchKey ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>
        {isCustomSearch ? (
          <>
            <div className="settings-row" data-settings-id="webSearchCompat">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'webSearchCompat')}</span>
                <SettingsHelpTip text={t(lang, 'webSearchCompatHint')} />
              </span>
              <select
                className="wide"
                disabled={gatewayClient}
                value={webDraft.search.compat}
                onChange={(e) => {
                  const compat = e.target.value as WebSearchCompatId;
                  if (!(WEB_SEARCH_COMPAT_IDS as readonly string[]).includes(compat)) return;
                  setWebDraft((prev: any) => ({
                    ...prev,
                    search: { ...prev.search, compat },
                  }));
                }}
              >
                <option value="tavily">Tavily</option>
                <option value="brave">Brave</option>
                <option value="serper">Serper</option>
              </select>
            </div>
            <div className="settings-row" data-settings-id="webSearchBaseURL">
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'webSearchBaseURL')}</span>
                <SettingsHelpTip text={t(lang, 'webSearchBaseURLHint')} />
              </span>
              <input
                spellCheck={false}
                className="wide"
                type="text"
                placeholder={t(lang, 'webSearchBaseURLPlaceholder')}
                value={webDraft.search.baseURL}
                disabled={gatewayClient}
                onChange={(e) =>
                  setWebDraft((prev: any) => ({
                    ...prev,
                    search: { ...prev.search, baseURL: e.target.value },
                  }))
                }
              />
            </div>
          </>
        ) : null}
        <div className="settings-row" data-settings-id="webFetchAllowPrivate">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'webFetchAllowPrivate')}</span>
            <SettingsHelpTip text={t(lang, 'webFetchAllowPrivateHint')} />
          </span>
          <SettingsToggle
            checked={webDraft.fetch.allowPrivateNetwork}
            disabled={gatewayClient}
            onChange={() =>
              setWebDraft((prev: any) => ({
                ...prev,
                fetch: {
                  ...prev.fetch,
                  allowPrivateNetwork: !prev.fetch.allowPrivateNetwork,
                },
              }))
            }
          />
        </div>
      </div>

      <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="autoApproval">
        {t(lang, 'autoApproval')}
      </div>
      <div className="settings-card" aria-disabled={gatewayClient ? 'true' : undefined}>
        <div className="settings-row">
          <span className="settings-row-label">{t(lang, 'autoApproval')}</span>
          <div className="settings-row-trailing">
            <button
              type="button"
              className="settings-aar-add-btn"
              disabled={!autoApprovalEnabled || gatewayClient}
              onClick={() => setAarAddRequest((n: any) => n + 1)}
            >
              {t(lang, 'autoApprovalAdd')}
            </button>
            <SettingsToggle
              checked={autoApprovalEnabled}
              disabled={gatewayClient}
              onChange={() => setAutoApprovalEnabled((v: any) => !v)}
            />
          </div>
        </div>
        {autoApprovalEnabled || gatewayClient ? (
          <AutoApprovalRulesList
            lang={lang}
            rules={autoApprovalRules}
            onChange={setAutoApprovalRules}
            requestAdd={aarAddRequest}
            readOnly={gatewayClient}
          />
        ) : null}
      </div>



    </div>
  );
}
