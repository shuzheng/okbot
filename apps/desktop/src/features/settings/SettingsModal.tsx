import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  DEFAULT_TOOL_PREFERENCES,
  normalizeContextCompression,
  normalizeModelSettings,
  normalizeSecuritySettings,
  normalizeSquadSettings,
  normalizeInstructionsSettings,
  normalizeMemorySettings,
  normalizeMaintenanceSettings,
  normalizeMeshSettings,
  normalizeGatewayHttpApiSettings,
  normalizeComputers,
  normalizeDefaultComputerId,
  normalizeDefaultAssistantId,
  normalizeTimezone,
  normalizePinnedOwnerIds,
  normalizeHiddenOwnerIds,
  normalizeOwnerGroups,
  normalizeOwnerGroupMembership,
  normalizeOwnerGroupOrder,
  normalizeMcpSettings,
  normalizeWebSettings,
  normalizeAssistantMarketplaceSettings,
  normalizeSettingsNavTab,
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
  type GatewayAuthRole,
  type GatewayApiTokenEntry,
} from '@okbot/shared';
import { resolveUiLang, t } from '../../i18n';
import { CompressRatioSlider } from './CompressRatioSlider';
import type { InstructionsSubTab, SettingsTab } from './types';
import { SettingsIcon, ModelNavIcon, SecurityNavIcon, InstructionsNavIcon, MemoryNavIcon, DownloadUpdateIcon, ExtensionsNavIcon, ChevronDownIcon, GatewayIcon, MenuIcon } from '../../components/ui/icons';
import { updateScrollFade } from '../../utils/scrollFade';
import { formatSystemError } from '../../utils/formatSystemError';
import { toast } from '../../components/ui';
import { QuickTip } from '../../components/ui/QuickTip';
import { SettingsHelpTip } from './SettingsHelpTip';
import { SettingsToggle } from './SettingsToggle';
import { ModelProvidersPanel } from './ModelProvidersPanel';
import { UsagePanel } from './UsagePanel';
import { McpSettingsPanel } from './McpSettingsPanel';
import { UpdatesSettingsPanel } from './UpdatesSettingsPanel';
import { MemorySettingsPanel } from './MemorySettingsPanel';
import { InstructionsSettingsPanel } from './InstructionsSettingsPanel';
import { SecuritySettingsPanel } from './SecuritySettingsPanel';
import { ToolsSettingsPanel } from './ToolsSettingsPanel';
import { GatewaySettingsPanel } from './GatewaySettingsPanel';
import { ClientGatewaysPanel } from './ClientGatewaysPanel';
import { GeneralSettingsPanel } from './GeneralSettingsPanel';
import { SETTINGS_TAB_LABEL_KEYS } from './settingsSearch';
import {
  isGatewayClient,
  isGatewaySideSettingsTab,
  isLocalHostElectronAttach,
  isPureWebUi,
  readAttachPresentedToken,
  resolveClientGatewayAuthRole,
  shouldHideGatewaySideSettings,
} from '../../utils/gatewayClient';
import { applyTheme } from '../../utils/theme';
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
  const [navMenuOpen, setNavMenuOpen] = useState(false);

  /* esc: close settings nav drawer first, then modal */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (navMenuOpen) {
        setNavMenuOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, navMenuOpen]);

  /* Drop hamburger drawer when leaving the ≤640px settings breakpoint. */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = () => {
      if (!mq.matches) setNavMenuOpen(false);
    };
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /* Icon-rail (≤768): labels clipped — use QuickTip. Skip when hamburger drawer shows labels. */
  const [railNarrow, setRailNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = () => setRailNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);


  const CLIENT_NAV_TABS: SettingsTab[] = ['general', 'gateways', 'updates'];
  const isClientNavTab = (id: SettingsTab) => CLIENT_NAV_TABS.includes(id);
  const resolveStartTab = (): SettingsTab => {
    if (initialTab) return normalizeSettingsNavTab(initialTab) as SettingsTab;
    return normalizeSettingsNavTab(settings.settingsNavTab) as SettingsTab;
  };
  const [tab, setTab] = useState<SettingsTab>(resolveStartTab);
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
  const [translucent, setTranslucent] = useState(settings.translucent !== false);
  useEffect(() => {
    setTranslucent(settings.translucent !== false);
  }, [settings.translucent]);
  const [developerMode, setDeveloperMode] = useState(settings.developerMode === true);
  const [notifications, setNotifications] = useState(settings.notifications !== false);
  const [closeAction, setCloseAction] = useState<CloseAction>(() => normalizeCloseAction(settings.closeAction));
  const [clientNavExpanded, setClientNavExpanded] = useState(
    () => settings.settingsClientGroupExpanded !== false,
  );
  const [gatewayNavExpanded, setGatewayNavExpanded] = useState(
    () => settings.settingsGatewayGroupExpanded === true,
  );

  useEffect(() => {
    // Keep the group that owns the active tab open when selection changes.
    if (isClientNavTab(tab)) setClientNavExpanded(true);
    else setGatewayNavExpanded(true);
  }, [tab]);

  const [mcpDraft, setMcpDraft] = useState<McpSettings>(() => normalizeMcpSettings(settings.mcp));
  const [webDraft, setWebDraft] = useState<WebSettings>(() => normalizeWebSettings(settings.web));
  const [showWebSearchKey, setShowWebSearchKey] = useState(false);
  const [backupExcludeSecrets, setBackupExcludeSecrets] = useState(true);
  const [backupBusy, setBackupBusy] = useState(false);
  const gatewayClient = isGatewayClient();
  // Pure browser WebUI has no desktop updater; Electron attach still shows 自动更新.
  const pureWebUi = isPureWebUi();
  // Remote client with user/access token: hide 网关端. Pending until admin is proven.
  // Local-host Electron attach always keeps 网关端 (see shouldHideGatewaySideSettings).
  const [clientGatewayRole, setClientGatewayRole] = useState<GatewayAuthRole | 'pending' | null>(
    () => (isGatewayClient() ? 'pending' : null),
  );
  useEffect(() => {
    if (pureWebUi && tab === 'updates') setTab('general');
  }, [pureWebUi, tab]);
  useEffect(() => {
    if (!developerMode && tab === 'instructions') setTab('general');
  }, [developerMode, tab]);
  // Main may remember closeAction via the close dialog while this modal is open.
  useEffect(() => {
    setCloseAction(normalizeCloseAction(settings.closeAction));
  }, [settings.closeAction]);
  const initialGatewayHttpApi = normalizeGatewayHttpApiSettings(settings.gatewayHttpApi);
  const [gatewayHttpApiPort, setGatewayHttpApiPort] = useState(String(initialGatewayHttpApi.port));
  const [gatewayHttpApiToken, setGatewayHttpApiToken] = useState(initialGatewayHttpApi.token);
  const [gatewayHttpApiAdminToken, setGatewayHttpApiAdminToken] = useState(initialGatewayHttpApi.adminToken || '');
  const [gatewayApiTokens, setGatewayApiTokens] = useState<GatewayApiTokenEntry[]>(
    () => initialGatewayHttpApi.apiTokens || [],
  );

  const applyGatewayApiTokens = (next: GatewayApiTokenEntry[]) => {
    const normalized = normalizeGatewayHttpApiSettings({
      ...normalizeGatewayHttpApiSettings(settings.gatewayHttpApi),
      apiTokens: next,
      token: '',
      adminToken: '',
    });
    setGatewayApiTokens(normalized.apiTokens);
    setGatewayHttpApiToken(normalized.token);
    setGatewayHttpApiAdminToken(normalized.adminToken);
  };

  // Bootstrap / settings JSON blanks tokens on the wire. Prefer live values from
  // getGatewayAccessToken / getGatewayAdminToken (and hydrated settings fields).
  useEffect(() => {
    const fromList = settings.gatewayHttpApi?.apiTokens;
    if (Array.isArray(fromList) && fromList.length > 0 && fromList.some((e) => e.token)) {
      applyGatewayApiTokens(fromList);
    } else {
      const fromSettings = settings.gatewayHttpApi?.token;
      if (typeof fromSettings === 'string' && fromSettings) {
        setGatewayHttpApiToken((prev) => (prev === fromSettings ? prev : fromSettings));
      }
      const fromAdmin = settings.gatewayHttpApi?.adminToken;
      if (typeof fromAdmin === 'string' && fromAdmin) {
        setGatewayHttpApiAdminToken((prev) => (prev === fromAdmin ? prev : fromAdmin));
      }
    }
    const bridge = window.okbot as {
      getGatewayAccessToken?: () => Promise<string>;
      getGatewayAdminToken?: () => Promise<string>;
      getGatewayApiTokens?: () => Promise<GatewayApiTokenEntry[]>;
    };
    let cancelled = false;
    if (typeof bridge.getGatewayApiTokens === 'function') {
      void bridge.getGatewayApiTokens().then((list) => {
        if (cancelled || !Array.isArray(list) || list.length === 0) return;
        if (!list.some((e) => e && e.token)) return;
        applyGatewayApiTokens(list);
      }).catch(() => {});
    }
    if (typeof bridge.getGatewayAccessToken === 'function') {
      void bridge.getGatewayAccessToken().then((token) => {
        if (cancelled || typeof token !== 'string' || !token) return;
        setGatewayHttpApiToken((prev) => (prev === token ? prev : token));
        setGatewayApiTokens((list) => {
          if (list.some((e) => e.token === token)) return list;
          // Hydrate primary access secret into first access entry when wire was blank.
          const idx = list.findIndex((e) => e.role === 'access');
          if (idx < 0) return list;
          const next = [...list];
          next[idx] = { ...next[idx]!, token };
          return next;
        });
      }).catch(() => {});
    }
    if (typeof bridge.getGatewayAdminToken === 'function') {
      void bridge.getGatewayAdminToken().then((token) => {
        if (cancelled || typeof token !== 'string' || !token) return;
        setGatewayHttpApiAdminToken((prev) => (prev === token ? prev : token));
        setGatewayApiTokens((list) => {
          if (list.some((e) => e.token === token)) return list;
          const idx = list.findIndex((e) => e.role === 'admin');
          if (idx < 0) return list;
          const next = [...list];
          next[idx] = { ...next[idx]!, token };
          return next;
        });
      }).catch(() => {});
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate from settings snapshot
  }, [settings.gatewayHttpApi?.token, settings.gatewayHttpApi?.adminToken, settings.gatewayHttpApi?.apiTokens]);

  useEffect(() => {
    if (!gatewayClient) {
      setClientGatewayRole(null);
      return;
    }
    let cancelled = false;
    (async () => {
      let serverRole: GatewayAuthRole | null = null;
      try {
        const bridge = window.okbot as {
          getGatewayAuthRole?: () => Promise<GatewayAuthRole | null>;
        };
        // Prefer the role of the credential in use (Bearer / cookie). Do not infer
        // admin from getGatewayAdminToken() — local attach can read both tokens
        // from disk even when the window presents user_/access.
        if (typeof bridge.getGatewayAuthRole === 'function') {
          const role = await bridge.getGatewayAuthRole();
          if (role === 'admin' || role === 'access') serverRole = role;
        }
      } catch {
        /* prefix fallback below */
      }
      const presented = readAttachPresentedToken();
      if (cancelled) return;
      const role = resolveClientGatewayAuthRole({
        serverRole,
        // Prefix fallback: presented attach Bearer only (not form fields that may
        // show the disk admin token while Bearer is still user_).
        presentedToken: presented,
      });
      setClientGatewayRole(role ?? 'pending');
    })();
    return () => {
      cancelled = true;
    };
  }, [gatewayClient, gatewayHttpApiToken, gatewayHttpApiAdminToken]);

  // Local loopback Electron attach keeps 网关端 even before admin role resolves.
  const localHostAttach = isLocalHostElectronAttach();
  const hideGatewaySideNav = shouldHideGatewaySideSettings({
    gatewayClient,
    role: clientGatewayRole,
    localHost: localHostAttach,
  });
  // Remote/Web attach: only super-admin may edit host config (all gateway-side keys:
  // MCP / tools / security / model / web / computers / backup / …). User token keeps
  // panels hidden; local-host attach may still show 网关端 but keeps writes read-only.
  const gatewayHostReadOnly = gatewayClient && clientGatewayRole !== 'admin';
  useEffect(() => {
    if (hideGatewaySideNav && isGatewaySideSettingsTab(tab)) setTab('general');
  }, [hideGatewaySideNav, tab]);

  const [gatewayHttpApiBindLan, setGatewayHttpApiBindLan] = useState(initialGatewayHttpApi.bindLan === true);
  const [gatewayHttpApiServeUi, setGatewayHttpApiServeUi] = useState(initialGatewayHttpApi.serveUi === true);
  const [computersDraft, setComputersDraft] = useState<ComputerEntry[]>(() =>
    normalizeComputers(settings.computers),
  );
  const [defaultComputerId, setDefaultComputerId] = useState(() =>
    normalizeDefaultComputerId(settings.defaultComputerId, normalizeComputers(settings.computers)),
  );
  const [timezone, setTimezone] = useState(() => normalizeTimezone(settings.timezone));

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
  const [estimateSafetyFactor, setEstimateSafetyFactor] = useState(
    String(initialCc.estimateSafetyFactor),
  );
  const [autoTopicCompress, setAutoTopicCompress] = useState(initialCc.autoTopicCompress !== false);
  const initialSquad = normalizeSquadSettings(settings.squad);
  const initialInstructions = normalizeInstructionsSettings(settings.instructions);
  const [assistantRoleTemplate, setAssistantRoleTemplate] = useState(
    initialInstructions.assistantRoleTemplate,
  );
  const [soulMdRefreshSystemPrompt, setSoulMdRefreshSystemPrompt] = useState(
    initialInstructions.soulMdRefreshSystemPrompt,
  );
  const [skillsCreateUpdateInstruction, setSkillsCreateUpdateInstruction] = useState(
    initialInstructions.skillsCreateUpdateInstruction,
  );
  const initialMemory = normalizeMemorySettings(settings.memory);
  const [scopeInstruction, setScopeInstruction] = useState(initialMemory.scopeInstruction);
  const [globalMemories, setGlobalMemories] = useState<MemoryEntry[]>([]);
  const [globalMemAddRequest, setGlobalMemAddRequest] = useState(0);
  const [instructionsSubTab, setInstructionsSubTab] = useState<InstructionsSubTab>('assistant');
  const [captainPersona, setCaptainPersona] = useState(initialSquad.captainPersona);
  const [squadPlaybook, setSquadPlaybook] = useState(initialSquad.playbook);
  const [_showKey, _setShowKey] = useState(false);
  /** Block autosave until mount hydrate from getSettings finishes (avoids clobbering). */
  const allowAutosaveRef = useRef(false);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<(() => void | Promise<void>) | null>(null);

  useEffect(() => {
    if (pureWebUi) return;
    let cancelled = false;
    const getStatus = window.okbot.updaterGetStatus;
    if (typeof getStatus === 'function') {
      void getStatus().then((s) => {
        if (!cancelled) setUpdaterStatus(s);
      });
    }
    const onEvent = window.okbot.onUpdaterEvent;
    const off = typeof onEvent === 'function' ? onEvent((s) => setUpdaterStatus(s)) : undefined;
    return () => {
      cancelled = true;
      off?.();
    };
  }, [pureWebUi]);

  // Every open: reload latest merged settings so gateway edits from other clients show up.
  // Autosave stays blocked until this finishes so we do not write a stale hybrid payload.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const latest = await window.okbot.getSettings();
        if (cancelled || !latest) return;
        setTheme(latest.theme);
        applyTheme(latest.theme);
        document.documentElement.dataset.translucent =
          latest.translucent !== false ? 'true' : 'false';
        setLanguage(latest.language);
        setMicrophoneId(latest.microphoneId);
        setHardwareAcceleration(latest.hardwareAcceleration !== false);
        setAutoUpdate(latest.autoUpdate !== false);
        setSidebarDockMagnify(latest.sidebarDockMagnify === true);
        setTranslucent(latest.translucent !== false);
        setDeveloperMode(latest.developerMode === true);
        setNotifications(latest.notifications !== false);
        setCloseAction(normalizeCloseAction(latest.closeAction));
        setClientNavExpanded(latest.settingsClientGroupExpanded !== false);
        setGatewayNavExpanded(latest.settingsGatewayGroupExpanded === true);
        setMcpDraft(normalizeMcpSettings(latest.mcp));
        setWebDraft(normalizeWebSettings(latest.web));
        const api = normalizeGatewayHttpApiSettings(latest.gatewayHttpApi);
        setGatewayHttpApiPort(String(api.port));
        setGatewayHttpApiToken(api.token);
        setGatewayHttpApiAdminToken(api.adminToken || '');
        setGatewayApiTokens(api.apiTokens || []);
        setGatewayHttpApiBindLan(api.bindLan === true);
        setGatewayHttpApiServeUi(api.serveUi === true);
        const computers = normalizeComputers(latest.computers);
        setComputersDraft(computers);
        setDefaultComputerId(normalizeDefaultComputerId(latest.defaultComputerId, computers));
        setTimezone(normalizeTimezone(latest.timezone));
        setAutoApprovalEnabled(latest.autoApprovalEnabled === true);
        setAutoApprovalRules(latest.autoApprovalRules ?? []);
        setTools(latest.tools ?? DEFAULT_TOOL_PREFERENCES);
        const security = normalizeSecuritySettings(latest.security);
        setSecurityEnabled(security.enabled);
        setRestrictToHome(security.restrictToHome);
        setAllowedPathsText(security.allowedPathPrefixes.join('\n'));
        setDeniedPathsText(security.deniedPathPrefixes.join('\n'));
        setShellPatternsEnabled(security.shellPatternsEnabled);
        setShellPatterns(security.shellPatterns);
        setBlockMode(security.blockMode);
        setModelSettings(normalizeModelSettings(latest.model));
        const cc = normalizeContextCompression(latest.contextCompression);
        setCompressRatioPct(String(Math.round(cc.ratio * 100)));
        setKeepRecentMax(String(cc.keepRecentMax));
        setKeepRecentMin(String(cc.keepRecentMin));
        setSummaryMaxChars(String(cc.summaryMaxChars));
        setEstimateSafetyFactor(String(cc.estimateSafetyFactor));
        setAutoTopicCompress(cc.autoTopicCompress !== false);
        const instructions = normalizeInstructionsSettings(latest.instructions);
        setAssistantRoleTemplate(instructions.assistantRoleTemplate);
        setSoulMdRefreshSystemPrompt(instructions.soulMdRefreshSystemPrompt);
        setSkillsCreateUpdateInstruction(instructions.skillsCreateUpdateInstruction);
        const memory = normalizeMemorySettings(latest.memory);
        setScopeInstruction(memory.scopeInstruction);
        const squad = normalizeSquadSettings(latest.squad);
        setCaptainPersona(squad.captainPersona);
        setSquadPlaybook(squad.playbook);
      } catch {
        /* keep props-initialized state */
      } finally {
        if (!cancelled) allowAutosaveRef.current = true;
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
  const title = t(lang, SETTINGS_TAB_LABEL_KEYS[tab] ?? 'general');
  const selectTab = (id: SettingsTab) => {
    setTab(id);
    setNavMenuOpen(false);
  };
  /* Tip only while icon-rail labels are hidden (not labeled hamburger drawer). */
  const showNavTips = railNarrow && !navMenuOpen;
  function navTip(label: string, node: ReactElement<any>) {
    if (!showNavTips) return node;
    return (
      <QuickTip text={label} place="right">
        {node}
      </QuickTip>
    );
  }
  const needsHwRestart = hardwareAcceleration !== hwAccelActive;

  useEffect(() => {
    if (!initialTab) return;
    setTab(normalizeSettingsNavTab(initialTab) as SettingsTab);
  }, [initialTab]);

  useEffect(() => {
    if (!focusSection) return;
    const id = focusSection;
    if (id === 'assistantRoleTemplate') setInstructionsSubTab('assistant');
    else if (id.startsWith('squad')) setInstructionsSubTab('squad');
    else if (id.startsWith('soulMd')) setInstructionsSubTab('soul');
    else if (id === 'scopeInstruction')
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
    if (!allowAutosaveRef.current) {
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
        translucent,
        developerMode,
        notifications,
        closeAction,
        settingsNavTab: normalizeSettingsNavTab(tab),
        settingsClientGroupExpanded: clientNavExpanded,
        settingsGatewayGroupExpanded: gatewayNavExpanded,
        mcp: normalizeMcpSettings(mcpDraft),
        web: normalizeWebSettings(webDraft),
        assistantMarketplace: normalizeAssistantMarketplaceSettings(settings.assistantMarketplace),
        gatewayHttpApi: (() => {
          const nextApi = normalizeGatewayHttpApiSettings({
            enabled: true,
            port: keptNumber(gatewayHttpApiPort, normalizeGatewayHttpApiSettings(settings.gatewayHttpApi).port),
            apiTokens: gatewayApiTokens,
            token: '',
            adminToken: '',
            bindLan: gatewayHttpApiBindLan,
            serveUi: gatewayHttpApiServeUi,
          });
          if (
            nextApi.token !== gatewayHttpApiToken ||
            nextApi.adminToken !== gatewayHttpApiAdminToken ||
            nextApi.apiTokens.length !== gatewayApiTokens.length
          ) {
            setGatewayHttpApiToken(nextApi.token);
            setGatewayHttpApiAdminToken(nextApi.adminToken);
            setGatewayApiTokens(nextApi.apiTokens);
          }
          return nextApi;
        })(),
        computers: normalizeComputers(computersDraft),
        defaultComputerId: normalizeDefaultComputerId(defaultComputerId, normalizeComputers(computersDraft)),
        timezone: normalizeTimezone(timezone),
        // Keep runtime default-assistant (sidebar star / context menu); not edited in General UI.
        defaultAssistantId: normalizeDefaultAssistantId(settings.defaultAssistantId, bots),
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
          estimateSafetyFactor: keptNumber(
            estimateSafetyFactor,
            normalizeContextCompression(settings.contextCompression).estimateSafetyFactor,
          ),
          autoTopicCompress,
        }),
        instructions: normalizeInstructionsSettings({
          assistantRoleTemplate,
          soulMdRefreshSystemPrompt,
          skillsCreateUpdateInstruction,
        }),
        memory: normalizeMemorySettings({
          scopeInstruction,
          promptMaxEntries: settings.memory.promptMaxEntries,
          promptMaxChars: settings.memory.promptMaxChars,
        }),
        maintenance: normalizeMaintenanceSettings(settings.maintenance),
        squad: normalizeSquadSettings({
          captainPersona,
          playbook: squadPlaybook,
        }),
      };
      // Full merged payload: Electron saveUiSettings / httpOkbot.saveSettings split
      // client chrome (~/.okbot/client.json / localStorage) from gateway ~/.okbot/server.json.
      // Gateway write path ignores client keys (no 409).
      await onSaveRef.current(payload);
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
    translucent,
    developerMode,
    notifications,
    closeAction,
    tab,
    clientNavExpanded,
    gatewayNavExpanded,
    gatewayClient,
    mcpDraft,
    webDraft,
    gatewayHttpApiPort,
    gatewayHttpApiToken,
    gatewayHttpApiAdminToken,
    gatewayApiTokens,
    gatewayHttpApiBindLan,
    gatewayHttpApiServeUi,
    computersDraft,
    defaultComputerId,
    timezone,
    bots,
    settings.defaultAssistantId,
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
    estimateSafetyFactor,
    autoTopicCompress,
    assistantRoleTemplate,
    soulMdRefreshSystemPrompt,
    skillsCreateUpdateInstruction,
    scopeInstruction,
    captainPersona,
    squadPlaybook,
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
      <div
        className={`settings-shell${navMenuOpen ? ' nav-menu-open' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="settings-nav-backdrop"
          aria-label={t(lang, 'sidebarFabClose')}
          aria-hidden={!navMenuOpen}
          tabIndex={navMenuOpen ? 0 : -1}
          onClick={() => setNavMenuOpen(false)}
        />
        <nav
          className="settings-nav"
          aria-label={t(lang, 'settings')}
        >
          {navTip(
            t(lang, 'settingsNavClientGroup'),
            <button
              type="button"
              className={`settings-nav-group${clientNavExpanded ? ' expanded' : ''}`}
              aria-expanded={clientNavExpanded}
              onClick={() => setClientNavExpanded((v) => !v)}
            >
              <span className="settings-nav-group-label">{t(lang, 'settingsNavClientGroup')}</span>
              <span className="session-owner-group-chevron" aria-hidden>
                <ChevronDownIcon />
              </span>
            </button>,
          )}
          {clientNavExpanded ? (
            <>
              {navTip(
                t(lang, 'general'),
                <button
                  type="button"
                  className={`settings-nav-item${tab === 'general' ? ' active' : ''}`}
                  aria-label={t(lang, 'general')}
                  aria-current={tab === 'general' ? 'page' : undefined}
                  onClick={() => selectTab('general')}
                >
                  <span className="ico" aria-hidden>
                    <SettingsIcon />
                  </span>
                  <span className="settings-nav-label">{t(lang, 'general')}</span>
                </button>,
              )}
              {navTip(
                t(lang, 'gatewaysTab'),
                <button
                  type="button"
                  className={`settings-nav-item${tab === 'gateways' ? ' active' : ''}`}
                  aria-label={t(lang, 'gatewaysTab')}
                  aria-current={tab === 'gateways' ? 'page' : undefined}
                  onClick={() => selectTab('gateways')}
                >
                  <span className="ico" aria-hidden>
                    <GatewayIcon />
                  </span>
                  <span className="settings-nav-label">{t(lang, 'gatewaysTab')}</span>
                </button>,
              )}
              {!pureWebUi ? (
                navTip(
                  t(lang, 'updatesTab'),
                  <button
                    type="button"
                    className={`settings-nav-item${tab === 'updates' ? ' active' : ''}`}
                    aria-label={t(lang, 'updatesTab')}
                    aria-current={tab === 'updates' ? 'page' : undefined}
                    onClick={() => selectTab('updates')}
                  >
                    <span className="ico" aria-hidden>
                      <DownloadUpdateIcon />
                    </span>
                    <span className="settings-nav-label">{t(lang, 'updatesTab')}</span>
                  </button>,
                )
              ) : null}
            </>
          ) : null}

          {!hideGatewaySideNav ? (
          navTip(
            t(lang, 'settingsNavGatewayGroup'),
            <button
              type="button"
              className={`settings-nav-group${gatewayNavExpanded ? ' expanded' : ''}`}
              aria-expanded={gatewayNavExpanded}
              onClick={() => setGatewayNavExpanded((v) => !v)}
            >
              <span className="settings-nav-group-label">{t(lang, 'settingsNavGatewayGroup')}</span>
              <span className="session-owner-group-chevron" aria-hidden>
                <ChevronDownIcon />
              </span>
            </button>,
          )
          ) : null}
          {!hideGatewaySideNav && gatewayNavExpanded ? (
            <>
              {navTip(
                t(lang, 'model'),
                <button
                  type="button"
                  className={`settings-nav-item${tab === 'model' ? ' active' : ''}`}
                  aria-label={t(lang, 'model')}
                  aria-current={tab === 'model' ? 'page' : undefined}
                  onClick={() => selectTab('model')}
                >
                  <span className="ico" aria-hidden>
                    <ModelNavIcon />
                  </span>
                  <span className="settings-nav-label">{t(lang, 'model')}</span>
                </button>,
              )}
              {navTip(
                t(lang, 'tools'),
                <button
                  type="button"
                  className={`settings-nav-item${tab === 'tools' ? ' active' : ''}`}
                  aria-label={t(lang, 'tools')}
                  aria-current={tab === 'tools' ? 'page' : undefined}
                  onClick={() => selectTab('tools')}
                >
                  <span className="ico" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
                    </svg>
                  </span>
                  <span className="settings-nav-label">{t(lang, 'tools')}</span>
                </button>,
              )}
              {navTip(
                t(lang, 'security'),
                <button
                  type="button"
                  className={`settings-nav-item${tab === 'security' ? ' active' : ''}`}
                  aria-label={t(lang, 'security')}
                  aria-current={tab === 'security' ? 'page' : undefined}
                  onClick={() => selectTab('security')}
                >
                  <span className="ico" aria-hidden>
                    <SecurityNavIcon />
                  </span>
                  <span className="settings-nav-label">{t(lang, 'security')}</span>
                </button>,
              )}
              {navTip(
                t(lang, 'gateway'),
                <button
                  type="button"
                  className={`settings-nav-item${tab === 'gateway' ? ' active' : ''}`}
                  aria-label={t(lang, 'gateway')}
                  aria-current={tab === 'gateway' ? 'page' : undefined}
                  onClick={() => selectTab('gateway')}
                >
                  <span className="ico" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <rect x="3" y="4" width="18" height="6" rx="1.5" />
                      <rect x="3" y="14" width="18" height="6" rx="1.5" />
                      <path d="M7 7h.01M7 17h.01" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="settings-nav-label">{t(lang, 'gateway')}</span>
                </button>,
              )}
              {navTip(
                t(lang, 'extensionsTab'),
                <button
                  type="button"
                  className={`settings-nav-item${tab === 'extensions' ? ' active' : ''}`}
                  aria-label={t(lang, 'extensionsTab')}
                  aria-current={tab === 'extensions' ? 'page' : undefined}
                  onClick={() => selectTab('extensions')}
                >
                  <span className="ico" aria-hidden>
                    <ExtensionsNavIcon />
                  </span>
                  <span className="settings-nav-label">{t(lang, 'extensionsTab')}</span>
                </button>,
              )}
              {navTip(
                t(lang, 'memoryTab'),
                <button
                  type="button"
                  className={`settings-nav-item${tab === 'memory' ? ' active' : ''}`}
                  aria-label={t(lang, 'memoryTab')}
                  aria-current={tab === 'memory' ? 'page' : undefined}
                  onClick={() => selectTab('memory')}
                >
                  <span className="ico" aria-hidden>
                    <MemoryNavIcon />
                  </span>
                  <span className="settings-nav-label">{t(lang, 'memoryTab')}</span>
                </button>,
              )}
              {navTip(
                t(lang, 'usageTab'),
                <button
                  type="button"
                  className={`settings-nav-item${tab === 'usage' ? ' active' : ''}`}
                  aria-label={t(lang, 'usageTab')}
                  aria-current={tab === 'usage' ? 'page' : undefined}
                  onClick={() => selectTab('usage')}
                >
                  <span className="ico" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M4 19V5M4 19h16" strokeLinecap="round" />
                      <path d="M8 15v-4M12 15V8M16 15v-7" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="settings-nav-label">{t(lang, 'usageTab')}</span>
                </button>,
              )}
              {developerMode ? (
                navTip(
                  t(lang, 'instructions'),
                  <button
                    type="button"
                    className={`settings-nav-item${tab === 'instructions' ? ' active' : ''}`}
                    aria-label={t(lang, 'instructions')}
                    aria-current={tab === 'instructions' ? 'page' : undefined}
                    onClick={() => selectTab('instructions')}
                  >
                    <span className="ico" aria-hidden>
                      <InstructionsNavIcon />
                    </span>
                    <span className="settings-nav-label">{t(lang, 'instructions')}</span>
                  </button>,
                )
              ) : null}
            </>
          ) : null}
        </nav>
        <div className="settings-main">
          <div className="settings-main-head">
            <button
              type="button"
              className="settings-nav-hamburger"
              title={navMenuOpen ? t(lang, 'sidebarFabClose') : t(lang, 'sidebarFabOpen')}
              aria-label={navMenuOpen ? t(lang, 'sidebarFabClose') : t(lang, 'sidebarFabOpen')}
              aria-expanded={navMenuOpen}
              onClick={() => setNavMenuOpen((v) => !v)}
            >
              <MenuIcon />
            </button>
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
                lang={lang}
                closeAction={closeAction}
                developerMode={developerMode}
                hardwareAcceleration={hardwareAcceleration}
                language={language}
                micOptions={micOptions}
                microphoneId={microphoneId}
                notifications={notifications}
                setCloseAction={setCloseAction}
                setDeveloperMode={setDeveloperMode}
                setHardwareAcceleration={setHardwareAcceleration}
                setLanguage={setLanguage}
                setMicrophoneId={setMicrophoneId}
                setNotifications={setNotifications}
                setSidebarDockMagnify={setSidebarDockMagnify}
                setTheme={setTheme}
                setTranslucent={setTranslucent}
                setTimezone={setTimezone}
                sidebarDockMagnify={sidebarDockMagnify}
                theme={theme}
                timezone={timezone}
                translucent={translucent}
              />
            ) : tab === 'gateways' ? (
              <ClientGatewaysPanel lang={lang} />
            ) : tab === 'gateway' ? (
              <GatewaySettingsPanel
                lang={lang}
                gatewayHttpApiBindLan={gatewayHttpApiBindLan}
                gatewayHttpApiPort={gatewayHttpApiPort}
                gatewayHttpApiServeUi={gatewayHttpApiServeUi}
                gatewayHttpApiToken={gatewayHttpApiToken}
                gatewayApiTokens={gatewayApiTokens}
                setGatewayHttpApiBindLan={setGatewayHttpApiBindLan}
                setGatewayHttpApiPort={setGatewayHttpApiPort}
                setGatewayHttpApiServeUi={setGatewayHttpApiServeUi}
                onGatewayApiTokensChange={applyGatewayApiTokens}
                computers={computersDraft}
                defaultComputerId={defaultComputerId}
                onComputersChange={setComputersDraft}
                onDefaultComputerIdChange={setDefaultComputerId}
                gatewayClient={gatewayHostReadOnly}
                dataDir={dataDir}
                backupBusy={backupBusy}
                backupExcludeSecrets={backupExcludeSecrets}
                setBackupExcludeSecrets={setBackupExcludeSecrets}
                exportBackup={exportBackup}
                restoreBackup={restoreBackup}
                bots={bots}
                squads={squads}
              />
            ) : tab === 'extensions' ? (
              <McpSettingsPanel
                lang={lang}
                value={mcpDraft}
                onChange={setMcpDraft}
                readOnly={gatewayHostReadOnly}
              />
            ) : tab === 'tools' ? (
              <ToolsSettingsPanel
                gatewayClient={gatewayHostReadOnly}
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
                readOnly={gatewayHostReadOnly}
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
                  readOnly={gatewayHostReadOnly}
                />

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
                          estimateSafetyFactor: keptNumber(
                            estimateSafetyFactor,
                            normalizeContextCompression(settings.contextCompression).estimateSafetyFactor,
                          ),
                          autoTopicCompress,
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
                          estimateSafetyFactor: keptNumber(
                            estimateSafetyFactor,
                            normalizeContextCompression(settings.contextCompression).estimateSafetyFactor,
                          ),
                          autoTopicCompress,
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
                          estimateSafetyFactor: keptNumber(
                            estimateSafetyFactor,
                            normalizeContextCompression(settings.contextCompression).estimateSafetyFactor,
                          ),
                          autoTopicCompress,
                        });
                        setSummaryMaxChars(String(cc.summaryMaxChars));
                      }}
                    />
                  </div>
                  <div className="settings-row" data-settings-id="estimateSafetyFactor">
                    <span className="settings-row-label">
                      <span className="settings-row-label-text">{t(lang, 'estimateSafetyFactor')}</span>
                      <SettingsHelpTip text={t(lang, 'estimateSafetyFactorHint')} />
                    </span>
                    <input
                      spellCheck={false}
                      className="wide"
                      type="number"
                      min={1}
                      max={3}
                      step={0.1}
                      value={estimateSafetyFactor}
                      onChange={(e) => setEstimateSafetyFactor(e.target.value)}
                      onBlur={() => {
                        const cc = normalizeContextCompression({
                          ratio: Number(compressRatioPct) / 100,
                          keepRecentMax: keptNumber(keepRecentMax, normalizeContextCompression(settings.contextCompression).keepRecentMax),
                          keepRecentMin: keptNumber(keepRecentMin, normalizeContextCompression(settings.contextCompression).keepRecentMin),
                          summaryMaxChars: keptNumber(summaryMaxChars, normalizeContextCompression(settings.contextCompression).summaryMaxChars),
                          estimateSafetyFactor: keptNumber(
                            estimateSafetyFactor,
                            normalizeContextCompression(settings.contextCompression).estimateSafetyFactor,
                          ),
                          autoTopicCompress,
                        });
                        setEstimateSafetyFactor(String(cc.estimateSafetyFactor));
                      }}
                    />
                  </div>
                </div>

              </div>

            ) : tab === 'instructions' ? (
              <InstructionsSettingsPanel
                settings={settings}
                lang={lang}
                soulMdRefreshSystemPrompt={soulMdRefreshSystemPrompt}
                assistantRoleTemplate={assistantRoleTemplate}
                captainPersona={captainPersona}
                instructionsSubTab={instructionsSubTab}
                scopeInstruction={scopeInstruction}
                setSoulMdRefreshSystemPrompt={setSoulMdRefreshSystemPrompt}
                setAssistantRoleTemplate={setAssistantRoleTemplate}
                setCaptainPersona={setCaptainPersona}
                setInstructionsSubTab={setInstructionsSubTab}
                setScopeInstruction={setScopeInstruction}
                setSkillsCreateUpdateInstruction={setSkillsCreateUpdateInstruction}
                setSquadPlaybook={setSquadPlaybook}
                skillsCreateUpdateInstruction={skillsCreateUpdateInstruction}
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
            ) : tab === 'updates' && !pureWebUi ? (
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
