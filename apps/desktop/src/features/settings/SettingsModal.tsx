import { useEffect, useRef, useState } from 'react';
import {
  TOOL_IDS,
  DEFAULT_TOOL_PREFERENCES,
  DEFAULT_CONTEXT_COMPRESSION,
  normalizeContextCompression,
  normalizeMaxTurns,
  normalizeModelSettings,
  normalizeSecuritySettings,
  normalizeSquadSettings,
  normalizeInstructionsSettings,
  normalizeMemorySettings,
  normalizeToolRunSettings,
  normalizeToolRunMaxToolCalls,
  normalizeToolRunMaxDurationSec,
  normalizeLocalHttpApiSettings,
  generateLocalHttpApiToken,
  type MemoryEntry,
  type AppSettings,
  type ModelSettings,
  type SecurityBlockMode,
  type LanguageCode,
  type ThemeMode,
  type UpdaterStatus,
  type Bot,
  type Squad,
} from '@okbot/shared';
import { resolveUiLang, t } from '../../i18n';
import { AutoApprovalRulesList } from './AutoApprovalRulesList';
import { MemoryEntriesList } from './MemoryEntriesList';
import { CompressRatioSlider } from './CompressRatioSlider';
import type { InstructionsSubTab, SettingsTab } from './types';
import { SettingsIcon, ModelNavIcon, SecurityNavIcon, InstructionsNavIcon, MemoryNavIcon, DownloadUpdateIcon, CopyIcon } from '../../components/ui/icons';
import { applyTheme } from '../../utils/theme';
import { updateScrollFade } from '../../utils/scrollFade';
import { formatSystemError } from '../../utils/formatSystemError';
import { toast } from '../../components/ui';
import { SettingsHelpTip } from './SettingsHelpTip';
import { SettingsToggle } from './SettingsToggle';
import { ModelProvidersPanel } from './ModelProvidersPanel';
import { UsagePanel } from './UsagePanel';

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
  const initialLocalHttpApi = normalizeLocalHttpApiSettings(settings.localHttpApi);
  const [localHttpApiEnabled, setLocalHttpApiEnabled] = useState(initialLocalHttpApi.enabled);
  const [localHttpApiPort, setLocalHttpApiPort] = useState(String(initialLocalHttpApi.port));
  const [localHttpApiToken, setLocalHttpApiToken] = useState(initialLocalHttpApi.token);
  const [showLocalHttpApiToken, setShowLocalHttpApiToken] = useState(false);
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
  const initialToolRun = normalizeToolRunSettings(settings.toolRun);
  const [maxToolCalls, setMaxToolCalls] = useState(String(initialToolRun.maxToolCalls));
  const [maxDurationSec, setMaxDurationSec] = useState(String(initialToolRun.maxDurationSec));
  const [recordTrajectory, setRecordTrajectory] = useState(initialToolRun.recordTrajectory !== false);
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
  const [showKey, setShowKey] = useState(false);
  const skipFirstSave = useRef(true);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<(() => void) | null>(null);

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
    if (initialTab) setTab(initialTab);
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
    const persist = () => {
      const pct = Number(compressRatioPct);
      const ratio = Number.isFinite(pct) ? pct / 100 : DEFAULT_CONTEXT_COMPRESSION.ratio;
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
        blockMode,
      });
      void onSaveRef.current({
        theme,
        language,
        microphoneId,
        hardwareAcceleration,
        autoUpdate,
        sidebarDockMagnify,
        localHttpApi: normalizeLocalHttpApiSettings({
          enabled: localHttpApiEnabled,
          port: Number(localHttpApiPort),
          token: localHttpApiToken,
        }),
        autoApprovalEnabled,
        autoApprovalRules,
        tools,
        toolRun: normalizeToolRunSettings({
          maxToolCalls: Number(maxToolCalls),
          maxDurationSec: Number(maxDurationSec),
          recordTrajectory,
        }),
        security,
        model: normalizeModelSettings(modelSettings),
        contextCompression: normalizeContextCompression({
          ratio,
          keepRecentMax: Number(keepRecentMax),
          keepRecentMin: Number(keepRecentMin),
          summaryMaxChars: Number(summaryMaxChars),
          autoTopicCompress,
        }),
        // Empty field → default (normalizeMaxTurns treats ''/null as fallback).
        maxTurns: normalizeMaxTurns(maxTurns),
        instructions: normalizeInstructionsSettings({
          assistantRoleTemplate,
          agentsMdRefreshSystemPrompt,
          agentsMdRecentMessageLimit: Number(agentsMdRecentMessageLimit),
          skillsCreateUpdateInstruction,
          skillsRecentMessageLimit: Number(skillsRecentMessageLimit),
        }),
        memory: normalizeMemorySettings({
          scopeInstruction,
          recentMessageLimit: Number(memoryRecentMessageLimit),
        }),
        squad: normalizeSquadSettings({
          captainPersona,
          playbook: squadPlaybook,
          captainMaxTurns: Number(captainMaxTurns),
          memberMaxTurns: Number(memberMaxTurns),
        }),
      });
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
    localHttpApiEnabled,
    localHttpApiPort,
    localHttpApiToken,
    autoApprovalEnabled,
    autoApprovalRules,
    tools,
    maxToolCalls,
    maxDurationSec,
    recordTrajectory,
    securityEnabled,
    restrictToHome,
    allowedPathsText,
    deniedPathsText,
    shellPatternsEnabled,
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
            className={`settings-nav-item${tab === 'instructions' ? ' active' : ''}`}
            onClick={() => setTab('instructions')}
          >
            <span className="ico" aria-hidden>
              <InstructionsNavIcon />
            </span>
            {t(lang, 'instructions')}
          </button>
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
                  <div className="settings-row" data-settings-id="sidebarDockMagnify">
                    <span className="settings-row-label">
                      <span className="settings-row-label-text">{t(lang, 'sidebarDockMagnify')}</span>
                      <SettingsHelpTip text={t(lang, 'sidebarDockMagnifyHint')} />
                    </span>
                    <SettingsToggle
                      checked={sidebarDockMagnify}
                      onChange={() => setSidebarDockMagnify((v) => !v)}
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
                      {micOptions.map((m) => (
                        <option key={m.id || m.label} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-row" data-settings-id="hardwareAcceleration">
                    <span className="settings-row-label">{t(lang, 'hardwareAcceleration')}</span>
                      <SettingsToggle checked={hardwareAcceleration} onChange={() => setHardwareAcceleration((v) => !v)} />
                  </div>
                </div>
                {needsHwRestart ? (
                  <div className="settings-restart-hint">{t(lang, 'hardwareRestart')}</div>
                ) : null}


                <div
                  className="settings-section-label settings-section-label-with-help"
                  style={{ marginTop: 16 }}
                  data-settings-id="localHttpApi"
                >
                  <span>{t(lang, 'localHttpApi')}</span>
                  <SettingsHelpTip text={t(lang, 'localHttpApiHint')} />
                </div>
                <div className="settings-card">
                  <div className="settings-row" data-settings-id="localHttpApiEnable">
                    <span className="settings-row-label">{t(lang, 'localHttpApiEnable')}</span>
                    <SettingsToggle
                      checked={localHttpApiEnabled}
                      onChange={() => setLocalHttpApiEnabled((v) => !v)}
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
                        onChange={(e) => setLocalHttpApiToken(e.target.value)}
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
                          onClick={() => setShowLocalHttpApiToken((v) => !v)}
                        >
                          {showLocalHttpApiToken ? (
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M3 3l18 18M10.7 10.7a2 2 0 002.6 2.6M9.9 5.1A10.5 10.5 0 0121 12c-.5 1-1.2 2-2.1 2.9M6.1 6.1C4.7 7.3 3.6 8.8 3 12c1.5 4.5 5.5 7 9 7 1.4 0 2.8-.3 4.1-.9" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          className="settings-eye"
                          disabled={!localHttpApiEnabled || !localHttpApiToken}
                          aria-label={t(lang, 'localHttpApiCopyToken')}
                          title={t(lang, 'localHttpApiCopyToken')}
                          onClick={() => {
                            void window.okbot.copyText(localHttpApiToken).then(() => {
                              toast.success(t(lang, 'localHttpApiTokenCopied'));
                            });
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
                          onClick={() => setLocalHttpApiToken(generateLocalHttpApiToken())}
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
                </div>

                <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="data">
                  {t(lang, 'data')}
                </div>
                <div className="settings-hint">
                  {t(lang, 'dataDir')}：{dataDir}
                </div>
              </div>
            ) : tab === 'tools' ? (
              <div>
                <div className="settings-section-label" data-settings-id="toolManagement">{t(lang, 'toolManagement')}</div>
                <div className="settings-card tool-mgmt-card">
                  {TOOL_IDS.map((id) => {
                    const pref = tools[id];
                    const labelKey =
                      id === 'run_shell'
                        ? 'toolRunShell'
                        : id === 'read_file'
                          ? 'toolReadFile'
                          : id === 'read_skill'
                            ? 'toolReadSkill'
                            : id === 'write_file'
                              ? 'toolWriteFile'
                              : id === 'generate_image'
                                ? 'toolGenerateImage'
                                : 'toolEditFile';
                    return (
                      <div
                        key={id}
                        className="tool-mgmt-row settings-row"
                        data-settings-id={
                          id === 'run_shell'
                            ? 'toolRunShell'
                            : id === 'read_file'
                              ? 'toolReadFile'
                              : id === 'read_skill'
                                ? 'toolReadSkill'
                                : id === 'write_file'
                                  ? 'toolWriteFile'
                                  : id === 'generate_image'
                                    ? 'toolGenerateImage'
                                    : 'toolEditFile'
                        }
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
                              setTools((prev) => ({
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
                              setTools((prev) => ({
                                ...prev,
                                [id]: { ...prev[id], enabled: !prev[id].enabled },
                              }))} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="autoApproval">
                  {t(lang, 'autoApproval')}
                </div>
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">{t(lang, 'autoApproval')}</span>
                    <div className="settings-row-trailing">
                      <button
                        type="button"
                        className="settings-aar-add-btn"
                        disabled={!autoApprovalEnabled}
                        onClick={() => setAarAddRequest((n) => n + 1)}
                      >
                        {t(lang, 'autoApprovalAdd')}
                      </button>
                      <SettingsToggle checked={autoApprovalEnabled} onChange={() => setAutoApprovalEnabled((v) => !v)} />
                    </div>
                  </div>
                  {autoApprovalEnabled ? (
                    <AutoApprovalRulesList
                      lang={lang}
                      rules={autoApprovalRules}
                      onChange={setAutoApprovalRules}
                      requestAdd={aarAddRequest}
                    />
                  ) : null}
                </div>

                <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="toolRunLimits">
                  {t(lang, 'toolRunLimits')}
                </div>
                <div className="settings-card">
                  <div className="settings-row" data-settings-id="toolRunMaxToolCalls">
                    <span className="settings-row-label">
                      <span className="settings-row-label-text">{t(lang, 'toolRunMaxToolCalls')}</span>
                      <SettingsHelpTip text={t(lang, 'toolRunMaxToolCallsHint')} />
                    </span>
                    <input
                      spellCheck={false}
                      className="wide"
                      type="number"
                      min={0}
                      max={500}
                      step={1}
                      placeholder={t(lang, 'toolRunUnlimited')}
                      value={maxToolCalls}
                      onChange={(e) => setMaxToolCalls(e.target.value)}
                      onBlur={() => {
                        setMaxToolCalls(String(normalizeToolRunMaxToolCalls(Number(maxToolCalls))));
                      }}
                    />
                  </div>
                  <div className="settings-row" data-settings-id="toolRunMaxDurationSec">
                    <span className="settings-row-label">
                      <span className="settings-row-label-text">{t(lang, 'toolRunMaxDurationSec')}</span>
                      <SettingsHelpTip text={t(lang, 'toolRunMaxDurationSecHint')} />
                    </span>
                    <input
                      spellCheck={false}
                      className="wide"
                      type="number"
                      min={0}
                      max={86400}
                      step={1}
                      placeholder={t(lang, 'toolRunUnlimited')}
                      value={maxDurationSec}
                      onChange={(e) => setMaxDurationSec(e.target.value)}
                      onBlur={() => {
                        setMaxDurationSec(
                          String(normalizeToolRunMaxDurationSec(Number(maxDurationSec))),
                        );
                      }}
                    />
                  </div>
                  <div className="settings-row" data-settings-id="toolRunRecordTrajectory">
                    <span className="settings-row-label">
                      <span className="settings-row-label-text">{t(lang, 'toolRunRecordTrajectory')}</span>
                      <SettingsHelpTip text={t(lang, 'toolRunRecordTrajectoryHint')} />
                    </span>
                    <SettingsToggle
                      checked={recordTrajectory}
                      onChange={() => setRecordTrajectory((v) => !v)}
                    />
                  </div>
                </div>

              </div>
            ) : tab === 'security' ? (
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
                      <SettingsToggle checked={securityEnabled} onChange={() => setSecurityEnabled((v) => !v)} />
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
                      <SettingsToggle checked={restrictToHome} onChange={() => setRestrictToHome((v) => !v)} disabled={!securityEnabled} />
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
                      <SettingsToggle checked={shellPatternsEnabled} onChange={() => setShellPatternsEnabled((v) => !v)} disabled={!securityEnabled} />
                  </div>
                </div>

                <div className="settings-hint settings-security-approval-hint" data-settings-id="securityApprovalRelation">
                  <strong>{t(lang, 'securityApprovalRelation')}</strong>
                  {' — '}
                  {t(lang, 'securityApprovalRelationHint')}
                </div>
              </div>
            ) : tab === 'model' ? (
              <div>
                <ModelProvidersPanel
                  lang={lang}
                  value={modelSettings}
                  onChange={setModelSettings}
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
                          keepRecentMax: Number(keepRecentMax),
                          keepRecentMin: Number(keepRecentMin),
                          summaryMaxChars: Number(summaryMaxChars),
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
                          keepRecentMax: Number(keepRecentMax),
                          keepRecentMin: Number(keepRecentMin),
                          summaryMaxChars: Number(summaryMaxChars),
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
                          keepRecentMax: Number(keepRecentMax),
                          keepRecentMin: Number(keepRecentMin),
                          summaryMaxChars: Number(summaryMaxChars),
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
                        setMaxTurns(String(normalizeMaxTurns(maxTurns)));
                      }}
                    />
                  </div>
                </div>
              </div>

            ) : tab === 'instructions' ? (
              <div>
                <div
                  className="avatar-kind-toggle instructions-subtab-toggle"
                  role="tablist"
                  aria-label={t(lang, 'instructions')}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={instructionsSubTab === 'assistant'}
                    className={instructionsSubTab === 'assistant' ? 'active' : ''}
                    onClick={() => setInstructionsSubTab('assistant')}
                  >
                    {t(lang, 'instructionsAssistant')}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={instructionsSubTab === 'squad'}
                    className={instructionsSubTab === 'squad' ? 'active' : ''}
                    onClick={() => setInstructionsSubTab('squad')}
                  >
                    {t(lang, 'instructionsSquad')}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={instructionsSubTab === 'agents'}
                    className={instructionsSubTab === 'agents' ? 'active' : ''}
                    onClick={() => setInstructionsSubTab('agents')}
                  >
                    {t(lang, 'instructionsAgents')}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={instructionsSubTab === 'memory'}
                    className={instructionsSubTab === 'memory' ? 'active' : ''}
                    onClick={() => setInstructionsSubTab('memory')}
                  >
                    {t(lang, 'instructionsMemory')}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={instructionsSubTab === 'skills'}
                    className={instructionsSubTab === 'skills' ? 'active' : ''}
                    onClick={() => setInstructionsSubTab('skills')}
                  >
                    {t(lang, 'instructionsSkills')}
                  </button>
                </div>

                {instructionsSubTab === 'assistant' ? (
                  <>
                    <div className="settings-section-label" data-settings-id="assistantRoleTemplate">
                      {t(lang, 'instructionsAssistant')}
                    </div>
                    <div className="settings-card settings-card-squad">
                      <div
                        className="settings-row settings-row-stack"
                        data-settings-id="assistantRoleTemplate"
                      >
                        <span className="settings-row-label">
                          <span className="settings-row-label-text">
                            {t(lang, 'assistantRoleTemplate')}
                          </span>
                          <SettingsHelpTip text={t(lang, 'assistantRoleTemplateHint')} />
                        </span>
                        <textarea
                          className="settings-paths-textarea"
                          spellCheck={false}
                          rows={3}
                          value={assistantRoleTemplate}
                          onChange={(e) => setAssistantRoleTemplate(e.target.value)}
                          onBlur={() => {
                            const s = normalizeInstructionsSettings({
                              assistantRoleTemplate,
                              agentsMdRefreshSystemPrompt,
                              agentsMdRecentMessageLimit: Number(agentsMdRecentMessageLimit),
                              skillsCreateUpdateInstruction,
                              skillsRecentMessageLimit: Number(skillsRecentMessageLimit),
                            });
                            setAssistantRoleTemplate(s.assistantRoleTemplate);
                          }}
                        />
                      </div>
                    </div>
                  </>
                ) : instructionsSubTab === 'squad' ? (
                  <>
                    <div className="settings-section-label" data-settings-id="squadCaptainPersona">
                      {t(lang, 'squadSettingsTitle')}
                    </div>
                    <div className="settings-card settings-card-squad">
                      <div
                        className="settings-row settings-row-stack"
                        data-settings-id="squadCaptainPersona"
                      >
                        <span className="settings-row-label">
                          <span className="settings-row-label-text">{t(lang, 'squadCaptainPersona')}</span>
                          <SettingsHelpTip text={t(lang, 'squadCaptainPersonaHint')} />
                        </span>
                        <textarea
                          className="settings-paths-textarea"
                          spellCheck={false}
                          rows={5}
                          value={captainPersona}
                          onChange={(e) => setCaptainPersona(e.target.value)}
                          onBlur={() => {
                            const s = normalizeSquadSettings({
                              captainPersona,
                              playbook: squadPlaybook,
                              captainMaxTurns: Number(captainMaxTurns),
                              memberMaxTurns: Number(memberMaxTurns),
                            });
                            setCaptainPersona(s.captainPersona);
                          }}
                        />
                      </div>
                      <div
                        className="settings-row settings-row-stack"
                        data-settings-id="squadPlaybook"
                      >
                        <span className="settings-row-label">
                          <span className="settings-row-label-text">{t(lang, 'squadPlaybook')}</span>
                          <SettingsHelpTip text={t(lang, 'squadPlaybookHint')} />
                        </span>
                        <textarea
                          className="settings-paths-textarea"
                          spellCheck={false}
                          rows={5}
                          value={squadPlaybook}
                          onChange={(e) => setSquadPlaybook(e.target.value)}
                          onBlur={() => {
                            const s = normalizeSquadSettings({
                              captainPersona,
                              playbook: squadPlaybook,
                              captainMaxTurns: Number(captainMaxTurns),
                              memberMaxTurns: Number(memberMaxTurns),
                            });
                            setSquadPlaybook(s.playbook);
                          }}
                        />
                      </div>
                      <div className="settings-row" data-settings-id="squadCaptainMaxTurns">
                        <span className="settings-row-label">
                          <span className="settings-row-label-text">
                            {t(lang, 'squadCaptainMaxTurns')}
                          </span>
                          <SettingsHelpTip text={t(lang, 'squadCaptainMaxTurnsHint')} />
                        </span>
                        <input
                          spellCheck={false}
                          className="wide"
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          value={captainMaxTurns}
                          onChange={(e) => setCaptainMaxTurns(e.target.value)}
                          onBlur={() => {
                            const s = normalizeSquadSettings({
                              captainPersona,
                              playbook: squadPlaybook,
                              captainMaxTurns: Number(captainMaxTurns),
                              memberMaxTurns: Number(memberMaxTurns),
                            });
                            setCaptainMaxTurns(String(s.captainMaxTurns));
                          }}
                        />
                      </div>
                      <div className="settings-row" data-settings-id="squadMemberMaxTurns">
                        <span className="settings-row-label">
                          <span className="settings-row-label-text">
                            {t(lang, 'squadMemberMaxTurns')}
                          </span>
                          <SettingsHelpTip text={t(lang, 'squadMemberMaxTurnsHint')} />
                        </span>
                        <input
                          spellCheck={false}
                          className="wide"
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          value={memberMaxTurns}
                          onChange={(e) => setMemberMaxTurns(e.target.value)}
                          onBlur={() => {
                            const s = normalizeSquadSettings({
                              captainPersona,
                              playbook: squadPlaybook,
                              captainMaxTurns: Number(captainMaxTurns),
                              memberMaxTurns: Number(memberMaxTurns),
                            });
                            setMemberMaxTurns(String(s.memberMaxTurns));
                          }}
                        />
                      </div>
                    </div>
                  </>
                ) : instructionsSubTab === 'agents' ? (
                  <>
                    <div
                      className="settings-section-label"
                      data-settings-id="agentsMdRefreshSystemPrompt"
                    >
                      {t(lang, 'instructionsAgents')}
                    </div>
                    <div className="settings-card settings-card-squad">
                      <div
                        className="settings-row settings-row-stack"
                        data-settings-id="agentsMdRefreshSystemPrompt"
                      >
                        <span className="settings-row-label">
                          <span className="settings-row-label-text">
                            {t(lang, 'agentsMdRefreshSystemPrompt')}
                          </span>
                          <SettingsHelpTip text={t(lang, 'agentsMdRefreshSystemPromptHint')} />
                        </span>
                        <textarea
                          className="settings-paths-textarea"
                          spellCheck={false}
                          rows={8}
                          value={agentsMdRefreshSystemPrompt}
                          onChange={(e) => setAgentsMdRefreshSystemPrompt(e.target.value)}
                          onBlur={() => {
                            const s = normalizeInstructionsSettings({
                              assistantRoleTemplate,
                              agentsMdRefreshSystemPrompt,
                              agentsMdRecentMessageLimit: Number(agentsMdRecentMessageLimit),
                              skillsCreateUpdateInstruction,
                              skillsRecentMessageLimit: Number(skillsRecentMessageLimit),
                            });
                            setAgentsMdRefreshSystemPrompt(s.agentsMdRefreshSystemPrompt);
                          }}
                        />
                      </div>
                      <div className="settings-row" data-settings-id="agentsMdRecentMessageLimit">
                        <span className="settings-row-label">
                          <span className="settings-row-label-text">
                            {t(lang, 'agentsMdRecentMessageLimit')}
                          </span>
                          <SettingsHelpTip text={t(lang, 'agentsMdRecentMessageLimitHint')} />
                        </span>
                        <input
                          spellCheck={false}
                          className="wide"
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          value={agentsMdRecentMessageLimit}
                          onChange={(e) => setAgentsMdRecentMessageLimit(e.target.value)}
                          onBlur={() => {
                            const s = normalizeInstructionsSettings({
                              assistantRoleTemplate,
                              agentsMdRefreshSystemPrompt,
                              agentsMdRecentMessageLimit: Number(agentsMdRecentMessageLimit),
                              skillsCreateUpdateInstruction,
                              skillsRecentMessageLimit: Number(skillsRecentMessageLimit),
                            });
                            setAgentsMdRecentMessageLimit(String(s.agentsMdRecentMessageLimit));
                          }}
                        />
                      </div>
                    </div>
                  </>
                ) : instructionsSubTab === 'memory' ? (
                  <>
                    <div className="settings-section-label" data-settings-id="scopeInstruction">
                      {t(lang, 'instructionsMemory')}
                    </div>
                    <div className="settings-card settings-card-squad">
                      <div
                        className="settings-row settings-row-stack"
                        data-settings-id="scopeInstruction"
                      >
                        <span className="settings-row-label">
                          <span className="settings-row-label-text">
                            {t(lang, 'memoryScopeInstruction')}
                          </span>
                          <SettingsHelpTip text={t(lang, 'memoryScopeInstructionHint')} />
                        </span>
                        <textarea
                          className="settings-paths-textarea"
                          spellCheck={false}
                          rows={3}
                          value={scopeInstruction}
                          onChange={(e) => setScopeInstruction(e.target.value)}
                          onBlur={() => {
                            const s = normalizeMemorySettings({
                              scopeInstruction,
                              recentMessageLimit: Number(memoryRecentMessageLimit),
                            });
                            setScopeInstruction(s.scopeInstruction);
                          }}
                        />
                      </div>
                      <div className="settings-row" data-settings-id="memoryRecentMessageLimit">
                        <span className="settings-row-label">
                          <span className="settings-row-label-text">
                            {t(lang, 'memoryRecentMessageLimit')}
                          </span>
                          <SettingsHelpTip text={t(lang, 'memoryRecentMessageLimitHint')} />
                        </span>
                        <input
                          spellCheck={false}
                          className="wide"
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          value={memoryRecentMessageLimit}
                          onChange={(e) => setMemoryRecentMessageLimit(e.target.value)}
                          onBlur={() => {
                            const s = normalizeMemorySettings({
                              scopeInstruction,
                              recentMessageLimit: Number(memoryRecentMessageLimit),
                            });
                            setMemoryRecentMessageLimit(String(s.recentMessageLimit));
                          }}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      className="settings-section-label"
                      data-settings-id="skillsCreateUpdateInstruction"
                    >
                      {t(lang, 'instructionsSkills')}
                    </div>
                    <div className="settings-card settings-card-squad">
                      <div
                        className="settings-row settings-row-stack"
                        data-settings-id="skillsCreateUpdateInstruction"
                      >
                        <span className="settings-row-label">
                          <span className="settings-row-label-text">
                            {t(lang, 'skillsCreateUpdateInstruction')}
                          </span>
                          <SettingsHelpTip text={t(lang, 'skillsCreateUpdateInstructionHint')} />
                        </span>
                        <textarea
                          className="settings-paths-textarea"
                          spellCheck={false}
                          rows={3}
                          value={skillsCreateUpdateInstruction}
                          onChange={(e) => setSkillsCreateUpdateInstruction(e.target.value)}
                          onBlur={() => {
                            const s = normalizeInstructionsSettings({
                              assistantRoleTemplate,
                              agentsMdRefreshSystemPrompt,
                              agentsMdRecentMessageLimit: Number(agentsMdRecentMessageLimit),
                              skillsCreateUpdateInstruction,
                              skillsRecentMessageLimit: Number(skillsRecentMessageLimit),
                            });
                            setSkillsCreateUpdateInstruction(s.skillsCreateUpdateInstruction);
                          }}
                        />
                      </div>
                      <div className="settings-row" data-settings-id="skillsRecentMessageLimit">
                        <span className="settings-row-label">
                          <span className="settings-row-label-text">
                            {t(lang, 'skillsRecentMessageLimit')}
                          </span>
                          <SettingsHelpTip text={t(lang, 'skillsRecentMessageLimitHint')} />
                        </span>
                        <input
                          spellCheck={false}
                          className="wide"
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          value={skillsRecentMessageLimit}
                          onChange={(e) => setSkillsRecentMessageLimit(e.target.value)}
                          onBlur={() => {
                            const s = normalizeInstructionsSettings({
                              assistantRoleTemplate,
                              agentsMdRefreshSystemPrompt,
                              agentsMdRecentMessageLimit: Number(agentsMdRecentMessageLimit),
                              skillsCreateUpdateInstruction,
                              skillsRecentMessageLimit: Number(skillsRecentMessageLimit),
                            });
                            setSkillsRecentMessageLimit(String(s.skillsRecentMessageLimit));
                          }}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : tab === 'memory' ? (
              <div>
                <div
                  className="settings-section-label"
                  data-settings-id="globalMemories"
                >
                  {t(lang, 'globalMemories')}
                </div>
                <div className="settings-card">
                  <div className="settings-row">
                    <span className="settings-row-label">{t(lang, 'globalMemories')}</span>
                    <div className="settings-row-trailing">
                      <button
                        type="button"
                        className="settings-aar-add-btn"
                        onClick={() => setGlobalMemAddRequest((n) => n + 1)}
                      >
                        {t(lang, 'globalMemoriesAdd')}
                      </button>
                    </div>
                  </div>
                  <MemoryEntriesList
                    lang={lang}
                    entries={globalMemories}
                    requestAdd={globalMemAddRequest}
                    emptyLabel={t(lang, 'globalMemoriesEmpty')}
                    placeholder={t(lang, 'globalMemoryPlaceholder')}
                    newBotId="global"
                    onCommit={async (entry) => {
                      try {
                        await window.okbot.upsertGlobalMemory(entry);
                        setGlobalMemories((list) => {
                          const idx = list.findIndex((m) => m.id === entry.id);
                          if (idx >= 0) {
                            const next = list.slice();
                            next[idx] = entry;
                            return next;
                          }
                          return [...list, entry];
                        });
                      } catch (err) {
                        toast.error(formatSystemError(err));
                        throw err;
                      }
                    }}
                    onDelete={async (id) => {
                      try {
                        await window.okbot.deleteGlobalMemory(id);
                        setGlobalMemories((list) => list.filter((m) => m.id !== id));
                      } catch (err) {
                        toast.error(formatSystemError(err));
                      }
                    }}
                  />
                </div>
              </div>
            ) : tab === 'usage' ? (
              <UsagePanel lang={lang} bots={bots} squads={squads} />
            ) : tab === 'updates' ? (
              <div>
                <div className="settings-section-label" data-settings-id="updateSection">
                  {t(lang, 'updateSection')}
                </div>
                <div className="settings-card">
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
                          : updaterBusy || updaterStatus?.phase === 'checking'
                            ? t(lang, 'checkingUpdate')
                            : t(lang, 'checkUpdate')}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
