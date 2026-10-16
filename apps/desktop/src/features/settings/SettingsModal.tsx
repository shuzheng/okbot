import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_TOOL_PREFERENCES,
  normalizeContextCompression,
  normalizeMaxTurns,
  normalizeModelSettings,
  normalizeSecuritySettings,
  normalizeSquadSettings,
  normalizeInstructionsSettings,
  normalizeMemorySettings,
  normalizeMaintenanceSettings,
  normalizeMeshSettings,
  normalizeLocalHttpApiSettings,
  normalizeComputers,
  normalizeDefaultComputerId,
  normalizeDefaultAssistantId,
  normalizePinnedOwnerIds,
  normalizeHiddenOwnerIds,
  normalizeOwnerGroups,
  normalizeOwnerGroupMembership,
  normalizeOwnerGroupOrder,
  normalizeMcpSettings,
  normalizeWebSettings,
  normalizeAssistantMarketplaceSettings,
  type McpSettings,
  type WebSettings,
  type ComputerEntry,
  type MemoryEntry,
  type AppSettings,
  type CloseAction,
  normalizeCloseAction,
  type ModelSettings,
  type SecurityBlockMode,
  type DangerousShellPattern,
  type LanguageCode,
  type ThemeMode,
  type UpdaterStatus,
  type Bot,
  type Squad,
} from '@okbot/shared';
import { resolveUiLang, t } from '../../i18n';
import { CompressRatioSlider } from './CompressRatioSlider';
import type { InstructionsSubTab, SettingsTab } from './types';
import { SettingsIcon, ModelNavIcon, SecurityNavIcon, InstructionsNavIcon, MemoryNavIcon, DownloadUpdateIcon, ExtensionsNavIcon } from '../../components/ui/icons';
import { updateScrollFade } from '../../utils/scrollFade';
import { formatSystemError } from '../../utils/formatSystemError';
import { toast } from '../../components/ui';
import { SettingsHelpTip } from './SettingsHelpTip';
import { SettingsToggle } from './SettingsToggle';
import { ModelProvidersPanel } from './ModelProvidersPanel';
import { UsagePanel } from './UsagePanel';
import { ComputersSettingsPanel } from './ComputersSettingsPanel';
import { McpSettingsPanel } from './McpSettingsPanel';
import { UpdatesSettingsPanel } from './UpdatesSettingsPanel';
import { MemorySettingsPanel } from './MemorySettingsPanel';
import { InstructionsSettingsPanel } from './InstructionsSettingsPanel';
import { SecuritySettingsPanel } from './SecuritySettingsPanel';
import { ToolsSettingsPanel } from './ToolsSettingsPanel';
import { GatewaySettingsPanel } from './GatewaySettingsPanel';
import { GeneralSettingsPanel } from './GeneralSettingsPanel';
import { isAdvancedSettingsTab } from './settingsSearch';
import { isGatewayClient } from '../../utils/gatewayClient';
import { omitGatewayDesktopOnlySettings } from '../../utils/settingsPatch';
import { requestConfirm } from '../../components/ui';


import { keptNumber } from './settingsHelpers';

export function SettingsModal({
  settings,
  dataDir,
  hwAccelActive,
  bots = [],
  squads = [],
  initialTab,
  focusSection,
  onClose,
  onSave,
}: {
  settings: AppSettings;
  dataDir: string;
  hwAccelActive: boolean;
  bots?: Bot[];
  squads?: Squad[];
  initialTab?: SettingsTab;
  focusSection?: string | null;
  onClose: () => void;
  onSave: (s: AppSettings) => void | Promise<void>;
}) {
  /* esc-close-modal */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);


  const [tab, setTab] = useState<SettingsTab>(initialTab ?? 'general');
  const [theme, setTheme] = useState<ThemeMode>(settings.theme);
  const [language, setLanguage] = useState<LanguageCode>(settings.language);
  const [microphoneId, setMicrophoneId] = useState(settings.microphoneId);
  const [micOptions, setMicOptions] = useState<{ id: string; label: string }[]>([]);
  const [hardwareAcceleration, setHardwareAcceleration] = useState(
    settings.hardwareAcceleration !== false,
  );
  const [autoUpdate, setAutoUpdate] = useState(settings.autoUpdate !== false);
  const [sidebarDockMagnify, setSidebarDockMagnify] = useState(
    settings.sidebarDockMagnify === true,
  );
  const [developerMode, setDeveloperMode] = useState(settings.developerMode === true);
  const [notifications, setNotifications] = useState(settings.notifications !== false);
  const [closeAction, setCloseAction] = useState<CloseAction>(() => normalizeCloseAction(settings.closeAction));
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(settings.showAdvancedSettings === true);
  // A direct jump to an advanced tab (e.g. from a toast) shows advanced tabs for this
  // dialog only. It does not change the saved preference.
  const [revealAdvanced, setRevealAdvanced] = useState(
    initialTab != null && isAdvancedSettingsTab(initialTab),
  );
  const advancedVisible = showAdvancedSettings || revealAdvanced;
  const [mcpDraft, setMcpDraft] = useState<McpSettings>(() => normalizeMcpSettings(settings.mcp));
  const [webDraft, setWebDraft] = useState<WebSettings>(() => normalizeWebSettings(settings.web));
  const [showWebSearchKey, setShowWebSearchKey] = useState(false);
  const [backupExcludeSecrets, setBackupExcludeSecrets] = useState(true);
  const [backupBusy, setBackupBusy] = useState(false);
  const gatewayClient = isGatewayClient();
  useEffect(() => {
    if (!developerMode && tab === 'instructions') setTab('general');
  }, [developerMode, tab]);
  useEffect(() => {
    if (!advancedVisible && isAdvancedSettingsTab(tab)) setTab('general');
  }, [advancedVisible, tab]);
  // Main may remember closeAction via the close dialog while this modal is open.
  useEffect(() => {
    setCloseAction(normalizeCloseAction(settings.closeAction));
  }, [settings.closeAction]);
  const initialLocalHttpApi = normalizeLocalHttpApiSettings(settings.localHttpApi);
  const [localHttpApiEnabled, setLocalHttpApiEnabled] = useState(initialLocalHttpApi.enabled);
  const [localHttpApiPort, setLocalHttpApiPort] = useState(String(initialLocalHttpApi.port));
  const [localHttpApiToken, setLocalHttpApiToken] = useState(initialLocalHttpApi.token);
  // Bootstrap / settings JSON blanks the token on the wire. Prefer the live value from
  // getGatewayAccessToken (and any already-hydrated settings.localHttpApi.token).
  useEffect(() => {
    const fromSettings = settings.localHttpApi?.token;
    if (typeof fromSettings === 'string' && fromSettings) {
      setLocalHttpApiToken((prev) => (prev === fromSettings ? prev : fromSettings));
    }
    const bridge = window.okbot as { getGatewayAccessToken?: () => Promise<string> };
    if (typeof bridge.getGatewayAccessToken !== 'function') return;
    let cancelled = false;
    void bridge.getGatewayAccessToken().then((token) => {
      if (cancelled || typeof token !== 'string' || !token) return;
      setLocalHttpApiToken((prev) => (prev === token ? prev : token));
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [settings.localHttpApi?.token]);
  const [showLocalHttpApiToken, setShowLocalHttpApiToken] = useState(false);
  const [localHttpApiBindLan, setLocalHttpApiBindLan] = useState(initialLocalHttpApi.bindLan === true);
  const [localHttpApiServeUi, setLocalHttpApiServeUi] = useState(initialLocalHttpApi.serveUi === true);
  const [computersDraft, setComputersDraft] = useState<ComputerEntry[]>(() =>
    normalizeComputers(settings.computers),
  );
  const [defaultComputerId, setDefaultComputerId] = useState(() =>
    normalizeDefaultComputerId(settings.defaultComputerId, normalizeComputers(settings.computers)),
  );
  const [defaultAssistantId, setDefaultAssistantId] = useState(() =>
    normalizeDefaultAssistantId(settings.defaultAssistantId, bots),
  );

  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus | null>(null);
  const [updaterBusy, setUpdaterBusy] = useState(false);
  const [autoApprovalEnabled, setAutoApprovalEnabled] = useState(
    settings.autoApprovalEnabled === true,
  );
  const [autoApprovalRules, setAutoApprovalRules] = useState(
    settings.autoApprovalRules ?? [],
  );
  const [aarAddRequest, setAarAddRequest] = useState(0);
  const [tools, setTools] = useState(
    settings.tools ?? DEFAULT_TOOL_PREFERENCES,
  );
  const initialSecurity = normalizeSecuritySettings(settings.security);
  const [securityEnabled, setSecurityEnabled] = useState(initialSecurity.enabled);
  const [restrictToHome, setRestrictToHome] = useState(initialSecurity.restrictToHome);
  const [allowedPathsText, setAllowedPathsText] = useState(
    initialSecurity.allowedPathPrefixes.join('\n'),
  );
  const [deniedPathsText, setDeniedPathsText] = useState(
    initialSecurity.deniedPathPrefixes.join('\n'),
  );
  const [shellPatternsEnabled, setShellPatternsEnabled] = useState(
    initialSecurity.shellPatternsEnabled,
  );
  /** undefined = use built-in defaults; array (incl. empty) = custom list. */
  const [shellPatterns, setShellPatterns] = useState<DangerousShellPattern[] | undefined>(
    initialSecurity.shellPatterns,
  );
  const [shellPatternAddRequest, setShellPatternAddRequest] = useState(0);
  const [blockMode, setBlockMode] = useState<SecurityBlockMode>(initialSecurity.blockMode);
  const [modelSettings, setModelSettings] = useState<ModelSettings>(() =>
    normalizeModelSettings(settings.model),
  );

  const initialCc = normalizeContextCompression(settings.contextCompression);
  const [compressRatioPct, setCompressRatioPct] = useState(
    String(Math.round(initialCc.ratio * 100)),
  );
  const [keepRecentMax, setKeepRecentMax] = useState(String(initialCc.keepRecentMax));
  const [keepRecentMin, setKeepRecentMin] = useState(String(initialCc.keepRecentMin));
  const [summaryMaxChars, setSummaryMaxChars] = useState(String(initialCc.summaryMaxChars));
  const [autoTopicCompress, setAutoTopicCompress] = useState(initialCc.autoTopicCompress !== false);
  const [maxTurns, setMaxTurns] = useState(String(normalizeMaxTurns(settings.maxTurns)));
  const initialSquad = normalizeSquadSettings(settings.squad);
  const initialInstructions = normalizeInstructionsSettings(settings.instructions);
  const [assistantRoleTemplate, setAssistantRoleTemplate] = useState(
    initialInstructions.assistantRoleTemplate,
  );
  const [agentsMdRefreshSystemPrompt, setAgentsMdRefreshSystemPrompt] = useState(
    initialInstructions.agentsMdRefreshSystemPrompt,
  );
  const [agentsMdRecentMessageLimit, setAgentsMdRecentMessageLimit] = useState(
    String(initialInstructions.agentsMdRecentMessageLimit),
  );
  const [skillsCreateUpdateInstruction, setSkillsCreateUpdateInstruction] = useState(
    initialInstructions.skillsCreateUpdateInstruction,
  );
  const [skillsRecentMessageLimit, setSkillsRecentMessageLimit] = useState(
    String(initialInstructions.skillsRecentMessageLimit),
  );
  const initialMemory = normalizeMemorySettings(settings.memory);
  const [scopeInstruction, setScopeInstruction] = useState(initialMemory.scopeInstruction);
  const [memoryRecentMessageLimit, setMemoryRecentMessageLimit] = useState(
    String(initialMemory.recentMessageLimit),
  );
  const [globalMemories, setGlobalMemories] = useState<MemoryEntry[]>([]);
  const [globalMemAddRequest, setGlobalMemAddRequest] = useState(0);
  const [instructionsSubTab, setInstructionsSubTab] = useState<InstructionsSubTab>('assistant');
  const [captainPersona, setCaptainPersona] = useState(initialSquad.captainPersona);
  const [squadPlaybook, setSquadPlaybook] = useState(initialSquad.playbook);
  const [captainMaxTurns, setCaptainMaxTurns] = useState(String(initialSquad.captainMaxTurns));
  const [memberMaxTurns, setMemberMaxTurns] = useState(String(initialSquad.memberMaxTurns));
  const [_showKey, _setShowKey] = useState(false);
  const skipFirstSave = useRef(true);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<(() => void | Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.okbot.updaterGetStatus().then((s) => {
      if (!cancelled) setUpdaterStatus(s);
    });
    const off = window.okbot.onUpdaterEvent((s) => setUpdaterStatus(s));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // Re-read model providers from disk on open so a stale parent `settings`
  // snapshot cannot overwrite a newer key via autosave.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const latest = await window.okbot.getSettings();
        if (cancelled || !latest) return;
        setModelSettings(normalizeModelSettings(latest.model));
      } catch {
        /* keep props-initialized state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tab !== 'memory') return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await window.okbot.listGlobalMemories();
        if (!cancelled) setGlobalMemories(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setGlobalMemories([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const lang = resolveUiLang(language);
  const title =
    tab === 'general'
      ? t(lang, 'general')
      : tab === 'gateway'
        ? t(lang, 'gateway')
        : tab === 'computers'
          ? t(lang, 'computers')
          : tab === 'extensions'
            ? t(lang, 'extensionsTab')
          : tab === 'tools'
        ? t(lang, 'tools')
        : tab === 'security'
          ? t(lang, 'security')
          : tab === 'model'
            ? t(lang, 'model')
            : tab === 'instructions'
              ? t(lang, 'instructions')
              : tab === 'memory'
                ? t(lang, 'memoryTab')
                : tab === 'usage'
                  ? t(lang, 'usageTab')
                  : tab === 'updates'
                    ? t(lang, 'updatesTab')
                    : t(lang, 'general');
  const needsHwRestart = hardwareAcceleration !== hwAccelActive;

  useEffect(() => {
    if (!initialTab) return;
    if (isAdvancedSettingsTab(initialTab)) setShowAdvancedSettings(true);
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!focusSection) return;
    const id = focusSection;
    if (id === 'assistantRoleTemplate') setInstructionsSubTab('assistant');
    else if (id.startsWith('squad')) setInstructionsSubTab('squad');
    else if (id.startsWith('agentsMd')) setInstructionsSubTab('agents');
    else if (id === 'scopeInstruction' || id === 'memoryRecentMessageLimit')
      setInstructionsSubTab('memory');
    else if (id.startsWith('skills')) setInstructionsSubTab('skills');
    let tries = 0;
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-settings-id="${CSS.escape(id)}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('settings-focus');
        window.setTimeout(() => el.classList.remove('settings-focus'), 1600);
        return;
      }
      tries += 1;
      if (tries < 24) window.setTimeout(tick, 40);
    };
    const t = window.setTimeout(tick, 60);
    return () => window.clearTimeout(t);
  }, [focusSection, tab]);

  useEffect(() => {
    let cancelled = false;
    const loadMics = async () => {
      try {
        if (typeof window.okbot.ensureMicrophoneAccess === 'function') {
          await window.okbot.ensureMicrophoneAccess();
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const inputs = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d, i) => ({
            id: d.deviceId,
            label: d.label || `${t(lang, 'microphone')} ${i + 1}`,
          }));
        setMicOptions(inputs);
      } catch {
        if (!cancelled) setMicOptions([]);
      }
    };
    void loadMics();
    const onChange = () => void loadMics();
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
    };
  }, [lang]);

  useEffect(() => {
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    const persist = async () => {
      const prevRatio = normalizeContextCompression(settings.contextCompression).ratio;
      const pct = keptNumber(compressRatioPct, Math.round(prevRatio * 100));
      const ratio = pct / 100;
      const security = normalizeSecuritySettings({
        enabled: securityEnabled,
        restrictToHome,
        allowedPathPrefixes: allowedPathsText
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
        deniedPathPrefixes: deniedPathsText
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
        shellPatternsEnabled,
        shellPatterns,
        blockMode,
      });
      const payload = {
        theme,
        language,
        microphoneId,
        hardwareAcceleration,
        autoUpdate,
        sidebarDockMagnify,
        developerMode,
        notifications,
        closeAction,
        showAdvancedSettings,
        mcp: normalizeMcpSettings(mcpDraft),
        web: normalizeWebSettings(webDraft),
        assistantMarketplace: normalizeAssistantMarketplaceSettings(settings.assistantMarketplace),
        localHttpApi: (() => {
          const nextApi = normalizeLocalHttpApiSettings({
            enabled: localHttpApiEnabled,
            port: keptNumber(localHttpApiPort, normalizeLocalHttpApiSettings(settings.localHttpApi).port),
            token: localHttpApiToken,
            bindLan: localHttpApiBindLan,
            serveUi: localHttpApiServeUi,
          });
          if (nextApi.token !== localHttpApiToken) {
            setLocalHttpApiToken(nextApi.token);
            if (nextApi.token) toast.info(t(lang, 'localHttpApiTokenSynced'));
          }
          return nextApi;
        })(),
        computers: normalizeComputers(computersDraft),
        defaultComputerId: normalizeDefaultComputerId(defaultComputerId, normalizeComputers(computersDraft)),
        defaultAssistantId: normalizeDefaultAssistantId(defaultAssistantId, bots),
        pinnedOwnerIds: normalizePinnedOwnerIds(settings.pinnedOwnerIds),
        hiddenOwnerIds: normalizeHiddenOwnerIds(settings.hiddenOwnerIds),
        ownerGroups: normalizeOwnerGroups(settings.ownerGroups),
        ownerGroupOrder: normalizeOwnerGroupOrder(
          settings.ownerGroupOrder,
          normalizeOwnerGroups(settings.ownerGroups),
        ),
        ownerGroupMembership: normalizeOwnerGroupMembership(
          settings.ownerGroupMembership,
          normalizeOwnerGroups(settings.ownerGroups),
        ),
        autoApprovalEnabled,
        autoApprovalRules,
        tools,
        mesh: normalizeMeshSettings(settings.mesh),
        security,
        model: normalizeModelSettings(modelSettings),
        contextCompression: normalizeContextCompression({
          ratio,
          keepRecentMax: keptNumber(keepRecentMax, normalizeContextCompression(settings.contextCompression).keepRecentMax),
          keepRecentMin: keptNumber(keepRecentMin, normalizeContextCompression(settings.contextCompression).keepRecentMin),
          summaryMaxChars: keptNumber(summaryMaxChars, normalizeContextCompression(settings.contextCompression).summaryMaxChars),
          autoTopicCompress,
        }),
        // Empty field → default (normalizeMaxTurns treats ''/null as fallback).
        maxTurns: normalizeMaxTurns(keptNumber(maxTurns, normalizeMaxTurns(settings.maxTurns))),
        instructions: normalizeInstructionsSettings({
          assistantRoleTemplate,
          agentsMdRefreshSystemPrompt,
          agentsMdRecentMessageLimit: keptNumber(agentsMdRecentMessageLimit, normalizeInstructionsSettings(settings.instructions).agentsMdRecentMessageLimit),
          skillsCreateUpdateInstruction,
          skillsRecentMessageLimit: keptNumber(skillsRecentMessageLimit, normalizeInstructionsSettings(settings.instructions).skillsRecentMessageLimit),
        }),
        memory: normalizeMemorySettings({
          scopeInstruction,
          recentMessageLimit: keptNumber(memoryRecentMessageLimit, normalizeMemorySettings(settings.memory).recentMessageLimit),
          promptMaxEntries: settings.memory.promptMaxEntries,
          promptMaxChars: settings.memory.promptMaxChars,
        }),
        maintenance: normalizeMaintenanceSettings(settings.maintenance),
        squad: normalizeSquadSettings({
          captainPersona,
          playbook: squadPlaybook,
          captainMaxTurns: keptNumber(captainMaxTurns, normalizeSquadSettings(settings.squad).captainMaxTurns),
          memberMaxTurns: keptNumber(memberMaxTurns, normalizeSquadSettings(settings.squad).memberMaxTurns),
        }),
      };
      // Gateway must not patch closeAction (Electron shell only); omit so a stale
      // value cannot 409 against resolveGatewaySettingsWrite.
      await onSaveRef.current(
        gatewayClient ? (omitGatewayDesktopOnlySettings(payload) as AppSettings) : payload,
      );
    };
    pendingSaveRef.current = persist;
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      pendingSaveRef.current = null;
      persist();
    }, 350);
    return () => {
      // Dep-change cleanup: cancel timer only. Unmount flush is a separate effect.
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [
    theme,
    language,
    microphoneId,
    hardwareAcceleration,
    autoUpdate,
    sidebarDockMagnify,
    developerMode,
    notifications,
    closeAction,
    gatewayClient,
    showAdvancedSettings,
    mcpDraft,
    webDraft,
    localHttpApiEnabled,
    localHttpApiPort,
    localHttpApiToken,
    localHttpApiBindLan,
    localHttpApiServeUi,
    computersDraft,
    defaultComputerId,
    defaultAssistantId,
    bots,
    autoApprovalEnabled,
    autoApprovalRules,
    tools,
    securityEnabled,
    restrictToHome,
    allowedPathsText,
    deniedPathsText,
    shellPatternsEnabled,
    shellPatterns,
    blockMode,
    modelSettings,
    compressRatioPct,
    keepRecentMax,
    keepRecentMin,
    summaryMaxChars,
    autoTopicCompress,
    maxTurns,
    assistantRoleTemplate,
    agentsMdRefreshSystemPrompt,
    agentsMdRecentMessageLimit,
    skillsCreateUpdateInstruction,
    skillsRecentMessageLimit,
    scopeInstruction,
    memoryRecentMessageLimit,
    captainPersona,
    squadPlaybook,
    captainMaxTurns,
    memberMaxTurns,
  ]);

  // Flush ≤350ms debounced edits when the settings modal unmounts (close).
  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pending) pending();
    };
  }, []);

  async function exportBackup() {
    setBackupBusy(true);
    try {
      const res = await window.okbot.backupExport({ excludeSecrets: backupExcludeSecrets });
      if (!res || 'canceled' in res) return;
      if (res.ok) toast.success(t(lang, 'backupExported'));
      else toast.error(t(lang, res.error === 'busy' ? 'backupBusy' : 'backupExportFailed'));
    } catch (err) {
      toast.error(formatSystemError(err));
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreBackup() {
    const ok = await requestConfirm({
      title: t(lang, 'backupRestore'),
      message: t(lang, 'backupRestoreConfirm'),
      confirmLabel: t(lang, 'backupRestoreAction'),
      danger: true,
    });
    if (!ok) return;
    setBackupBusy(true);
    try {
      const res = await window.okbot.backupRestore();
      if (res && !('canceled' in res) && !res.ok) {
        toast.error(t(lang, res.error === 'busy' ? 'backupBusy' : 'backupRestoreFailed'));
      }
    } catch (err) {
      toast.error(formatSystemError(err));
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <>
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-shell" onClick={(e) => e.stopPropagation()}>
        <nav className="settings-nav" aria-label={t(lang, 'settings')}>
          <button
            type="button"
            className={`settings-nav-item${tab === 'general' ? ' active' : ''}`}
            onClick={() => setTab('general')}
          >
            <span className="ico" aria-hidden>
              <SettingsIcon />
            </span>
            {t(lang, 'general')}
          </button>
          <button
            type="button"
            className={`settings-nav-item${tab === 'model' ? ' active' : ''}`}
            onClick={() => setTab('model')}
          >
            <span className="ico" aria-hidden>
              <ModelNavIcon />
            </span>
            {t(lang, 'model')}
          </button>
          <button
            type="button"
            className={`settings-nav-item${tab === 'tools' ? ' active' : ''}`}
            onClick={() => setTab('tools')}
          >
            <span className="ico" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
              </svg>
            </span>
            {t(lang, 'tools')}
          </button>
          {advancedVisible ? (
            <>
            <button
              type="button"
              className={`settings-nav-item${tab === 'security' ? ' active' : ''}`}
              onClick={() => setTab('security')}
            >
              <span className="ico" aria-hidden>
                <SecurityNavIcon />
              </span>
              {t(lang, 'security')}
            </button>
            <button
              type="button"
              className={`settings-nav-item${tab === 'gateway' ? ' active' : ''}`}
              onClick={() => setTab('gateway')}
            >
              <span className="ico" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 8h16M4 16h16M8 4v4M16 16v4" strokeLinecap="round" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
              </span>
              {t(lang, 'gateway')}
            </button>
            <button
              type="button"
              className={`settings-nav-item${tab === 'computers' ? ' active' : ''}`}
              onClick={() => setTab('computers')}
            >
              <span className="ico" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="4" width="18" height="12" rx="2" />
                  <path d="M8 20h8M12 16v4" strokeLinecap="round" />
                </svg>
              </span>
              {t(lang, 'computers')}
            </button>
            <button
              type="button"
              className={`settings-nav-item${tab === 'extensions' ? ' active' : ''}`}
              onClick={() => setTab('extensions')}
            >
              <span className="ico" aria-hidden>
                <ExtensionsNavIcon />
              </span>
              {t(lang, 'extensionsTab')}
            </button>
            </>
          ) : null}
          <button
            type="button"
            className={`settings-nav-item${tab === 'memory' ? ' active' : ''}`}
            onClick={() => setTab('memory')}
          >
            <span className="ico" aria-hidden>
              <MemoryNavIcon />
            </span>
            {t(lang, 'memoryTab')}
          </button>
          <button
            type="button"
            className={`settings-nav-item${tab === 'usage' ? ' active' : ''}`}
            onClick={() => setTab('usage')}
          >
            <span className="ico" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 19V5M4 19h16" strokeLinecap="round" />
                <path d="M8 15v-4M12 15V8M16 15v-7" strokeLinecap="round" />
              </svg>
            </span>
            {t(lang, 'usageTab')}
          </button>
          <button
            type="button"
            className={`settings-nav-item${tab === 'updates' ? ' active' : ''}`}
            onClick={() => setTab('updates')}
          >
            <span className="ico" aria-hidden>
              <DownloadUpdateIcon />
            </span>
            {t(lang, 'updatesTab')}
          </button>
          {developerMode ? (
            <button
              type="button"
              className={`settings-nav-item${tab === 'instructions' ? ' active' : ''}`}
              onClick={() => setTab('instructions')}
            >
              <span className="ico" aria-hidden>
                <InstructionsNavIcon />
              </span>
              {t(lang, 'instructions')}
            </button>
          ) : null}
        </nav>
        <div className="settings-main">
          <div className="settings-main-head">
            <h2>{title}</h2>
            <button type="button" className="settings-close" onClick={onClose} aria-label={t(lang, 'close')}>
              ×
            </button>
          </div>
          <div
            className="settings-body scroll-fade"
            onScroll={(e) => updateScrollFade(e.currentTarget)}
            ref={(el) => {
              if (el) {
                updateScrollFade(el);
                requestAnimationFrame(() => updateScrollFade(el));
              }
            }}
          >
            {tab === 'general' ? (
              <GeneralSettingsPanel
                gatewayClient={gatewayClient}
                needsHwRestart={needsHwRestart}
                dataDir={dataDir}
                exportBackup={exportBackup}
                restoreBackup={restoreBackup}
                lang={lang}
                backupBusy={backupBusy}
                backupExcludeSecrets={backupExcludeSecrets}
                closeAction={closeAction}
                developerMode={developerMode}
                hardwareAcceleration={hardwareAcceleration}
                language={language}
                micOptions={micOptions}
                microphoneId={microphoneId}
                notifications={notifications}
                setBackupExcludeSecrets={setBackupExcludeSecrets}
                setCloseAction={setCloseAction}
                setDeveloperMode={setDeveloperMode}
                setHardwareAcceleration={setHardwareAcceleration}
                setLanguage={setLanguage}
                setMicrophoneId={setMicrophoneId}
                setNotifications={setNotifications}
                setRevealAdvanced={setRevealAdvanced}
                setShowAdvancedSettings={setShowAdvancedSettings}
                setSidebarDockMagnify={setSidebarDockMagnify}
                setTheme={setTheme}
                showAdvancedSettings={showAdvancedSettings}
                sidebarDockMagnify={sidebarDockMagnify}
                theme={theme}
                bots={bots}
                defaultAssistantId={defaultAssistantId}
                setDefaultAssistantId={setDefaultAssistantId}
              />
            ) : tab === 'gateway' ? (
              <GatewaySettingsPanel
                saveTimerRef={saveTimerRef}
                pendingSaveRef={pendingSaveRef}
                lang={lang}
                localHttpApiBindLan={localHttpApiBindLan}
                localHttpApiEnabled={localHttpApiEnabled}
                localHttpApiPort={localHttpApiPort}
                localHttpApiServeUi={localHttpApiServeUi}
                localHttpApiToken={localHttpApiToken}
                setLocalHttpApiBindLan={setLocalHttpApiBindLan}
                setLocalHttpApiEnabled={setLocalHttpApiEnabled}
                setLocalHttpApiPort={setLocalHttpApiPort}
                setLocalHttpApiServeUi={setLocalHttpApiServeUi}
                setLocalHttpApiToken={setLocalHttpApiToken}
                setShowLocalHttpApiToken={setShowLocalHttpApiToken}
                showLocalHttpApiToken={showLocalHttpApiToken}
              />
            ) : tab === 'computers' ? (
              <ComputersSettingsPanel
                lang={lang}
                computers={computersDraft}
                defaultComputerId={defaultComputerId}
                onChange={setComputersDraft}
                onDefaultComputerIdChange={setDefaultComputerId}
              />
            ) : tab === 'extensions' ? (
              <McpSettingsPanel
                lang={lang}
                value={mcpDraft}
                onChange={setMcpDraft}
                readOnly={gatewayClient}
              />
            ) : tab === 'tools' ? (
              <ToolsSettingsPanel
                gatewayClient={gatewayClient}
                lang={lang}
                aarAddRequest={aarAddRequest}
                autoApprovalEnabled={autoApprovalEnabled}
                autoApprovalRules={autoApprovalRules}
                setAarAddRequest={setAarAddRequest}
                setAutoApprovalEnabled={setAutoApprovalEnabled}
                setAutoApprovalRules={setAutoApprovalRules}
                setShowWebSearchKey={setShowWebSearchKey}
                setTools={setTools}
                setWebDraft={setWebDraft}
                showWebSearchKey={showWebSearchKey}
                tools={tools}
                webDraft={webDraft}
              />
            ) : tab === 'security' ? (
              <SecuritySettingsPanel
                lang={lang}
                allowedPathsText={allowedPathsText}
                blockMode={blockMode}
                deniedPathsText={deniedPathsText}
                restrictToHome={restrictToHome}
                securityEnabled={securityEnabled}
                setAllowedPathsText={setAllowedPathsText}
                setBlockMode={setBlockMode}
                setDeniedPathsText={setDeniedPathsText}
                setRestrictToHome={setRestrictToHome}
                setSecurityEnabled={setSecurityEnabled}
                setShellPatternAddRequest={setShellPatternAddRequest}
                setShellPatterns={setShellPatterns}
                setShellPatternsEnabled={setShellPatternsEnabled}
                shellPatternAddRequest={shellPatternAddRequest}
                shellPatterns={shellPatterns}
                shellPatternsEnabled={shellPatternsEnabled}
              />
            ) : tab === 'model' ? (
              <div>
                <ModelProvidersPanel
                  lang={lang}
                  value={modelSettings}
                  onChange={setModelSettings}
                />

                {advancedVisible ? (<>
                <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="contextCompression">
                  <span>{t(lang, 'contextCompression')}</span>
                </div>
                <div className="settings-card settings-card-model">
                  <div className="settings-row" data-settings-id="compressRatio">
                    <span className="settings-row-label">
                      <span className="settings-row-label-text">{t(lang, 'compressRatio')}</span>
                    </span>
                    <CompressRatioSlider
                      value={Number(compressRatioPct)}
                      onChange={(pct) => setCompressRatioPct(String(pct))}
                    />
                  </div>
                  <div className="settings-row" data-settings-id="autoTopicCompress">
                    <span className="settings-row-label">
                      <span className="settings-row-label-text">{t(lang, 'autoTopicCompress')}</span>
                      <SettingsHelpTip text={t(lang, 'autoTopicCompressHint')} />
                    </span>
                    <SettingsToggle
                      checked={autoTopicCompress}
                      onChange={() => setAutoTopicCompress((v) => !v)}
                    />
                  </div>
                  <div className="settings-row" data-settings-id="compressKeepRecentMax">
                    <span className="settings-row-label">
                      <span className="settings-row-label-text">{t(lang, 'compressKeepRecentMax')}</span>
                    </span>
                    <input
                      spellCheck={false}
                      className="wide"
                      type="number"
                      min={1}
                      max={500}
                      step={1}
                      value={keepRecentMax}
                      onChange={(e) => setKeepRecentMax(e.target.value)}
                      onBlur={() => {
                        const cc = normalizeContextCompression({
                          ratio: Number(compressRatioPct) / 100,
                          keepRecentMax: keptNumber(keepRecentMax, normalizeContextCompression(settings.contextCompression).keepRecentMax),
                          keepRecentMin: keptNumber(keepRecentMin, normalizeContextCompression(settings.contextCompression).keepRecentMin),
                          summaryMaxChars: keptNumber(summaryMaxChars, normalizeContextCompression(settings.contextCompression).summaryMaxChars),
                        });
                        setKeepRecentMax(String(cc.keepRecentMax));
                        setKeepRecentMin(String(cc.keepRecentMin));
                      }}
                    />
                  </div>
                  <div className="settings-row" data-settings-id="compressKeepRecentMin">
                    <span className="settings-row-label">
                      <span className="settings-row-label-text">{t(lang, 'compressKeepRecentMin')}</span>
                    </span>
                    <input
                      spellCheck={false}
                      className="wide"
                      type="number"
                      min={1}
                      max={500}
                      step={1}
                      value={keepRecentMin}
                      onChange={(e) => setKeepRecentMin(e.target.value)}
                      onBlur={() => {
                        const cc = normalizeContextCompression({
                          ratio: Number(compressRatioPct) / 100,
                          keepRecentMax: keptNumber(keepRecentMax, normalizeContextCompression(settings.contextCompression).keepRecentMax),
                          keepRecentMin: keptNumber(keepRecentMin, normalizeContextCompression(settings.contextCompression).keepRecentMin),
                          summaryMaxChars: keptNumber(summaryMaxChars, normalizeContextCompression(settings.contextCompression).summaryMaxChars),
                        });
                        setKeepRecentMax(String(cc.keepRecentMax));
                        setKeepRecentMin(String(cc.keepRecentMin));
                      }}
                    />
                  </div>
                  <div className="settings-row" data-settings-id="compressSummaryMaxChars">
                    <span className="settings-row-label">
                      <span className="settings-row-label-text">{t(lang, 'compressSummaryMaxChars')}</span>
                    </span>
                    <input
                      spellCheck={false}
                      className="wide"
                      type="number"
                      min={100}
                      max={8000}
                      step={50}
                      value={summaryMaxChars}
                      onChange={(e) => setSummaryMaxChars(e.target.value)}
                      onBlur={() => {
                        const cc = normalizeContextCompression({
                          ratio: Number(compressRatioPct) / 100,
                          keepRecentMax: keptNumber(keepRecentMax, normalizeContextCompression(settings.contextCompression).keepRecentMax),
                          keepRecentMin: keptNumber(keepRecentMin, normalizeContextCompression(settings.contextCompression).keepRecentMin),
                          summaryMaxChars: keptNumber(summaryMaxChars, normalizeContextCompression(settings.contextCompression).summaryMaxChars),
                        });
                        setSummaryMaxChars(String(cc.summaryMaxChars));
                      }}
                    />
                  </div>
                </div>

                <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="maxTurns">
                  <span>{t(lang, 'chatMaxTurns')}</span>
                </div>
                <div className="settings-card settings-card-model">
                  <div className="settings-row" data-settings-id="maxTurns">
                    <span className="settings-row-label">
                      <span className="settings-row-label-text">{t(lang, 'chatMaxTurns')}</span>
                      <SettingsHelpTip text={t(lang, 'chatMaxTurnsHint')} />
                    </span>
                    <input
                      spellCheck={false}
                      className="wide"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={maxTurns}
                      onChange={(e) => setMaxTurns(e.target.value)}
                      onBlur={() => {
                        setMaxTurns(String(normalizeMaxTurns(keptNumber(maxTurns, normalizeMaxTurns(settings.maxTurns)))));
                      }}
                    />
                  </div>
                </div>
                </>) : null}
              </div>

            ) : tab === 'instructions' ? (
              <InstructionsSettingsPanel
                settings={settings}
                lang={lang}
                agentsMdRecentMessageLimit={agentsMdRecentMessageLimit}
                agentsMdRefreshSystemPrompt={agentsMdRefreshSystemPrompt}
                assistantRoleTemplate={assistantRoleTemplate}
                captainMaxTurns={captainMaxTurns}
                captainPersona={captainPersona}
                instructionsSubTab={instructionsSubTab}
                memberMaxTurns={memberMaxTurns}
                memoryRecentMessageLimit={memoryRecentMessageLimit}
                scopeInstruction={scopeInstruction}
                setAgentsMdRecentMessageLimit={setAgentsMdRecentMessageLimit}
                setAgentsMdRefreshSystemPrompt={setAgentsMdRefreshSystemPrompt}
                setAssistantRoleTemplate={setAssistantRoleTemplate}
                setCaptainMaxTurns={setCaptainMaxTurns}
                setCaptainPersona={setCaptainPersona}
                setInstructionsSubTab={setInstructionsSubTab}
                setMemberMaxTurns={setMemberMaxTurns}
                setMemoryRecentMessageLimit={setMemoryRecentMessageLimit}
                setScopeInstruction={setScopeInstruction}
                setSkillsCreateUpdateInstruction={setSkillsCreateUpdateInstruction}
                setSkillsRecentMessageLimit={setSkillsRecentMessageLimit}
                setSquadPlaybook={setSquadPlaybook}
                skillsCreateUpdateInstruction={skillsCreateUpdateInstruction}
                skillsRecentMessageLimit={skillsRecentMessageLimit}
                squadPlaybook={squadPlaybook}
                tab={tab}
              />
            ) : tab === 'memory' ? (
              <MemorySettingsPanel
                lang={lang}
                globalMemories={globalMemories}
                setGlobalMemories={setGlobalMemories}
                globalMemAddRequest={globalMemAddRequest}
                setGlobalMemAddRequest={setGlobalMemAddRequest}
              />
            ) : tab === 'usage' ? (
              <UsagePanel lang={lang} bots={bots} squads={squads} />
            ) : tab === 'updates' ? (
              <UpdatesSettingsPanel
                lang={lang}
                autoUpdate={autoUpdate}
                setAutoUpdate={setAutoUpdate}
                updaterStatus={updaterStatus}
                setUpdaterStatus={setUpdaterStatus}
                updaterBusy={updaterBusy}
                setUpdaterBusy={setUpdaterBusy}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
