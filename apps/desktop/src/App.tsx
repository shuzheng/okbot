import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type OrbState } from 'thinking-orbs';
import { resolveUiLang, t } from './i18n';
import { FlatAvatar, SquadAvatar } from './components/ui/avatars';
import {
  ThemeModeIcon,
  CopyIcon,
  CloseIcon,
  CheckIcon,
  EditIcon,
  TrashIcon,
  PersonIcon,
  SquadNavIcon,
  ExportAssistantIcon,
  DownloadUpdateIcon,
  InstallUpdateIcon,
  AboutIcon,
  CopyRequestUrlIcon,
  RunTraceIcon,
} from './components/ui/icons';
import { AboutModal } from './features/about';
import { BotFormModal } from './features/bots';
import {
  ChatComposer,
  ChatTranscript,
  ChatWatermark,
  type AttachKind,
  type ComposerAttachment,
} from './features/chat';
import { GlobalSearchModal, type GlobalSearchSelect } from './features/search';
import { SettingsModal, type SettingsTab } from './features/settings';
import {
  SessionSidebar,
  loadSidebarWidth,
  loadLastSelection,
  saveLastSelection,
  loadImmersiveChat,
  saveImmersiveChat,
  useSessionListFlip,
  SIDEBAR_DEFAULT,
  SIDEBAR_MIN,
  SIDEBAR_MAX,
  SIDEBAR_NARROW_AT,
  SIDEBAR_EXPAND_HYST,
  SPLITTER_CLICK_SLOP,
  MAIN_COLLAPSE_AT,
} from './features/sidebar';
import { SquadWizardModal } from './features/squads';
import { WindowControls } from './features/window';
import { useScrollFade } from './hooks/useScrollFade';
import { applyTheme, subscribeSystemTheme } from './utils/theme';
import { updateScrollFade } from './utils/scrollFade';
import {
  blobToWhisperAudio,
  openMicStream as openMicStreamHelper,
  pickRecorderMimeType,
  transcribeWithLocalWhisper,
} from './voice';
import { formatSystemError } from './utils/formatSystemError';
import {
  formatMessageWithAttachments,
  resolveMessageAttachments,
} from './utils/messageAttachments';
import { isAbortLikeError } from '@okbot/shared';
import { toast, ToastHost, requestConfirm, ConfirmHost } from './components/ui';
import type {
  Selection,
  SessionItem,
  SquadWizardState,
  MenuState,
  RenameTarget,
  BotFormValues,
  ToolCard,
  TurnPhase,
} from './types';
import type { DockTipTarget } from './features/sidebar';
import {
  EMOJI_PRESETS,
  MESSAGE_PAGE_SIZE,
  TOOL_IDS,
  DEFAULT_TOOL_PREFERENCES,
  DEFAULT_CONTEXT_COMPRESSION,
  DEFAULT_SECURITY,
  SQUAD_CAPTAIN_SPEAKER_ID,
  normalizeContextCompression,
  normalizeModelSettings,
  normalizeSecuritySettings,
  resolveModelConfig,
  formatContextWindowBadge,
  randomBotAvatarType,
  createId,
  plainTextFromMarkdown,
  clipQuotePreview,
  stripThinkContent,
  type ApiFormat,
  type AppSettings,
  type CatalogModel,
  type SecurityBlockMode,
  type LanguageCode,
  type Bot,
  type ChatMessage,
  type Squad,
  type SquadMember,
  type ThemeMode,
  type UpdaterStatus,
} from '@okbot/shared';


export function App() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [dataDir, setDataDir] = useState('');
  const [hwAccelActive, setHwAccelActive] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [squadWizard, setSquadWizard] = useState<SquadWizardState | null>(null);
  const [settingsFocus, setSettingsFocus] = useState<{ tab: SettingsTab; sectionId: string } | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  /** process.platform from main — used to gate Windows frameless chrome only. */
  const [platform, setPlatform] = useState<string | null>(null);
  const [tokenUsageView, setTokenUsageView] = useState<null | {
    messageId: string;
    usage?: import('@okbot/shared').TokenUsage;
  }>(null);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const pendingMessageFocusRef = useRef<{ botId: string; messageId: string } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolCardsByBot, setToolCardsByBot] = useState<Record<string, ToolCard[]>>({});
  const [promptContextView, setPromptContextView] = useState<null | {
    messageId: string;
    text: string;
    loading: boolean;
  }>(null);
  const [promptContextCopied, setPromptContextCopied] = useState(false);
  const [runTraceView, setRunTraceView] = useState<null | {
    text: string;
    loading: boolean;
  }>(null);
  const [runTraceCopied, setRunTraceCopied] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [olderBeforeMessageId, setOlderBeforeMessageId] = useState<string | null>(null);
  /** Owner id whose history is currently reflected in `messages` (null = none loaded). */
  const [historyOwnerId, setHistoryOwnerId] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const [quoteDraft, setQuoteDraft] = useState<{ messageId: string; preview: string } | null>(null);
  const quoteDraftRef = useRef<{ messageId: string; preview: string } | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  /** Per-bot in-flight flag (streaming OR awaiting tool approval). */
  const [busyByBot, setBusyByBot] = useState<Record<string, boolean>>({});
  /** Count of renderer chatStart awaits per owner — keeps BorderBeam up across abort+restart steer. */
  const sendsInFlightRef = useRef<Record<string, number>>({});
  /** Fine-grained turn footer status while busy (derived from chat events). */
  /** Distinct thinking-orbs state per turn phase (libraries.dev/orbs). */
  const TURN_PHASE_ORB_STATE: Record<TurnPhase, OrbState> = {
    thinking: 'breathing', // calm face-on ring
    replying: 'composing', // undulating sash while streaming
    awaiting_approval: 'shaping', // morphing outline draws attention
    running_tool: 'working', // particles on tilted orbits
    running_shell: 'weaving', // three strands — busy, distinct from working
    wrapping_up: 'solving', // bands settle — post-reply persist / refresh
  };
  const [turnPhaseByBot, setTurnPhaseByBot] = useState<Record<string, TurnPhase>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileBot, setProfileBot] = useState<Bot | null>(null);
  const [createTarget, setCreateTarget] = useState<Bot | null>(null);
  const [createMenu, setCreateMenu] = useState(false);
  const [createMenuPos, setCreateMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [listening, setListening] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const listeningRef = useRef(false);
  const electronAppPathRef = useRef<string>('');
  const [menu, setMenu] = useState<MenuState>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [renameValue, setRenameValue] = useState('');
  const skipRenameCommitRef = useRef(false);
  const [error, setError] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [immersiveChat, setImmersiveChat] = useState(loadImmersiveChat);

  const [selectedComputerId, setSelectedComputerId] = useState<string>(() => {
    try {
      return localStorage.getItem('okbot.selectedComputerId') || 'local';
    } catch {
      return 'local';
    }
  });
  const immersiveChatRef = useRef(immersiveChat);
  immersiveChatRef.current = immersiveChat;
  const [resizing, setResizing] = useState(false);
  const [dockScales, setDockScales] = useState<Record<string, number>>({});
  const [dockTip, setDockTip] = useState<null | {
    id: string;
    name: string;
    preview: string;
    top: number;
    left: number;
  } & (
    | {
        kind: 'bot';
        emoji: string;
        color: string;
        avatarKind?: import('@okbot/shared').BotAvatarKind;
        botAvatarType?: import('@okbot/shared').BotAvatarShape;
      }
    | { kind: 'squad'; members: Array<{ emoji: string; color: string }> }
  )>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesBoxRef = useRef<HTMLDivElement>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const newBtnFooterRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const scrollSessionKeyRef = useRef<string>('');
  /** Shared 1:1 + squad: auto-follow only while the user stays near the bottom. */
  const stickToBottomRef = useRef(true);
  /** True while we programmatically pin scroll — ignore those scroll events for stick release. */
  const pinningScrollRef = useRef(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  /** Distance ≤ this ⇒ still "at bottom" (subpixel / layout slack). */
  const AT_BOTTOM_SLACK_PX = 48;
  /** Show jump button only when clearly scrolled up past this (hysteresis vs slack). */
  const JUMP_BUTTON_PX = 80;
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const voiceBusyRef = useRef(false);
  const startingVoiceRef = useRef(false);
  const [voiceStatusLabel, setVoiceStatusLabel] = useState('');
  const streamingPreviewRef = useRef<Record<string, string>>({});
  const lastDockYRef = useRef<number | null>(null);
  /** Pending show delay for collapsed-sidebar dock tip (avatar + name + desc). */
  const dockTipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Grace hide so moving between session rows (or icon → tip) does not flicker. */
  const dockTipHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while the tip card is visible — skip re-delay when sliding across sessions. */
  const dockTipVisibleRef = useRef(false);
  const DOCK_TIP_SHOW_DELAY_MS = 500;
  const DOCK_TIP_HIDE_GRACE_MS = 150;

  function clearDockTipTimer() {
    if (dockTipTimerRef.current != null) {
      clearTimeout(dockTipTimerRef.current);
      dockTipTimerRef.current = null;
    }
  }

  function clearDockTipHideTimer() {
    if (dockTipHideTimerRef.current != null) {
      clearTimeout(dockTipHideTimerRef.current);
      dockTipHideTimerRef.current = null;
    }
  }

  function hideDockTip() {
    clearDockTipTimer();
    clearDockTipHideTimer();
    dockTipVisibleRef.current = false;
    setDockTip(null);
  }

  /** Leave rail / tip: brief grace so row gaps and icon→card moves do not flash-hide. */
  function scheduleHideDockTip() {
    clearDockTipTimer();
    clearDockTipHideTimer();
    dockTipHideTimerRef.current = setTimeout(() => {
      dockTipHideTimerRef.current = null;
      dockTipVisibleRef.current = false;
      setDockTip(null);
    }, DOCK_TIP_HIDE_GRACE_MS);
  }

  /** Pointer re-entered rail or tip card — keep sticky session scanning. */
  function cancelHideDockTip() {
    clearDockTipHideTimer();
  }
  const updateDraft = (value: string) => {
    draftRef.current = value;
    setDraft(value);
  };

  const updateQuoteDraft = (value: { messageId: string; preview: string } | null) => {
    quoteDraftRef.current = value;
    setQuoteDraft(value);
  };

  const updateAttachments = (next: ComposerAttachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  };

  const basenameOf = (filePath: string) => {
    const norm = filePath.replace(/\\/g, '/');
    const i = norm.lastIndexOf('/');
    return i >= 0 ? norm.slice(i + 1) || norm : norm;
  };

  const onPickAttach = async (kind: AttachKind) => {
    try {
      const result = await window.okbot.pickPaths(kind);
      if (result.canceled || !result.paths?.length) return;
      const prev = attachmentsRef.current;
      const existing = new Set(prev.map((a) => a.path));
      const added: ComposerAttachment[] = [];
      for (const filePath of result.paths) {
        if (!filePath || existing.has(filePath)) continue;
        existing.add(filePath);
        added.push({
          id: `att_${Date.now()}_${added.length}_${Math.random().toString(36).slice(2, 8)}`,
          kind,
          path: filePath,
          name: basenameOf(filePath),
        });
      }
      if (added.length) updateAttachments([...prev, ...added]);
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  };

  const onRemoveAttachment = (id: string) => {
    updateAttachments(attachmentsRef.current.filter((a) => a.id !== id));
  };

  const markSessionUnread = (ownerId: string, hasUnread: boolean) => {
    if (!ownerId) return;
    if (ownerId.startsWith('squad_')) {
      setSquads((prev) =>
        prev.map((s) => {
          if (s.id !== ownerId) return s;
          if ((s.hasUnreadReply === true) === hasUnread) return s;
          const next = { ...s };
          if (hasUnread) next.hasUnreadReply = true;
          else delete next.hasUnreadReply;
          return next;
        }),
      );
    } else {
      setBots((prev) =>
        prev.map((b) => {
          if (b.id !== ownerId) return b;
          if ((b.hasUnreadReply === true) === hasUnread) return b;
          const next = { ...b };
          if (hasUnread) next.hasUnreadReply = true;
          else delete next.hasUnreadReply;
          return next;
        }),
      );
    }
    void window.okbot.setChatUnread(ownerId, hasUnread);
  };

  const clearUnreadForSelection = (sel: Selection) => {
    if (!sel) return;
    markSessionUnread(sel.id, false);
  };

  const selectSession = (next: Selection) => {
    setSelection(next);
    if (next) clearUnreadForSelection(next);
  };

  const dragRef = useRef<{
    startX: number;
    startW: number;
    fromNarrow: boolean;
    pinnedCollapsed: boolean;
  } | null>(null);

  const narrow = sidebarWidth <= SIDEBAR_NARROW_AT;
  const lang = resolveUiLang(settings?.language);

  useEffect(() => {
    if (!narrow) {
      setDockScales({});
      hideDockTip();
    }
  }, [narrow]);

  useEffect(() => {
    if (settings?.sidebarDockMagnify !== true) {
      lastDockYRef.current = null;
      setDockScales({});
    }
  }, [settings?.sidebarDockMagnify]);

  useEffect(
    () => () => {
      clearDockTipTimer();
      clearDockTipHideTimer();
    },
    [],
  );

  const selectedBot = useMemo(
    () => (selection?.kind === 'bot' ? bots.find((b) => b.id === selection.id) ?? null : null),
    [bots, selection],
  );

  async function copyTextToClipboard(text: string) {
    if (typeof window.okbot.copyText === 'function') {
      await window.okbot.copyText(text);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* fall through */
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (!ok) throw new Error('复制失败');
  }



  const selectedSquad = useMemo(
    () => (selection?.kind === 'squad' ? squads.find((g) => g.id === selection.id) ?? null : null),
    [squads, selection],
  );

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  /** Distinguishes two loads of the same owner (A→B→A). */
  const historyLoadGenRef = useRef(0);

  async function openRunTrace() {
    const sel = selectionRef.current;
    const ownerId = sel?.kind === 'bot' || sel?.kind === 'squad' ? sel.id : null;
    if (!ownerId) return;
    setRunTraceCopied(false);
    setRunTraceView({ text: '', loading: true });
    try {
      const res = await window.okbot.getLastRunTrace(ownerId);
      const text = res?.trace ? JSON.stringify(res.trace, null, 2) : '';
      setRunTraceView({ text, loading: false });
    } catch (err) {
      setRunTraceView({
        text: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  }

  /** Copy a ready SSE curl for the current bot/squad local HTTP API endpoint. */
  async function copyLocalHttpRequestUrl() {
    const sel = selectionRef.current;
    const kind = sel?.kind === 'bot' || sel?.kind === 'squad' ? sel.kind : null;
    const id = kind && sel ? sel.id : '';
    if (!kind || !id) return;

    const api = settings?.localHttpApi;
    if (!api?.enabled) {
      toast.info(t(lang, 'copyRequestUrlDisabled'));
      setSettingsFocus({ tab: 'gateway', sectionId: 'localHttpApiEnable' });
      setSettingsOpen(true);
      return;
    }

    const pathKind = kind === 'squad' ? 'squads' : 'bots';
    const url = `http://127.0.0.1:${api.port}/v1/${pathKind}/${id}/messages`;
    const sampleText = lang === 'en' ? 'Hello' : '你好';
    const body = JSON.stringify({ text: sampleText });
    // Shell-safe one-liner via JSON.stringify quoting; matches GUIDE §6.1 SSE shape.
    const curl = [
      'curl -N -X POST',
      JSON.stringify(url),
      '-H',
      '"Authorization: Bearer $OKBOT_TOKEN"',
      '-H',
      JSON.stringify('Accept: text/event-stream'),
      '-H',
      JSON.stringify('Content-Type: application/json'),
      '-d',
      JSON.stringify(body),
    ].join(' ');

    try {
      await copyTextToClipboard(curl);
      toast.success(t(lang, 'copyRequestUrlCopied'));
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  }

  async function openPromptContext(messageId: string) {
    const sel = selectionRef.current;
    const ownerId = sel?.kind === 'bot' || sel?.kind === 'squad' ? sel.id : null;
    if (!ownerId) return;
    setPromptContextCopied(false);
    setPromptContextView({ messageId, text: '', loading: true });
    try {
      const res = await window.okbot.getPromptContext(ownerId, messageId);
      setPromptContextView({
        messageId,
        text: res?.text ?? '',
        loading: false,
      });
    } catch (err) {
      setPromptContextView({
        messageId,
        text: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  }
  const squadsRef = useRef(squads);
  squadsRef.current = squads;

  const selectedBotId = selectedBot?.id;
  const chatOwnerId = selectedBot?.id ?? selectedSquad?.id ?? null;

  useEffect(() => {
    updateAttachments([]);
  }, [chatOwnerId]);

  /** Active bot/squad resolved model → collapsible `<think>` (default on). */
  const showThinking = useMemo(() => {
    const modelSettings = normalizeModelSettings(settings?.model);
    const override = selectedBot
      ? { providerId: selectedBot.providerId, modelId: selectedBot.modelId }
      : selectedSquad
        ? { providerId: selectedSquad.providerId, modelId: selectedSquad.modelId }
        : null;
    return resolveModelConfig(modelSettings, override).showThinking;
  }, [settings?.model, selectedBot, selectedSquad]);

  const messagesLoading = chatOwnerId !== null && historyOwnerId !== chatOwnerId;
  const busy = chatOwnerId ? !!busyByBot[chatOwnerId] : false;
  const toolCards = chatOwnerId ? toolCardsByBot[chatOwnerId] ?? [] : [];
  const turnPhase: TurnPhase = chatOwnerId
    ? turnPhaseByBot[chatOwnerId] ?? 'thinking'
    : 'thinking';
  const turnStatusText =
    turnPhase === 'awaiting_approval'
      ? t(lang, 'toolWaiting')
      : turnPhase === 'running_tool'
        ? t(lang, 'statusRunningTool')
        : turnPhase === 'running_shell'
          ? t(lang, 'statusRunningShell')
          : turnPhase === 'replying'
            ? t(lang, 'statusReplying')
            : turnPhase === 'wrapping_up'
              ? t(lang, 'statusWrappingUp')
              : t(lang, 'thinking');
  const botIsWorking = useCallback(
    (botId: string) =>
      !!busyByBot[botId] || (toolCardsByBot[botId] ?? []).some((c) => c.status === 'pending'),
    [busyByBot, toolCardsByBot],
  );

  const sessionHasUnread = useCallback(
    (ownerId: string) => {
      if (ownerId.startsWith('squad_')) {
        return !!squads.find((s) => s.id === ownerId)?.hasUnreadReply;
      }
      return !!bots.find((b) => b.id === ownerId)?.hasUnreadReply;
    },
    [bots, squads],
  );

  const sessions = useMemo(() => {
    const items: SessionItem[] = [
      ...bots.map((bot) => ({ kind: 'bot' as const, bot, updatedAt: bot.updatedAt })),
      ...squads.map((squad) => ({ kind: 'squad' as const, squad, updatedAt: squad.updatedAt })),
    ];
    items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return items;
  }, [bots, squads]);

  const sessionOrderKey = sessions
    .map((s) => (s.kind === 'bot' ? `bot:${s.bot.id}` : `squad:${s.squad.id}`))
    .join('|');
  useSessionListFlip(sessionListRef, sessionOrderKey);


  const refreshBootstrap = useCallback(async () => {
    const boot = await window.okbot.getBootstrap();
    setBots(boot.bots);
    setSquads(boot.squads);
    setSettings(boot.settings);
    setDataDir(boot.dataDir);
    setHwAccelActive(boot.hardwareAccelerationActive !== false);
    applyTheme(boot.settings.theme);
    document.documentElement.lang = resolveUiLang(boot.settings.language) === 'en' ? 'en' : 'zh-CN';
    // Restore in-flight tool approvals / busy flags after window remount (main still holds them).
    const nextBusy: Record<string, boolean> = {};
    for (const id of boot.busyBotIds ?? []) nextBusy[id] = true;
    const nextCards: Record<string, ToolCard[]> = {};
    for (const req of boot.pendingToolRequests ?? []) {
      nextBusy[req.botId] = true;
      const list = nextCards[req.botId] ?? [];
      if (!list.some((c) => c.requestId === req.requestId)) {
        list.push({
          requestId: req.requestId,
          messageId: req.messageId,
          toolName: req.toolName,
          arguments: req.arguments,
          status: 'pending',
        });
        nextCards[req.botId] = list;
      }
    }
    setBusyByBot(nextBusy);
    setToolCardsByBot(nextCards);
    const nextPhase: Record<string, TurnPhase> = {};
    for (const id of Object.keys(nextBusy)) nextPhase[id] = 'thinking';
    for (const botId of Object.keys(nextCards)) {
      if ((nextCards[botId] ?? []).some((c) => c.status === 'pending')) {
        nextPhase[botId] = 'awaiting_approval';
      }
    }
    setTurnPhaseByBot(nextPhase);

    if (boot.settingsLoadWarning) {
      toast.error(boot.settingsLoadWarning, { duration: 12000 });
    }

    // Re-open the last session after cold start / window remount.
    const last = loadLastSelection();
    if (last?.kind === 'bot' && boot.bots.some((b: Bot) => b.id === last.id)) {
      selectSession(last);
    } else if (last?.kind === 'squad' && boot.squads.some((g: Squad) => g.id === last.id)) {
      selectSession(last);
    }
  }, []);

  useEffect(() => {
    void refreshBootstrap();
  }, [refreshBootstrap]);

  useEffect(() => {
    try {
      localStorage.setItem('okbot.sidebarWidth', String(sidebarWidth));
    } catch {
      /* ignore */
    }
  }, [sidebarWidth]);

  useEffect(() => {
    saveImmersiveChat(immersiveChat);
  }, [immersiveChat]);

  useEffect(() => {
    if (!selection) return;
    saveLastSelection(selection);
  }, [selection]);

  // Last expanded width; distinguish manual collapse vs auto-collapse.
  const lastExpandedWidthRef = useRef(
    sidebarWidth > SIDEBAR_NARROW_AT
      ? Math.min(SIDEBAR_MAX, sidebarWidth)
      : SIDEBAR_DEFAULT,
  );
  const manualCollapsedRef = useRef(sidebarWidth <= SIDEBAR_NARROW_AT);
  const autoCollapsedRef = useRef(false);
  /** How the sidebar last entered rail mode — drives splitter click restore. */
  const collapseReasonRef = useRef<'click' | 'drag' | null>(
    sidebarWidth <= SIDEBAR_NARROW_AT ? 'drag' : null,
  );
  /** Width to restore when expanding after a click-collapse. */
  const clickRestoreWidthRef = useRef(
    sidebarWidth > SIDEBAR_NARROW_AT
      ? Math.min(SIDEBAR_MAX, sidebarWidth)
      : SIDEBAR_DEFAULT,
  );

  const maxSidebarForWindow = useCallback((winW = window.innerWidth) => {
    // Keep main pane >= MAIN_COLLAPSE_AT; if impossible, stay at icon rail.
    return Math.max(SIDEBAR_MIN, winW - MAIN_COLLAPSE_AT - 5);
  }, []);

  /** Set width; CSS transition on --sidebar-w handles smooth collapse/expand. */
  const animateSidebarWidth = useCallback((target: number) => {
    const clamped = Math.min(SIDEBAR_MAX, maxSidebarForWindow(), target);
    setSidebarWidth(clamped);
  }, [maxSidebarForWindow]);

  const readSidebarRenderedWidth = useCallback(() => {
    const el = sidebarRef.current;
    if (el) {
      const w = el.getBoundingClientRect().width;
      if (Number.isFinite(w) && w > 0) return w;
    }
    return sidebarWidthRef.current;
  }, []);

  useEffect(() => {
    if (sidebarWidth > SIDEBAR_NARROW_AT && !autoCollapsedRef.current) {
      lastExpandedWidthRef.current = Math.min(SIDEBAR_MAX, sidebarWidth);
    }
  }, [sidebarWidth]);

  // Auto-collapse only while expanded (or already auto-collapsed). Never expand after manual collapse.
  useEffect(() => {
    let raf = 0;
    const check = () => {
      if (immersiveChatRef.current) return;
      if (manualCollapsedRef.current) return;
      const winW = window.innerWidth;
      const expanded = Math.max(lastExpandedWidthRef.current, SIDEBAR_NARROW_AT + 1);
      const shouldCollapse = winW - expanded - 5 < MAIN_COLLAPSE_AT;
      if (shouldCollapse) {
        if (sidebarWidthRef.current > SIDEBAR_MIN + 0.5 || autoCollapsedRef.current) {
          autoCollapsedRef.current = true;
          animateSidebarWidth(SIDEBAR_MIN);
        }
        return;
      }
      if (autoCollapsedRef.current) {
        autoCollapsedRef.current = false;
        animateSidebarWidth(expanded);
      }
    };
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, [animateSidebarWidth]);

  const tryExpandSidebar = useCallback(() => {
    const target = Math.min(
      SIDEBAR_MAX,
      Math.max(lastExpandedWidthRef.current, SIDEBAR_DEFAULT),
      maxSidebarForWindow(),
    );
    if (target <= SIDEBAR_NARROW_AT) return false; // main too narrow to expand
    manualCollapsedRef.current = false;
    autoCollapsedRef.current = false;
    collapseReasonRef.current = null;
    animateSidebarWidth(target);
    return true;
  }, [animateSidebarWidth, maxSidebarForWindow]);

  useEffect(() => {
    // Desktop-only. Gateway pages have no traffic lights; a throw here unmounts the tree.
    void window.okbot.setTrafficLightPosition?.({ x: 14, y: 14 });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.okbot.getAppInfo().then((info) => {
      if (cancelled) return;
      setPlatform(info.platform);
      document.documentElement.dataset.platform = info.platform;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // `system` theme: keep concrete data-theme in sync with OS (matchMedia + main nativeTheme).
  useEffect(() => {
    if (!settings || settings.theme !== 'system') return;
    applyTheme('system');
    const unsubMedia = subscribeSystemTheme(() => applyTheme('system'));
    const unsubIpc = window.okbot.onNativeThemeUpdated(() => applyTheme('system'));
    return () => {
      unsubMedia();
      unsubIpc();
    };
  }, [settings?.theme]);

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

  useEffect(() => {
    type PendingStream = {
      raf: number | null;
      previewByBot: Record<string, string>;
      replyPhaseBots: Set<string>;
      messageDeltas: Record<string, string>;
    };
    const pending: PendingStream = {
      raf: null,
      previewByBot: {},
      replyPhaseBots: new Set(),
      messageDeltas: {},
    };

    const flushPendingStream = () => {
      if (pending.raf != null) {
        cancelAnimationFrame(pending.raf);
        pending.raf = null;
      }
      const previewByBot = pending.previewByBot;
      const replyPhaseBots = pending.replyPhaseBots;
      const messageDeltas = pending.messageDeltas;
      const previewIds = Object.keys(previewByBot);
      const deltaIds = Object.keys(messageDeltas);
      const hasPreview = previewIds.length > 0;
      const hasReply = replyPhaseBots.size > 0;
      const hasMessages = deltaIds.length > 0;
      if (!hasPreview && !hasReply && !hasMessages) return;

      pending.previewByBot = {};
      pending.replyPhaseBots = new Set();
      pending.messageDeltas = {};

      if (hasPreview) {
        setBots((prev) => {
          let changed = false;
          const next = prev.map((b) => {
            const md = previewByBot[b.id];
            if (md == null) return b;
            const text = plainTextFromMarkdown(stripThinkContent(md));
            if (b.lastReplyPreview === text) return b;
            changed = true;
            return { ...b, lastReplyPreview: text };
          });
          return changed ? next : prev;
        });
      }
      if (hasReply) {
        setTurnPhaseByBot((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const botId of replyPhaseBots) {
            if (next[botId] === 'replying') continue;
            next[botId] = 'replying';
            changed = true;
          }
          return changed ? next : prev;
        });
      }
      if (hasMessages) {
        setMessages((prev) => {
          let next: ChatMessage[] | null = null;
          for (const messageId of deltaIds) {
            const delta = messageDeltas[messageId];
            if (!delta) continue;
            const list: ChatMessage[] = next ?? prev;
            const idx = list.findIndex((m) => m.id === messageId);
            if (idx < 0) {
              let speakerBotId: string | undefined;
              const sel = selectionRef.current;
              if (sel?.kind === 'squad') {
                speakerBotId = SQUAD_CAPTAIN_SPEAKER_ID;
              }
              // Switch-back mid-stream: seed full preview, not only the latest delta chunk.
              const full =
                streamingPreviewRef.current[messageId] ||
                delta;
              next = [
                ...list,
                {
                  id: messageId,
                  role: 'assistant',
                  content: full,
                  createdAt: new Date().toISOString(),
                  ...(speakerBotId ? { speakerBotId } : {}),
                },
              ];
            } else {
              if (!next) next = [...list];
              next[idx] = { ...next[idx], content: next[idx].content + delta };
            }
          }
          return next ?? prev;
        });
      }
    };

    const scheduleStreamFlush = () => {
      if (pending.raf != null) return;
      pending.raf = requestAnimationFrame(() => {
        pending.raf = null;
        flushPendingStream();
      });
    };

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshSeq = 0;
    const scheduleSessionsRefresh = () => {
      if (refreshTimer != null) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        const ticket = ++refreshSeq;
        void Promise.all([window.okbot.listBots(), window.okbot.listSquads()])
          .then(([nextBots, nextSquads]) => {
            if (ticket !== refreshSeq) return;
            setBots(nextBots);
            setSquads(nextSquads);
            const sel = selectionRef.current;
            if (!sel) return;
            const stillThere =
              sel.kind === 'bot'
                ? nextBots.some((b: { id: string }) => b.id === sel.id)
                : nextSquads.some((s: { id: string }) => s.id === sel.id);
            if (!stillThere) {
              setSelection(null);
              saveLastSelection(null);
            }
          })
          .catch((err) => {
            console.error('[okbot] session list refresh failed', err);
          });
      }, 120);
    };

    const off = window.okbot.onRuntimeEvent((event) => {
      // Other window (Electron or gateway) changed the shared ~/.okbot roster.
      if (event.type === 'sessions_changed') {
        scheduleSessionsRefresh();
        return;
      }

      const isActive =
        (selectionRef.current?.kind === 'bot' || selectionRef.current?.kind === 'squad') &&
        selectionRef.current.id === event.botId;

      // Hot-reload signal — catalog reloads on next turn; no transcript mutation.
      if (event.type === 'skills_changed') {
        return;
      }

      if (event.type === 'user_message') {
        // HTTP/API turns have no local send in flight; still show Stop.
        setBusyByBot((prev) => (prev[event.botId] ? prev : { ...prev, [event.botId]: true }));
        setTurnPhaseByBot((prev) =>
          prev[event.botId] ? prev : { ...prev, [event.botId]: 'thinking' },
        );
        if (isActive) {
          setMessages((prev) => {
            const byId = prev.findIndex((m) => m.id === event.message.id);
            if (byId >= 0) {
              const next = [...prev];
              next[byId] = event.message;
              return next;
            }
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].role === 'user' && String(prev[i].id).startsWith('local_')) {
                const next = [...prev];
                next[i] = event.message;
                return next;
              }
            }
            return [...prev, event.message];
          });
        }
        return;
      }

      if (event.type === 'assistant_message') {
        if (isActive) {
          setMessages((prev) => {
            const byId = prev.findIndex((m) => m.id === event.message.id);
            if (byId >= 0) {
              const next = [...prev];
              next[byId] = event.message;
              return next;
            }
            return [...prev, event.message];
          });
        }
        return;
      }

      if (event.type === 'tool_request') {
        // Flush any coalesced deltas before clearing pre-tool think-aloud.
        flushPendingStream();
        delete streamingPreviewRef.current[event.messageId];
        delete pending.messageDeltas[event.messageId];
        delete pending.previewByBot[event.botId];
        if (isActive) {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === event.messageId);
            if (idx < 0 || !prev[idx].content) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], content: '' };
            return next;
          });
        }

        setToolCardsByBot((prev) => {
          const list = prev[event.botId] ?? [];
          if (list.some((c) => c.requestId === event.requestId)) return prev;
          return {
            ...prev,
            [event.botId]: [
              ...list,
              {
                requestId: event.requestId,
                messageId: event.messageId,
                toolName: event.toolName,
                arguments: event.arguments,
                status: 'pending',
              },
            ],
          };
        });
        setBusyByBot((prev) => ({ ...prev, [event.botId]: true }));
        setTurnPhaseByBot((prev) => ({ ...prev, [event.botId]: 'awaiting_approval' }));
        return;
      }
      if (event.type === 'tool_result') {
        setToolCardsByBot((prev) => ({
          ...prev,
          [event.botId]: (prev[event.botId] ?? []).map((c) =>
            c.requestId === event.requestId
              ? {
                  ...c,
                  status: event.approved ? 'approved' : 'denied',
                  output: event.output,
                }
              : c,
          ),
        }));
        if (event.approved) {
          const phase: TurnPhase =
            event.toolName === 'run_shell' ? 'running_shell' : 'running_tool';
          setTurnPhaseByBot((prev) => ({ ...prev, [event.botId]: phase }));
        } else {
          setTurnPhaseByBot((prev) => ({ ...prev, [event.botId]: 'thinking' }));
        }
        return;
      }
      if (event.type === 'done' || event.type === 'error') {
        flushPendingStream();
        const inFlight = sendsInFlightRef.current[event.botId] || 0;
        // Steer: an older aborted run's done must not clear busy while a newer send awaits.
        if (inFlight === 0) {
          setBusyByBot((prev) => ({ ...prev, [event.botId]: false }));
          setTurnPhaseByBot((prev) => {
            if (!(event.botId in prev)) return prev;
            const next = { ...prev };
            delete next[event.botId];
            return next;
          });
        } else {
          // Final content is on screen but chatStart IPC is still wrapping up
          // (persist, AGENTS/skills/memory refresh). Keep busy via sendsInFlight;
          // show wrapping_up instead of lingering on replying.
          // Skip aborted done / inFlight>1 so a steer leftover does not clobber
          // the newer send's thinking/replying phase.
          const isAbortedDone = event.type === 'done' && !!event.aborted;
          if (!isAbortedDone && inFlight === 1) {
            setTurnPhaseByBot((prev) => ({ ...prev, [event.botId]: 'wrapping_up' }));
          }
        }
        if (event.type === 'done' && !isActive && !event.aborted) {
          markSessionUnread(event.botId, true);
        }
        if (event.type === 'error' && !isActive) {
          markSessionUnread(event.botId, true);
        }
      }

      if (event.type === 'delta') {
        const soFar = (streamingPreviewRef.current[event.messageId] || '') + event.delta;
        streamingPreviewRef.current[event.messageId] = soFar;
        pending.previewByBot[event.botId] = soFar;
        pending.replyPhaseBots.add(event.botId);
        if (isActive) {
          pending.messageDeltas[event.messageId] =
            (pending.messageDeltas[event.messageId] || '') + event.delta;
        }
        scheduleStreamFlush();
        return;
      } else if (event.type === 'done') {
        delete streamingPreviewRef.current[event.messageId];
        const text = plainTextFromMarkdown(stripThinkContent(event.content || ''));
        setBots((prev) =>
          prev.map((b) =>
            b.id === event.botId
              ? {
                  ...b,
                  lastReplyPreview: text,
                  ...(event.aborted ? {} : { onboardingComplete: true }),
                }
              : b,
          ),
        );
      } else if (event.type === 'error') {
        delete streamingPreviewRef.current[event.messageId];
        toast.error(formatSystemError(event.error));
      }

      // Message stream UI only for the active bot; inactive bots keep working state above.
      if (!isActive) return;
      if (event.type !== 'done' && event.type !== 'error') return;

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === event.messageId);
        if (event.type === 'done' || event.type === 'error') {
          if (idx < 0) return prev;
          const next = [...prev];
          const prevContent = next[idx].content || '';
          let nextContent =
            event.type === 'done' ? event.content || '' : prevContent || `${t(lang, 'errorPrefix')}${event.error}`;
          // Stable display: never flash to a shorter "final-only" string while live text
          // already shows the full streamed reply (reload used to fight this too).
          if (
            event.type === 'done' &&
            prevContent.trim() &&
            nextContent.trim() &&
            nextContent.length < prevContent.length
          ) {
            nextContent = prevContent;
          }
          next[idx] = {
            ...next[idx],
            content: nextContent,
            ...(event.type === 'done' && event.usage ? { usage: event.usage } : {}),
          };
          return next;
        }
        return prev;
      });
    });
    return () => {
      off();
      if (refreshTimer != null) clearTimeout(refreshTimer);
      if (pending.raf != null) {
        cancelAnimationFrame(pending.raf);
        pending.raf = null;
      }
    };
  }, []);

  const pinMessagesToBottom = useCallback(() => {
    const box = messagesBoxRef.current;
    if (!box) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      return;
    }
    pinningScrollRef.current = true;
    box.scrollTop = box.scrollHeight;
    requestAnimationFrame(() => {
      box.scrollTop = box.scrollHeight;
      requestAnimationFrame(() => {
        pinningScrollRef.current = false;
        updateScrollFade(box);
      });
    });
  }, []);

  useEffect(() => {
    const key =
      selection?.kind === 'bot'
        ? `bot:${selection.id}`
        : selection?.kind === 'squad'
          ? `squad:${selection.id}`
          : '';
    const switched = scrollSessionKeyRef.current !== key;
    scrollSessionKeyRef.current = key;
    if (switched) {
      stickToBottomRef.current = true;
      setShowJumpToBottom(false);
      pinMessagesToBottom();
      return;
    }
    // Shared for 1:1 and squad: follow only while pinned near bottom.
    if (stickToBottomRef.current) {
      pinMessagesToBottom();
    }
  }, [messages, busy, selection, toolCards, pinMessagesToBottom]);

  useEffect(() => {
    const el = messagesBoxRef.current;
    if (!el) return;

    const distanceFromBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight;

    const syncStickFromUserScroll = () => {
      // Ignore scroll events caused by our own pin (avoids false "scrolled away").
      if (pinningScrollRef.current) return;
      const distance = distanceFromBottom();
      const nearBottom = distance <= AT_BOTTOM_SLACK_PX;
      stickToBottomRef.current = nearBottom;
      const canScroll = el.scrollHeight > el.clientHeight + 1;
      // Hysteresis: only show jump when clearly above the slack band.
      setShowJumpToBottom(canScroll && distance > JUMP_BUTTON_PX);
    };

    let pinRaf: number | null = null;
    const pinIfSticky = () => {
      if (!stickToBottomRef.current) {
        // Content grew while user is reading history — refresh jump affordance.
        const distance = distanceFromBottom();
        const canScroll = el.scrollHeight > el.clientHeight + 1;
        setShowJumpToBottom(canScroll && distance > JUMP_BUTTON_PX);
        return;
      }
      // Coalesce RO/MO storms during streaming into one pin per frame.
      if (pinRaf != null) return;
      pinRaf = requestAnimationFrame(() => {
        pinRaf = null;
        if (!stickToBottomRef.current) return;
        pinningScrollRef.current = true;
        el.scrollTop = el.scrollHeight;
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
          requestAnimationFrame(() => {
            pinningScrollRef.current = false;
            setShowJumpToBottom(false);
            updateScrollFade(el);
          });
        });
      });
    };

    el.addEventListener('scroll', syncStickFromUserScroll, { passive: true });

    // Streaming deltas / tool cards / markdown layout shift height after React commit.
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            pinIfSticky();
          })
        : null;
    const observed = new Set<Element>();
    const observeTree = () => {
      if (!ro) return;
      for (const child of el.children) {
        if (observed.has(child)) continue;
        observed.add(child);
        ro.observe(child);
      }
    };
    observeTree();
    const mo =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            observeTree();
            pinIfSticky();
          })
        : null;
    mo?.observe(el, { childList: true, subtree: true, characterData: true });

    syncStickFromUserScroll();
    return () => {
      el.removeEventListener('scroll', syncStickFromUserScroll);
      if (pinRaf != null) cancelAnimationFrame(pinRaf);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [chatOwnerId, AT_BOTTOM_SLACK_PX, JUMP_BUTTON_PX]);

  useScrollFade(messagesBoxRef, [chatOwnerId]);

  useEffect(() => {
    if (!chatOwnerId) return;
    if (createTarget || profileBot) return;
    if (selectedBot?.onboardingComplete === false) return;
    const id = window.requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [chatOwnerId, selectedBot?.onboardingComplete, createTarget, profileBot]);

  useEffect(() => {
    updateQuoteDraft(null);
  }, [chatOwnerId]);

  useScrollFade(sessionListRef, [bots, squads, sidebarWidth]);

  useEffect(() => {
    const closeMenu = () => setMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    if (!createMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as Node | null;
      if (!el) return;
      if (createMenuRef.current?.contains(el)) return;
      if (newBtnRef.current?.contains(el)) return;
      if (newBtnFooterRef.current?.contains(el)) return;
      setCreateMenu(false);
      setCreateMenuPos(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [createMenu]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleGlobalSearchSelect = useCallback(
    (target: GlobalSearchSelect) => {
      if (target.kind === 'bot') {
        selectSession({ kind: 'bot', id: target.id });
        setHighlightMessageId(null);
        pendingMessageFocusRef.current = null;
        return;
      }
      if (target.kind === 'squad') {
        selectSession({ kind: 'squad', id: target.id });
        setHighlightMessageId(null);
        pendingMessageFocusRef.current = null;
        return;
      }
      if (target.kind === 'settings') {
        setSettingsFocus({ tab: target.tab, sectionId: target.sectionId });
        setSettingsOpen(true);
        return;
      }
      // message
      const sameOwner =
        (selectionRef.current?.kind === 'bot' || selectionRef.current?.kind === 'squad') &&
        selectionRef.current.id === target.botId;
      pendingMessageFocusRef.current = { botId: target.botId, messageId: target.messageId };
      setHighlightMessageId(null);
      if (sameOwner) {
        // Same session: load effect will not re-run — focus directly.
        void (async () => {
          const owner = target.botId;
          const gen = ++historyLoadGenRef.current;
          try {
            const all = await window.okbot.getMessages(owner);
            if (gen !== historyLoadGenRef.current) return;
            if (selectionRef.current?.id !== owner) return;
            setMessages(all);
            setHasMoreOlder(false);
            setOlderBeforeMessageId(null);
            pendingMessageFocusRef.current = null;
            setHighlightMessageId(target.messageId);
          } catch (err) {
            toast.error(formatSystemError(err));
          }
        })();
        return;
      }
      selectSession({ kind: 'bot', id: target.botId });
    },
    [],
  );

  useEffect(() => {
    return () => {
      listeningRef.current = false;
      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    };
  }, []);


  useEffect(() => {
    const gen = ++historyLoadGenRef.current;
    async function load() {
      const owner = chatOwnerId;
      if (!owner) {
        setMessages([]);
        setHasMoreOlder(false);
        setOlderBeforeMessageId(null);
        setHistoryOwnerId(null);
        return;
      }
      // Clear transcript immediately; keep `historyOwnerId` on the previous
      // owner so `messagesLoading` stays true until this fetch settles.
      setMessages([]);
      setHasMoreOlder(false);
      setOlderBeforeMessageId(null);
      const pending = pendingMessageFocusRef.current;
      const wantId =
        pending && pending.botId === owner ? pending.messageId : null;

      try {
        if (wantId) {
          const all = await window.okbot.getMessages(owner);
          if (gen !== historyLoadGenRef.current) return;
          if (selectionRef.current?.id !== owner) return;
          setMessages(all);
          setHasMoreOlder(false);
          setOlderBeforeMessageId(null);
          pendingMessageFocusRef.current = null;
          setHighlightMessageId(wantId);
          setHistoryOwnerId(owner);
          return;
        }

        const page = await window.okbot.getMessagesPage(owner, {
          limit: MESSAGE_PAGE_SIZE,
        });
        if (gen !== historyLoadGenRef.current) return;
        if (selectionRef.current?.id !== owner) return;
        setMessages(page.messages);
        setHasMoreOlder(page.hasMore);
        setOlderBeforeMessageId(page.nextBeforeMessageId);
        setHistoryOwnerId(owner);
      } catch (err) {
        if (gen !== historyLoadGenRef.current) return;
        if (selectionRef.current?.id !== owner) return;
        setMessages([]);
        setHasMoreOlder(false);
        setOlderBeforeMessageId(null);
        setHistoryOwnerId(owner);
        toast.error(formatSystemError(err));
      }
    }
    void load();
  }, [chatOwnerId]);

  useEffect(() => {
    if (!highlightMessageId) return;
    const id = highlightMessageId;
    let tries = 0;
    let cancelled = false;
    const timers: number[] = [];
    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      tries += 1;
      if (tries < 20) timers.push(window.setTimeout(tick, 50));
    };
    timers.push(window.setTimeout(tick, 40));
    timers.push(window.setTimeout(() => setHighlightMessageId(null), 2200));
    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
    // Intentionally omit `messages`: streaming deltas must not re-force scroll to highlight.
  }, [highlightMessageId]);

  useEffect(() => {
    const el = messagesBoxRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop > 48) return;
      void loadOlderMessages();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [chatOwnerId, hasMoreOlder, olderBeforeMessageId]);



  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Hold width steady inside click slop so a click does not nudge then snap.
      if (Math.abs(e.clientX - drag.startX) <= SPLITTER_CLICK_SLOP) return;
      const maxW = Math.min(SIDEBAR_MAX, maxSidebarForWindow());
      let next = Math.min(
        maxW,
        Math.max(SIDEBAR_MIN, drag.startW + (e.clientX - drag.startX)),
      );
      // When main would be < 450, cannot expand past icon rail.
      if (maxW <= SIDEBAR_NARROW_AT) {
        next = SIDEBAR_MIN;
        drag.pinnedCollapsed = true;
      } else if (drag.fromNarrow || drag.pinnedCollapsed) {
        // From rail: keep collapsed until past hysteresis, then re-expand.
        if (next < SIDEBAR_NARROW_AT + SIDEBAR_EXPAND_HYST) {
          next = SIDEBAR_MIN;
        } else {
          drag.pinnedCollapsed = false;
        }
      } else if (next <= SIDEBAR_NARROW_AT) {
        // Expanded drag crossed traffic-light-safe threshold → rail mode.
        next = SIDEBAR_MIN;
        drag.pinnedCollapsed = true;
      }
      setSidebarWidth(next);
    };
    const onUp = (e: MouseEvent) => {
      const drag = dragRef.current;
      const dx = drag ? Math.abs(e.clientX - drag.startX) : SPLITTER_CLICK_SLOP + 1;
      const isClick = !!drag && dx <= SPLITTER_CLICK_SLOP;

      if (isClick && drag) {
        if (!drag.fromNarrow) {
          // Expanded → collapse; remember width for click-restore.
          const remember = Math.min(
            SIDEBAR_MAX,
            Math.max(drag.startW, SIDEBAR_NARROW_AT + 1),
          );
          clickRestoreWidthRef.current = remember;
          lastExpandedWidthRef.current = remember;
          collapseReasonRef.current = 'click';
          manualCollapsedRef.current = true;
          autoCollapsedRef.current = false;
          setSidebarWidth(SIDEBAR_MIN);
        } else if (collapseReasonRef.current === 'click') {
          // Collapsed via click → restore remembered width.
          const target = Math.min(
            SIDEBAR_MAX,
            maxSidebarForWindow(),
            Math.max(clickRestoreWidthRef.current, SIDEBAR_NARROW_AT + 1),
          );
          if (target > SIDEBAR_NARROW_AT) {
            collapseReasonRef.current = null;
            manualCollapsedRef.current = false;
            autoCollapsedRef.current = false;
            lastExpandedWidthRef.current = target;
            setSidebarWidth(target);
          }
        } else {
          // Collapsed via drag (or unknown) → expand to max.
          const target = Math.min(SIDEBAR_MAX, maxSidebarForWindow());
          if (target > SIDEBAR_NARROW_AT) {
            collapseReasonRef.current = null;
            manualCollapsedRef.current = false;
            autoCollapsedRef.current = false;
            lastExpandedWidthRef.current = target;
            setSidebarWidth(target);
          }
        }
      } else {
        const w = sidebarWidthRef.current;
        if (w <= SIDEBAR_NARROW_AT) {
          manualCollapsedRef.current = true;
          autoCollapsedRef.current = false;
          collapseReasonRef.current = 'drag';
          setSidebarWidth(SIDEBAR_MIN);
        } else {
          manualCollapsedRef.current = false;
          autoCollapsedRef.current = false;
          collapseReasonRef.current = null;
          lastExpandedWidthRef.current = w;
        }
      }
      setResizing(false);
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing, maxSidebarForWindow]);

  async function startCreateBot() {
    setCreateMenu(false);
    setCreateMenuPos(null);
    const name = t(lang, 'defaultBotName');
    const emoji = EMOJI_PRESETS[Math.floor(Math.random() * EMOJI_PRESETS.length)];
    try {
      const bot = await window.okbot.createBot({
        name,
        description: '',
        emoji,
        // Empty color → bot-avatars library default accent (用户要「默认颜色」).
        color: '',
        avatarKind: 'bot-avatar',
        botAvatarType: randomBotAvatarType(),
      });
      setBots(await window.okbot.listBots());
      selectSession({ kind: 'bot', id: bot.id });
      setCreateTarget(bot);
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  }

  async function persistBotForm(botId: string, values: BotFormValues) {
    const updated = await window.okbot.updateBot(botId, {
      name: values.name,
      description: values.description,
      emoji: values.emoji,
      color: values.color,
      providerId: values.providerId,
      modelId: values.modelId,
      avatarKind: values.avatarKind,
      botAvatarType: values.botAvatarType,
      ...(values.useGlobalSkills !== undefined
        ? { useGlobalSkills: values.useGlobalSkills === true }
        : {}),
      ...(values.enabledGlobalSkills !== undefined
        ? { enabledGlobalSkills: values.enabledGlobalSkills }
        : {}),
    });
    // If Advanced AGENTS was edited, write after updateBot so it wins over syncAgentsMdProfile.
    if (values.agentsMdTouched && typeof values.agentsMd === 'string') {
      await window.okbot.writeAgentsMd(botId, values.agentsMd);
    }
    return updated;
  }

  async function handleCreateApply(values: BotFormValues) {
    if (!createTarget) return;
    try {
      const updated = await persistBotForm(createTarget.id, values);
      const latest = await window.okbot.listBots();
      setBots(latest.length ? latest : [updated]);
      setCreateTarget(updated);
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  }

  async function handleProfileApply(values: BotFormValues) {
    if (!profileBot) return;
    try {
      const updated = await persistBotForm(profileBot.id, values);
      const latest = await window.okbot.listBots();
      setBots(latest.length ? latest : [updated]);
      setProfileBot(updated);
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  }

  async function commitInlineRename() {
    if (skipRenameCommitRef.current) {
      skipRenameCommitRef.current = false;
      return;
    }
    if (!renameTarget) return;
    const name = renameValue.trim();
    const target = renameTarget;
    const prevName = target.name;
    setRenameTarget(null);
    setRenameValue('');
    if (!name || name === prevName) return;
    try {
      if (target.kind === 'bot') {
        const updated = await window.okbot.updateBot(target.id, { name });
        const latest = await window.okbot.listBots();
        setBots(latest.length ? latest : [updated]);
      } else {
        await window.okbot.updateSquad(target.id, { name });
        setSquads(await window.okbot.listSquads());
      }
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  }

  function cancelInlineRename() {
    skipRenameCommitRef.current = true;
    setRenameTarget(null);
    setRenameValue('');
  }

  async function importAssistantPackage() {
    setCreateMenu(false);
    setCreateMenuPos(null);
    try {
      const res = await window.okbot.importAssistantPackage();
      if (!res || res.canceled || !('bot' in res)) return;
      setBots(await window.okbot.listBots());
      toast.success(t(lang, 'botPackageImported'));
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  }

  function openSquadWizard() {
    setCreateMenu(false);
    setCreateMenuPos(null);
    setError('');
    setSquadWizard({
      name: t(lang, 'squadDefaultName'),
      description: '',
      memberIds: [],
      roles: {},
      providerId: '',
      modelId: '',
    });
  }

  function openSquadEditor(squad: Squad) {
    setCreateMenu(false);
    setCreateMenuPos(null);
    setError('');
    const roles: Record<string, string> = {};
    for (const m of squad.members) roles[m.botId] = m.role || t(lang, 'squadMemberDefaultRole');
    setSquadWizard({
      id: squad.id,
      name: squad.name,
      description: squad.description || '',
      memberIds: squad.members.map((m) => m.botId),
      roles,
      providerId: squad.providerId || '',
      modelId: squad.modelId || '',
    });
  }

  async function submitSquadWizard() {
    if (!squadWizard) return;
    const name = squadWizard.name.trim();
    if (!name) {
      setError(t(lang, 'squadNeedName'));
      return;
    }
    const memberIds = squadWizard.memberIds;
    if (memberIds.length < 2) {
      setError(t(lang, 'squadNeedMembers'));
      return;
    }
    const members: SquadMember[] = memberIds.map((botId) => ({
      botId,
      role: (squadWizard.roles[botId] || '').trim() || t(lang, 'squadMemberDefaultRole'),
    }));
    try {
      if (squadWizard.id) {
        await window.okbot.updateSquad(squadWizard.id, {
          name,
          description: squadWizard.description,
          members,
          providerId: squadWizard.providerId.trim(),
          modelId: squadWizard.modelId.trim(),
        });
        setSquads(await window.okbot.listSquads());
        setSquadWizard(null);
      } else {
        const squad = await window.okbot.createSquad({
          name,
          description: squadWizard.description,
          members,
          providerId: squadWizard.providerId.trim() || undefined,
          modelId: squadWizard.modelId.trim() || undefined,
        });
        setSquads(await window.okbot.listSquads());
        setSquadWizard(null);
        selectSession({ kind: 'squad', id: squad.id });
      }
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  }

  function syncSquadMembers(nextIds: string[]) {
    if (!squadWizard) return;
    const prev = squadWizard.memberIds;
    const keep = prev.filter((id) => nextIds.includes(id));
    const added = nextIds.filter((id) => !prev.includes(id));
    const memberIds = [...keep, ...added];
    const roles = { ...squadWizard.roles };
    for (const id of Object.keys(roles)) {
      if (!memberIds.includes(id)) delete roles[id];
    }
    for (const id of memberIds) {
      if (!roles[id]) roles[id] = t(lang, 'squadMemberDefaultRole');
    }
    setSquadWizard({ ...squadWizard, memberIds, roles });
  }

  function removeSquadMember(id: string) {
    if (!squadWizard) return;
    syncSquadMembers(squadWizard.memberIds.filter((x) => x !== id));
  }

  function reorderSquadMember(fromId: string, toId: string) {
    if (!squadWizard || fromId === toId) return;
    const ids = [...squadWizard.memberIds];
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    setSquadWizard({ ...squadWizard, memberIds: ids });
  }

  

  async function loadOlderMessages() {
    if (!chatOwnerId) return;
    if (!hasMoreOlder || olderBeforeMessageId == null) return;
    if (loadingOlderRef.current) return;
    const box = messagesBoxRef.current;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const prevHeight = box?.scrollHeight ?? 0;
      const prevTop = box?.scrollTop ?? 0;
      const page = await window.okbot.getMessagesPage(chatOwnerId, {
        limit: MESSAGE_PAGE_SIZE,
        beforeMessageId: olderBeforeMessageId,
      });
      if (!page.messages.length) {
        setHasMoreOlder(false);
        setOlderBeforeMessageId(null);
        return;
      }
      const olderCount = page.messages.length;
      setMessages((prev) => {
        const seen = new Set(prev.map((m: ChatMessage) => m.id));
        const older = page.messages.filter((m: ChatMessage) => !seen.has(m.id));
        return older.length ? [...older, ...prev] : prev;
      });
      setHasMoreOlder(page.hasMore);
      setOlderBeforeMessageId(page.nextBeforeMessageId);
      // Remeasure after paint so concurrent stream growth does not drift the baseline.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = messagesBoxRef.current;
          if (!el || olderCount <= 0) return;
          el.scrollTop = el.scrollHeight - prevHeight + prevTop;
        });
      });
    } catch (err) {
      toast.error(formatSystemError(err));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }

  async function respondTool(requestId: string, approved: boolean) {
    const botId = chatOwnerId;
    if (!botId) return;
    const card = (toolCardsByBot[botId] ?? []).find((c) => c.requestId === requestId);
    setToolCardsByBot((prev) => ({
      ...prev,
      [botId]: (prev[botId] ?? []).map((c) =>
        c.requestId === requestId && c.status === 'pending'
          ? { ...c, status: approved ? 'approved' : 'denied' }
          : c,
      ),
    }));
    if (approved) {
      const phase: TurnPhase =
        card?.toolName === 'run_shell' ? 'running_shell' : 'running_tool';
      setTurnPhaseByBot((prev) => ({ ...prev, [botId]: phase }));
    } else {
      setTurnPhaseByBot((prev) => ({ ...prev, [botId]: 'thinking' }));
    }
    try {
      await window.okbot.toolRespond({
        requestId,
        approved,
        message: approved ? undefined : '用户拒绝了该工具调用',
      });
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  }

  async function respondToolForever(card: { requestId: string; toolName: string }) {
    if (settings) {
      try {
        const key = card.toolName.trim().toLowerCase();
        const prevRules = settings.autoApprovalRules ?? [];
        const now = new Date().toISOString();
        let rewrittenAsk = false;
        const nextRules = [];
        let hasAllow = false;
        for (const r of prevRules) {
          if (r.description.trim().toLowerCase() !== key) {
            nextRules.push(r);
            continue;
          }
          if (r.action === 'allow') {
            hasAllow = true;
            nextRules.push(r);
          } else if (r.action === 'ask') {
            // Ask rules win over allow in main-process matching — rewrite to allow.
            rewrittenAsk = true;
            hasAllow = true;
            nextRules.push({ ...r, action: 'allow' as const, updatedAt: now });
          } else {
            nextRules.push(r);
          }
        }
        if (!hasAllow) {
          nextRules.push({
            id: createId('aar'),
            description: card.toolName,
            action: 'allow' as const,
            createdAt: now,
            updatedAt: now,
          });
        }
        const saved = await window.okbot.saveSettings({
          ...settings,
          autoApprovalEnabled: true,
          autoApprovalRules: nextRules,
        });
        setSettings(saved);
        if (rewrittenAsk) {
          toast.success(t(lang, 'autoAllowRewroteAsk'));
        }
      } catch (err) {
        toast.error(formatSystemError(err));
      }
    }
    await respondTool(card.requestId, true);
  }

async function handleSend(retry?: {
    localId: string;
    text: string;
    quoteMessageId?: string;
    quotePreview?: string;
    attachments?: ChatMessage['attachments'];
  }) {
    if (!chatOwnerId) return;
    if (!selectedBot && !selectedSquad) return;
    const ownerId = chatOwnerId;
    const kind = selectedSquad ? 'squad' : 'bot';
    const isRetry = !!retry;
    const rawBody = isRetry ? retry!.text.trim() : (draftRef.current || draft).trim();
    const pendingAtts = isRetry ? [] : attachmentsRef.current;
    const structuredAtts: ChatMessage['attachments'] = isRetry
      ? retry!.attachments
      : pendingAtts.length
        ? pendingAtts.map(({ kind, path, name }) => ({ kind, path, name }))
        : undefined;
    const text = isRetry
      ? rawBody
      : formatMessageWithAttachments(rawBody, structuredAtts ?? []);
    if (!text) return;
    const quote = isRetry
      ? retry!.quoteMessageId
        ? { messageId: retry!.quoteMessageId, preview: retry!.quotePreview || '' }
        : null
      : quoteDraftRef.current ?? quoteDraft;
    const quoteMessageId = (quote?.messageId || '').trim();
    const quotePreview = (quote?.preview || '').trim();
    if (!isRetry && (listeningRef.current || mediaRecorderRef.current)) {
      void stopVoiceRecording(false);
    }
    if (!isRetry) {
      updateDraft('');
      updateQuoteDraft(null);
      updateAttachments([]);
    }
    setError('');
    // Always jump to bottom on send and re-enable stick-to-bottom.
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    requestAnimationFrame(() => pinMessagesToBottom());
    setToolCardsByBot((prev) => ({ ...prev, [ownerId]: [] }));
    sendsInFlightRef.current[ownerId] = (sendsInFlightRef.current[ownerId] || 0) + 1;
    setBusyByBot((prev) => ({ ...prev, [ownerId]: true }));
    setTurnPhaseByBot((prev) => ({ ...prev, [ownerId]: 'thinking' }));
    requestAnimationFrame(() => composerRef.current?.focus());
    const localId = isRetry ? retry!.localId : `local_${Date.now()}`;
    if (isRetry) {
      setMessages((prev) =>
        prev.map((m) => (m.id === localId ? { ...m, sendStatus: 'pending' as const } : m)),
      );
    } else {
      const tempUser: ChatMessage = {
        id: localId,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
        sendStatus: 'pending',
        ...(quoteMessageId && quotePreview ? { quoteMessageId, quotePreview } : {}),
        ...(structuredAtts?.length ? { attachments: structuredAtts } : {}),
      };
      setMessages((m) => [...m, tempUser]);
      if (kind === 'bot') {
        setBots((prev) => {
          const idx = prev.findIndex((b) => b.id === ownerId);
          if (idx <= 0) return prev;
          const next = [...prev];
          const [bot] = next.splice(idx, 1);
          next.unshift({ ...bot, updatedAt: new Date().toISOString() });
          return next;
        });
      } else {
        setSquads((prev) => {
          const idx = prev.findIndex((s) => s.id === ownerId);
          if (idx <= 0) return prev;
          const next = [...prev];
          const [squad] = next.splice(idx, 1);
          next.unshift({ ...squad, updatedAt: new Date().toISOString() });
          return next;
        });
      }
    }
    try {
      const sendOpts = {
        ...(quoteMessageId ? { quoteMessageId } : {}),
        ...(structuredAtts?.length ? { attachments: structuredAtts } : {}),
        ...(selectedComputerId && selectedComputerId !== 'local'
          ? { computerId: selectedComputerId }
          : { computerId: selectedComputerId || 'local' }),
      };
      if (kind === 'squad') await window.okbot.chatStartSquad(ownerId, text, sendOpts);
      else await window.okbot.chatStart(ownerId, text, sendOpts);
      // Mark optimistic bubble sent (user_message event may replace local_ id shortly).
      if (selectionRef.current?.kind === kind && selectionRef.current.id === ownerId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === localId && m.sendStatus ? { ...m, sendStatus: 'sent' as const } : m,
          ),
        );
      }
      // Do not replace the live transcript after send: getMessagesPage can reintroduce
      // SDK session think-aloud rows that were cleared mid-turn, causing a flicker
      // (formal-only → 1+2+3). Stream events already hold the stable bubble(s).
      setBots(await window.okbot.listBots());
      setSquads(await window.okbot.listSquads());
    } catch (err) {
      // Steer/Stop abort of an older in-flight chatStart must not toast or mark failed.
      if (isAbortLikeError(err)) {
        if (selectionRef.current?.kind === kind && selectionRef.current.id === ownerId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === localId && m.sendStatus ? { ...m, sendStatus: 'sent' as const } : m,
            ),
          );
        }
      } else {
        toast.error(formatSystemError(err));
        // Keep the local bubble with a retry affordance — do not wipe it via getMessagesPage.
        if (selectionRef.current?.kind === kind && selectionRef.current.id === ownerId) {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === localId);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], sendStatus: 'failed' };
              return next;
            }
            // Bubble missing (e.g. race) — re-insert failed local so retry stays available.
            return [
              ...prev,
              {
                id: localId,
                role: 'user' as const,
                content: text,
                createdAt: new Date().toISOString(),
                sendStatus: 'failed' as const,
                ...(quoteMessageId && quotePreview ? { quoteMessageId, quotePreview } : {}),
                ...(structuredAtts?.length ? { attachments: structuredAtts } : {}),
              },
            ];
          });
        }
        try {
          setBots(await window.okbot.listBots());
          setSquads(await window.okbot.listSquads());
        } catch {
          /* ignore */
        }
      }
    } finally {
      sendsInFlightRef.current[ownerId] = Math.max(
        0,
        (sendsInFlightRef.current[ownerId] || 1) - 1,
      );
      if ((sendsInFlightRef.current[ownerId] || 0) === 0) {
        setBusyByBot((prev) => ({ ...prev, [ownerId]: false }));
        setTurnPhaseByBot((prev) => {
          if (!(ownerId in prev)) return prev;
          const next = { ...prev };
          delete next[ownerId];
          return next;
        });
      }
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }

  function handleRetrySend(message: ChatMessage) {
    if (message.role !== 'user' || message.sendStatus !== 'failed') return;
    const text = (message.content || '').trim();
    if (!text) return;
    void handleSend({
      localId: message.id,
      text,
      quoteMessageId: message.quoteMessageId,
      quotePreview: message.quotePreview,
      attachments: message.attachments,
    });
  }

  function handleStop() {
    if (!chatOwnerId || !busy) return;
    const ownerId = chatOwnerId;
    // Drop in-flight send counts so an aborted steer restart cannot keep the beam on.
    sendsInFlightRef.current[ownerId] = 0;
    void window.okbot.chatAbort(ownerId);
    setBusyByBot((prev) => ({ ...prev, [ownerId]: false }));
    setTurnPhaseByBot((prev) => {
      if (!(ownerId in prev)) return prev;
      const next = { ...prev };
      delete next[ownerId];
      return next;
    });
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function handleQuoteMessage(message: ChatMessage) {
    const raw = message.content || '';
    const forQuote =
      message.role === 'assistant'
        ? stripThinkContent(raw)
        : resolveMessageAttachments(message).body;
    const preview = clipQuotePreview(forQuote);
    if (!message.id || !preview) return;
    updateQuoteDraft({ messageId: message.id, preview });
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function handleCopyMessage(message: ChatMessage): Promise<boolean> {
    const raw = message.content || '';
    const text = (
      message.role === 'assistant'
        ? stripThinkContent(raw)
        : resolveMessageAttachments(message).body
    ).trim();
    if (!text) return false;
    try {
      await copyTextToClipboard(text);
      return true;
    } catch (err) {
      toast.error(formatSystemError(err));
      return false;
    }
  }

  async function jumpToQuotedMessage(messageId: string) {
    const id = (messageId || '').trim();
    if (!id || !chatOwnerId) return;
    if (messages.some((m) => m.id === id)) {
      setHighlightMessageId(id);
      return;
    }
    try {
      const all = await window.okbot.getMessages(chatOwnerId);
      setMessages(all);
      setHasMoreOlder(false);
      setOlderBeforeMessageId(null);
      setHighlightMessageId(id);
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  }

  function releaseMicStream() {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    setMicStream(null);
  }

  function micPermissionHint() {
    const p = electronAppPathRef.current;
    return t(lang, 'micPermissionHint', { path: p ? ` ${p}` : '' });
  }

  async function openMicStream(): Promise<MediaStream | null> {
    if (typeof window.okbot.ensureMicrophoneAccess === 'function') {
      try {
        const access = await window.okbot.ensureMicrophoneAccess();
        if (access.electronAppPath) electronAppPathRef.current = access.electronAppPath;
      } catch {
        /* continue */
      }
    }

    const result = await openMicStreamHelper(settings?.microphoneId);
    if (result.ok) return result.stream;
    if (result.kind === 'unavailable') {
      setError(t(lang, 'micUnavailable'));
      return null;
    }
    if (result.kind === 'no-device') {
      setError(t(lang, 'micNoDevice'));
      return null;
    }
    if (result.kind === 'permission') {
      setError(micPermissionHint());
      void window.okbot.openMicrophoneSettings?.();
      return null;
    }
    setError(result.message || t(lang, 'micOpenFailed'));
    return null;
  }

  async function stopVoiceRecording(transcribe: boolean) {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      listeningRef.current = false;
      setListening(false);
      setVoiceStatusLabel('');
      releaseMicStream();
      return;
    }

    const chunks = mediaChunksRef.current;
    const mime = recorder.mimeType || 'audio/webm';
    const finished = new Promise<Blob>((resolve) => {
      const finish = () => {
        const blob = new Blob(chunks, { type: mime });
        mediaChunksRef.current = [];
        resolve(blob);
      };
      if (recorder.state === 'inactive') {
        finish();
        return;
      }
      recorder.addEventListener('stop', finish, { once: true });
      try {
        recorder.stop();
      } catch {
        finish();
      }
    });

    mediaRecorderRef.current = null;
    listeningRef.current = false;
    setListening(false);
    releaseMicStream();

    const blob = await Promise.race([
      finished,
      new Promise<Blob>((resolve) => {
        window.setTimeout(() => resolve(new Blob(chunks, { type: mime })), 1200);
      }),
    ]);

    if (!transcribe) {
      setVoiceStatusLabel('');
      return;
    }
    if (blob.size < 64) {
      setVoiceStatusLabel('');
      setError(t(lang, 'speechTooShort'));
      return;
    }

    voiceBusyRef.current = true;
    setError('');
    setVoiceStatusLabel(t(lang, 'speechModelLoading'));
    // Keep composer locked while recognizing (reuse listening UI chrome).
    setListening(true);
    try {
      setVoiceStatusLabel(t(lang, 'speechRecognizing'));
      const audio = await blobToWhisperAudio(blob);
      const text = await transcribeWithLocalWhisper(audio, lang, (prog) => {
        if (prog.status === 'progress' || prog.status === 'download') {
          setVoiceStatusLabel(t(lang, 'speechModelLoading'));
        }
      });
      if (!text) {
        setError(t(lang, 'speechEmpty'));
      } else {
        const next = ((draftRef.current || '') + (draftRef.current ? ' ' : '') + text).trim();
        updateDraft(next);
      }
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t(lang, 'speechRecognizeFailed', { error: msg }));
    } finally {
      voiceBusyRef.current = false;
      setListening(false);
      setVoiceStatusLabel('');
    }
  }

  async function startVoiceRecording() {
    if (listeningRef.current || mediaRecorderRef.current || voiceBusyRef.current) return;
    if (typeof MediaRecorder === 'undefined') {
      setError(t(lang, 'speechUnsupported'));
      return;
    }

    const stream = await openMicStream();
    if (!stream) return;

    mediaStreamRef.current = stream;
    setMicStream(stream);
    mediaChunksRef.current = [];
    const mime = pickRecorderMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (err) {
      releaseMicStream();
      setError(err instanceof Error ? err.message : t(lang, 'speechUnsupported'));
      return;
    }

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) mediaChunksRef.current.push(ev.data);
    };
    mediaRecorderRef.current = recorder;
    listeningRef.current = true;
    setListening(true);
    setVoiceStatusLabel(t(lang, 'listeningRecord'));
    setError('');
    recorder.start(250);
  }

  async function toggleVoice() {
    if (listeningRef.current || mediaRecorderRef.current) {
      await stopVoiceRecording(true);
      return;
    }
    if (voiceBusyRef.current || startingVoiceRef.current) return;
    startingVoiceRef.current = true;
    try {
      await startVoiceRecording();
    } finally {
      startingVoiceRef.current = false;
    }
  }



  function updateDockMagnify(clientY: number) {
    const root = sessionListRef.current;
    if (!root) return;
    // Setting default OFF: only magnify when explicitly enabled in General settings.
    if (settings?.sidebarDockMagnify !== true) {
      lastDockYRef.current = null;
      setDockScales((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }
    lastDockYRef.current = clientY;
    const next: Record<string, number> = {};
    // Measure the unscaled row hit-target (scale lives on the avatar only).
    root.querySelectorAll<HTMLElement>('[data-session-id]').forEach((node) => {
      const id = node.dataset.sessionId;
      if (!id) return;
      const rect = node.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const dist = Math.abs(clientY - mid);
      const range = 64;
      const u = Math.max(0, 1 - dist / range);
      const eased = u * u * (3 - 2 * u);
      next[id] = 1 + 0.18 * eased; // subtle Dock bump (~1.18 max)
    });
    setDockScales(next);
  }

  function buildDockTip(node: HTMLElement, target: DockTipTarget) {
    // Re-measure at show time (scroll / dock scale may have moved the wrap).
    const rect = node.getBoundingClientRect();
    const top = rect.top + rect.height / 2;
    const left = rect.right + 10;
    if (target.kind === 'bot') {
      const bot = target.bot;
      return {
        kind: 'bot' as const,
        id: bot.id,
        name: bot.name,
        emoji: bot.emoji,
        color: bot.color,
        avatarKind: bot.avatarKind,
        botAvatarType: bot.botAvatarType,
        preview: stripThinkContent((bot.lastReplyPreview || '').trim()),
        top,
        left,
      };
    }
    const squad = target.squad;
    return {
      kind: 'squad' as const,
      id: squad.id,
      name: squad.name,
      members: target.members,
      preview: (stripThinkContent(squad.lastReplyPreview || '').trim() || squad.description || t(lang, 'squadDesc')).trim(),
      top,
      left,
    };
  }

  function placeDockTipFor(node: HTMLElement, target: DockTipTarget) {
    // Entering a session cancels a pending grace-hide (sliding across rows).
    clearDockTipHideTimer();
    const showNow = () => {
      dockTipTimerRef.current = null;
      dockTipVisibleRef.current = true;
      setDockTip(buildDockTip(node, target));
    };
    // Once open, update content/position immediately — no re-delay between sessions.
    if (dockTipVisibleRef.current) {
      clearDockTipTimer();
      showNow();
      return;
    }
    // First show: short dwell so quick passes don't flash.
    clearDockTipTimer();
    dockTipTimerRef.current = setTimeout(showNow, DOCK_TIP_SHOW_DELAY_MS);
  }

  function openCreateMenu(e: React.MouseEvent) {
    e.stopPropagation();
    // Read the button rect now — e.currentTarget is cleared after the handler,
    // and nesting setState inside another updater is unsafe under StrictMode.
    if (createMenu) {
      setCreateMenu(false);
      setCreateMenuPos(null);
      return;
    }
    const el = e.currentTarget as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    setCreateMenu(true);
    if (narrow && rect) {
      // Top of create submenu aligns with top of the + control (not mid-point),
      // so the menu stays out of the session dock-tip hover zone above.
      setCreateMenuPos({
        top: rect.top,
        left: rect.right + 10,
      });
    } else {
      setCreateMenuPos(null);
    }
  }

  async function cycleTheme() {
    if (!settings) return;
    const order: ThemeMode[] = ['system', 'light', 'dark'];
    const idx = order.indexOf(settings.theme);
    const next = order[(idx >= 0 ? idx + 1 : 1) % order.length];
    applyTheme(next);
    try {
      const saved = await window.okbot.saveSettings({ ...settings, theme: next });
      setSettings(saved);
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  }

  function themeModeLabel(mode: ThemeMode) {
    if (mode === 'light') return t(lang, 'themeLight');
    if (mode === 'dark') return t(lang, 'themeDark');
    return t(lang, 'themeSystem');
  }

  // Stable identities for memo(SessionSidebar) / memo(ChatTranscript).
  const onOpenSearch = useCallback(() => setSearchOpen(true), []);
  const onToggleImmersiveChat = useCallback(() => setImmersiveChat((v) => !v), []);
  const onStartCreateBot = useCallback(() => {
    void startCreateBot();
  }, [lang]);
  const onCommitRename = useCallback(() => {
    void commitInlineRename();
  }, [renameTarget, renameValue, bots, squads]);
  const onOpenSettings = useCallback(() => {
    setSettingsFocus(null);
    setSettingsOpen(true);
  }, []);
  const onDockScroll = useCallback(() => {
    const y = lastDockYRef.current;
    if (y != null) updateDockMagnify(y);
    setDockTip((prev) => {
      if (!prev) return prev;
      const root = sessionListRef.current;
      if (!root) return prev;
      const node = root.querySelector<HTMLElement>(
        `[data-session-id="${prev.kind}:${prev.id}"]`,
      );
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const top = rect.top + rect.height / 2;
      const left = rect.right + 10;
      if (Math.abs(prev.top - top) < 0.5 && Math.abs(prev.left - left) < 0.5) {
        return prev;
      }
      return { ...prev, top, left };
    });
  }, []);
  const onDockMouseLeave = useCallback(() => {
    lastDockYRef.current = null;
    setDockScales({});
    scheduleHideDockTip();
  }, []);
  const onOpenPromptContext = useCallback((id: string) => {
    void openPromptContext(id);
  }, []);
  const onQuoteMessage = useCallback((message: ChatMessage) => {
    handleQuoteMessage(message);
  }, []);
  const onCopyMessage = useCallback((message: ChatMessage) => {
    return handleCopyMessage(message);
  }, [lang]);
  const onViewTokenUsage = useCallback((message: ChatMessage) => {
    setTokenUsageView({ messageId: message.id, usage: message.usage });
  }, []);
  const onJumpToQuotedMessage = useCallback((id: string) => {
    void jumpToQuotedMessage(id);
  }, [chatOwnerId, messages]);
  const onJumpToBottom = useCallback(() => {
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    pinMessagesToBottom();
  }, [pinMessagesToBottom]);
  const onRetrySend = useCallback((message: ChatMessage) => {
    handleRetrySend(message);
  }, [chatOwnerId, selectedBot, selectedSquad, draft, quoteDraft, lang]);
  const onBotOnboardingDone = useCallback((updated: Bot) => {
    setBots((prev) => prev.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)));
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);
  const onApproveTool = useCallback((requestId: string) => {
    void respondTool(requestId, true);
  }, [chatOwnerId, toolCardsByBot, settings]);
  const onDenyTool = useCallback((requestId: string) => {
    void respondTool(requestId, false);
  }, [chatOwnerId, toolCardsByBot]);
  const onApproveToolForever = useCallback(
    (card: ToolCard) => {
      void respondToolForever(card);
    },
    [chatOwnerId, settings],
  );
  const onSend = useCallback(() => {
    void handleSend();
  }, [
    chatOwnerId,
    draft,
    quoteDraft,
    selectedBot,
    selectedSquad,
    settings,
  ]);
  const onToggleVoice = useCallback(() => {
    void toggleVoice();
  }, [listening, settings, busy]);
  const onClearQuote = useCallback(() => updateQuoteDraft(null), []);

  const composerPlaceholder = selectedSquad
    ? t(lang, 'squadComposerPlaceholder', { name: selectedSquad.name })
    : selectedBot
      ? t(lang, 'composerPlaceholder', { name: selectedBot.name })
      : '';

  const composerSlot = useMemo(
    () => (
      <ChatComposer
        lang={lang}
        listening={listening}
        busy={busy}
        draft={draft}
        quote={quoteDraft}
        attachments={attachments}
        micStream={micStream}
        voiceStatusLabel={voiceStatusLabel}
        placeholder={composerPlaceholder}
        composerRef={composerRef}
        onDraftChange={updateDraft}
        onClearQuote={onClearQuote}
        onRemoveAttachment={onRemoveAttachment}
        onPickAttach={onPickAttach}
        onSend={onSend}
        onStop={handleStop}
        onToggleVoice={onToggleVoice}
            computers={[
              { id: 'local', name: lang === 'en' ? 'Local' : '本机' },
              ...(settings?.computers ?? []).map((c) => ({ id: c.id, name: c.name })),
            ]}
            computerId={selectedComputerId}
            onComputerIdChange={(id) => {
              setSelectedComputerId(id);
              try {
                localStorage.setItem('okbot.selectedComputerId', id);
              } catch {
                /* ignore */
              }
            }}
      />
    ),
    [
      lang,
      listening,
      busy,
      draft,
      quoteDraft,
      attachments,
      micStream,
      voiceStatusLabel,
      composerPlaceholder,
      onClearQuote,
      onRemoveAttachment,
      onPickAttach,
      onSend,
      handleStop,
      onToggleVoice,
    ],
  );

  return (
    <div
      className={`app ${narrow ? 'narrow' : ''}${resizing ? ' is-resizing' : ''}${immersiveChat ? ' immersive' : ''}`}
      style={{ ['--sidebar-w' as string]: `${sidebarWidth}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <SessionSidebar
        sidebarRef={sidebarRef}
        lang={lang}
        narrow={narrow}
        createMenu={createMenu}
        createMenuPos={createMenuPos}
        sessions={sessions}
        selection={selection}
        bots={bots}
        renameTarget={renameTarget}
        renameValue={renameValue}
        dockScales={dockScales}
        sessionListRef={sessionListRef}
        createMenuRef={createMenuRef}
        newBtnRef={newBtnRef}
        newBtnFooterRef={newBtnFooterRef}
        botIsWorking={botIsWorking}
        sessionHasUnread={sessionHasUnread}
        onOpenSearch={onOpenSearch}
        onOpenCreateMenu={openCreateMenu}
        onStartCreateBot={onStartCreateBot}
        onOpenSquadWizard={openSquadWizard}
        onImportAssistant={() => {
          void importAssistantPackage();
        }}
        onSelect={selectSession}
        onOpenSessionMenu={setMenu}
        onRenameValueChange={setRenameValue}
        onCommitRename={onCommitRename}
        onCancelRename={cancelInlineRename}
        onOpenSettings={onOpenSettings}
        onDockMouseMove={updateDockMagnify}
        onDockScroll={onDockScroll}
        onDockMouseLeave={onDockMouseLeave}
        onPlaceDockTip={placeDockTipFor}
      />

      <div
        className={`sidebar-resize ${resizing ? 'active' : ''}`}
        onMouseDown={(e) => {
          e.preventDefault();
          // Sync to rendered width so a mid-transition drag starts from the visual position.
          const renderedW = readSidebarRenderedWidth();
          if (Math.abs(renderedW - sidebarWidthRef.current) > 0.5) {
            setSidebarWidth(renderedW);
          }
          const fromNarrow = renderedW <= SIDEBAR_NARROW_AT;
          dragRef.current = {
            startX: e.clientX,
            startW: renderedW,
            fromNarrow,
            pinnedCollapsed: fromNarrow,
          };
          setResizing(true);
        }}
        title={t(lang, 'resizeSidebar')}
      />

      <main className="main">
        <div className="main-topdrag" />
        {!selection && <ChatWatermark />}
        {!selection && platform === 'win32' ? (
          <div className="window-controls-float">
            <WindowControls lang={lang} />
          </div>
        ) : null}

        {(selectedBot || selectedSquad) && (
          <div className="chat-pane">
            <div className="main-header">
              {selectedBot ? (
                <button
                  type="button"
                  className="header-identity"
                  title={t(lang, 'profile')}
                  aria-label={t(lang, 'profile')}
                  onClick={() => setProfileBot(selectedBot)}
                >
                  <FlatAvatar
                    className="header-avatar"
                    emoji={selectedBot.emoji}
                    color={selectedBot.color}
                    avatarKind={selectedBot.avatarKind}
                    botAvatarType={selectedBot.botAvatarType}
                    busy={botIsWorking(selectedBot.id)}
                  />
                  <h1>{selectedBot.name}</h1>
                </button>
              ) : selectedSquad ? (
                <button
                  type="button"
                  className="header-identity"
                  title={t(lang, 'squadProfile')}
                  aria-label={t(lang, 'squadProfile')}
                  onClick={() => openSquadEditor(selectedSquad)}
                >
                  <span className="header-avatar">
                    <SquadAvatar
                      members={selectedSquad.members
                        .map((m) => bots.find((b) => b.id === m.botId))
                        .filter((b): b is Bot => !!b)
                        .map((b) => ({ emoji: b.emoji, color: b.color }))}
                    />
                  </span>
                  <h1>{selectedSquad.name}</h1>
                </button>
              ) : null}
              <div className="header-actions">
                {(() => {
                  const phase = updaterStatus?.phase;
                  if (
                    !updaterStatus ||
                    (phase !== 'available' &&
                      phase !== 'downloading' &&
                      phase !== 'downloaded')
                  ) {
                    return null;
                  }
                  const autoUpdateOn = settings?.autoUpdate !== false;
                  // Auto-update ON: header tracks download → install (no settings jump).
                  // Auto-update OFF: badge on "available" opens Settings → Auto-update.
                  const showBadge = !autoUpdateOn && phase === 'available';
                  const isDownloading = phase === 'downloading';
                  const isReady = phase === 'downloaded';
                  const title = isReady
                    ? t(lang, 'updateDownloaded')
                    : isDownloading
                      ? t(lang, 'updateDownloading', {
                          progress: String(updaterStatus.progress ?? 0),
                        })
                      : showBadge
                        ? t(lang, 'newVersionFound')
                        : t(lang, 'updateAvailable', {
                            version: updaterStatus.availableVersion ?? '',
                          });
                  const aria = isReady
                    ? t(lang, 'installUpdate')
                    : isDownloading
                      ? t(lang, 'downloadingUpdate')
                      : showBadge
                        ? t(lang, 'newVersionFound')
                        : t(lang, 'downloadUpdate');
                  return (
                    <button
                      type="button"
                      className={`header-icon-btn header-update-btn${
                        isDownloading
                          ? ' downloading'
                          : isReady
                            ? ' ready'
                            : ' available'
                      }${showBadge ? ' has-badge' : ''}`}
                      title={title}
                      aria-label={aria}
                      disabled={isDownloading && autoUpdateOn}
                      onClick={() => {
                        if (isReady) {
                          void window.okbot.updaterInstall();
                          return;
                        }
                        if (isDownloading) return;
                        // available (auto-update OFF, or brief ON before auto-download)
                        setSettingsFocus({ tab: 'updates', sectionId: 'autoUpdate' });
                        setSettingsOpen(true);
                      }}
                    >
                      {isReady ? <InstallUpdateIcon /> : <DownloadUpdateIcon />}
                    </button>
                  );
                })()}
                <button
                  type="button"
                  className="header-icon-btn"
                  title={t(lang, 'copyRequestUrl')}
                  aria-label={t(lang, 'copyRequestUrl')}
                  onClick={() => void copyLocalHttpRequestUrl()}
                >
                  <CopyRequestUrlIcon />
                </button>
                <button
                  type="button"
                  className="header-icon-btn"
                  title={t(lang, 'runTraceButton')}
                  aria-label={t(lang, 'runTraceButton')}
                  onClick={() => void openRunTrace()}
                >
                  <RunTraceIcon />
                </button>
                <button
                  type="button"
                  className="header-icon-btn"
                  title={t(lang, 'themeCycle', {
                    mode: themeModeLabel(settings?.theme ?? 'system'),
                  })}
                  aria-label={t(lang, 'themeCycle', {
                    mode: themeModeLabel(settings?.theme ?? 'system'),
                  })}
                  onClick={() => void cycleTheme()}
                >
                  <ThemeModeIcon mode={settings?.theme ?? 'system'} />
                </button>
                <button
                  type="button"
                  className="header-icon-btn"
                  title={t(lang, 'aboutOpen')}
                  aria-label={t(lang, 'aboutOpen')}
                  onClick={() => setAboutOpen(true)}
                >
                  <AboutIcon />
                </button>
                {platform === 'win32' ? <WindowControls lang={lang} /> : null}
              </div>
            </div>
            <ChatTranscript
              lang={lang}
              messages={messages}
              toolCards={toolCards}
              bots={bots}
              selectedBot={selectedBot}
              selectedSquad={selectedSquad}
              busy={busy}
              turnPhase={turnPhase}
              turnStatusText={turnStatusText}
              turnPhaseOrbState={TURN_PHASE_ORB_STATE}
              loadingOlder={loadingOlder}
              messagesLoading={messagesLoading}
              hasMoreOlder={hasMoreOlder}
              highlightMessageId={highlightMessageId}
              showJumpToBottom={showJumpToBottom}
              error={error}
              messagesBoxRef={messagesBoxRef}
              bottomRef={bottomRef}
              onOpenPromptContext={onOpenPromptContext}
              onQuoteMessage={onQuoteMessage}
              onCopyMessage={onCopyMessage}
              onViewTokenUsage={onViewTokenUsage}
              onJumpToQuotedMessage={onJumpToQuotedMessage}
              onJumpToBottom={onJumpToBottom}
              onRetrySend={onRetrySend}
              onBotOnboardingDone={onBotOnboardingDone}
              onApproveTool={onApproveTool}
              onDenyTool={onDenyTool}
              onApproveToolForever={onApproveToolForever}
              composerSlot={composerSlot}
              immersiveChat={immersiveChat}
              onToggleImmersiveChat={onToggleImmersiveChat}
              showThinking={showThinking}
            />
          </div>
        )}

      </main>

      {narrow && dockTip && (
        <div
          className="dock-tip"
          style={{ top: dockTip.top, left: dockTip.left }}
          role="tooltip"
          onMouseEnter={() => cancelHideDockTip()}
          onMouseLeave={() => scheduleHideDockTip()}
        >
          <div className="dock-tip-head">
            {dockTip.kind === 'bot' ? (
              <FlatAvatar
                className="dock-tip-avatar"
                emoji={dockTip.emoji}
                color={dockTip.color}
                avatarKind={dockTip.avatarKind}
                botAvatarType={dockTip.botAvatarType}
                busy={botIsWorking(dockTip.id)}
              />
            ) : (
              <span className="dock-tip-avatar">
                <SquadAvatar members={dockTip.members} />
              </span>
            )}
            <span className="dock-tip-name">{dockTip.name}</span>
          </div>
          {dockTip.preview ? (
            <div className="dock-tip-preview">{dockTip.preview}</div>
          ) : null}
        </div>
      )}

      {menu && (
        <div
          className="menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.kind === 'bot' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  const bot = menu.bot;
                  setMenu(null);
                  if (narrow) tryExpandSidebar();
                  setRenameTarget({ kind: 'bot', id: bot.id, name: bot.name });
                  setRenameValue(bot.name);
                }}
              >
                <span className="menu-item-icon"><EditIcon /></span>
                <span>{t(lang, 'rename')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setProfileBot(menu.bot);
                  setMenu(null);
                }}
              >
                <span className="menu-item-icon"><PersonIcon /></span>
                <span>{t(lang, 'profile')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const botId = menu.bot.id;
                  setMenu(null);
                  void (async () => {
                    try {
                      const res = await window.okbot.exportAssistantPackage(botId);
                      if (res && !res.canceled && 'path' in res) {
                        toast.success(`${t(lang, 'botPackageExported')}: ${res.path}`);
                      }
                    } catch (err) {
                      toast.error(formatSystemError(err));
                    }
                  })();
                }}
              >
                <span className="menu-item-icon"><ExportAssistantIcon /></span>
                <span>{t(lang, 'botExportPackage')}</span>
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const botId = menu.bot.id;
                  const botName = menu.bot.name;
                  setMenu(null);
                  void (async () => {
                    const ok = await requestConfirm({
                      message: t(lang, 'deleteConfirm', { name: botName }),
                      confirmLabel: t(lang, 'delete'),
                      cancelLabel: t(lang, 'cancel'),
                      danger: true,
                    });
                    if (!ok) return;
                    try {
                      await window.okbot.deleteBot(botId);
                      setBots(await window.okbot.listBots());
                      setBusyByBot((prev) => {
                        if (!(botId in prev)) return prev;
                        const next = { ...prev };
                        delete next[botId];
                        return next;
                      });
                      setToolCardsByBot((prev) => {
                        if (!(botId in prev)) return prev;
                        const next = { ...prev };
                        delete next[botId];
                        return next;
                      });
                      setTurnPhaseByBot((prev) => {
                        if (!(botId in prev)) return prev;
                        const next = { ...prev };
                        delete next[botId];
                        return next;
                      });
                      if (selectionRef.current?.kind === 'bot' && selectionRef.current.id === botId) {
                        setSelection(null);
                        saveLastSelection(null);
                      }
                    } catch (err) {
                      toast.error(formatSystemError(err));
                    }
                  })();
                }}
              >
                <span className="menu-item-icon"><TrashIcon /></span>
                <span>{t(lang, 'delete')}</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  const squad = menu.squad;
                  setMenu(null);
                  if (narrow) tryExpandSidebar();
                  setRenameTarget({ kind: 'squad', id: squad.id, name: squad.name });
                  setRenameValue(squad.name);
                }}
              >
                <span className="menu-item-icon"><EditIcon /></span>
                <span>{t(lang, 'rename')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  openSquadEditor(menu.squad);
                  setMenu(null);
                }}
              >
                <span className="menu-item-icon"><SquadNavIcon /></span>
                <span>{t(lang, 'squadProfile')}</span>
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  const squadId = menu.squad.id;
                  const squadName = menu.squad.name;
                  setMenu(null);
                  void (async () => {
                    const ok = await requestConfirm({
                      message: t(lang, 'deleteSquadConfirm', { name: squadName }),
                      confirmLabel: t(lang, 'delete'),
                      cancelLabel: t(lang, 'cancel'),
                      danger: true,
                    });
                    if (!ok) return;
                    try {
                      await window.okbot.deleteSquad(squadId);
                      setSquads(await window.okbot.listSquads());
                      setBusyByBot((prev) => {
                        if (!(squadId in prev)) return prev;
                        const next = { ...prev };
                        delete next[squadId];
                        return next;
                      });
                      setToolCardsByBot((prev) => {
                        if (!(squadId in prev)) return prev;
                        const next = { ...prev };
                        delete next[squadId];
                        return next;
                      });
                      setTurnPhaseByBot((prev) => {
                        if (!(squadId in prev)) return prev;
                        const next = { ...prev };
                        delete next[squadId];
                        return next;
                      });
                      if (selectionRef.current?.kind === 'squad' && selectionRef.current.id === squadId) {
                        setSelection(null);
                        saveLastSelection(null);
                      }
                    } catch (err) {
                      toast.error(formatSystemError(err));
                    }
                  })();
                }}
              >
                <span className="menu-item-icon"><TrashIcon /></span>
                <span>{t(lang, 'delete')}</span>
              </button>
            </>
          )}
        </div>
      )}

      {promptContextView ? (
        <div
          className="prompt-context-overlay"
          onClick={() => setPromptContextView(null)}
          role="presentation"
        >
          <div
            className="prompt-context-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t(lang, 'promptContextTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="prompt-context-header">
              <h3>{t(lang, 'promptContextTitle')}</h3>
              <div className="prompt-context-actions">
                <button
                  type="button"
                  className={`prompt-context-icon-btn${promptContextCopied ? ' copied' : ''}`}
                  disabled={promptContextView.loading || !promptContextView.text.trim()}
                  title={
                    promptContextCopied
                      ? t(lang, 'promptContextCopied')
                      : t(lang, 'promptContextCopy')
                  }
                  aria-label={
                    promptContextCopied
                      ? t(lang, 'promptContextCopied')
                      : t(lang, 'promptContextCopy')
                  }
                  onClick={() => {
                    const text = promptContextView.text;
                    if (!text.trim()) return;
                    void (async () => {
                      try {
                        await copyTextToClipboard(text);
                        setPromptContextCopied(true);
                        window.setTimeout(() => setPromptContextCopied(false), 1500);
                      } catch (err) {
                        toast.error(formatSystemError(err));
                      }
                    })();
                  }}
                >
                  {promptContextCopied ? <CheckIcon /> : <CopyIcon />}
                </button>
                <button
                  type="button"
                  className="prompt-context-icon-btn"
                  title={t(lang, 'promptContextClose')}
                  aria-label={t(lang, 'promptContextClose')}
                  onClick={() => setPromptContextView(null)}
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
            <pre className="prompt-context-body">
              {promptContextView.loading
                ? t(lang, 'promptContextLoading')
                : promptContextView.text.trim()
                  ? promptContextView.text
                  : t(lang, 'promptContextEmpty')}
            </pre>
          </div>
        </div>
      ) : null}

      {runTraceView ? (
        <div
          className="prompt-context-overlay"
          onClick={() => setRunTraceView(null)}
          role="presentation"
        >
          <div
            className="prompt-context-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t(lang, 'runTraceTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="prompt-context-header">
              <h3>{t(lang, 'runTraceTitle')}</h3>
              <div className="prompt-context-actions">
                <button
                  type="button"
                  className={`prompt-context-icon-btn${runTraceCopied ? ' copied' : ''}`}
                  disabled={runTraceView.loading || !runTraceView.text.trim()}
                  title={
                    runTraceCopied ? t(lang, 'runTraceCopied') : t(lang, 'runTraceCopy')
                  }
                  aria-label={
                    runTraceCopied ? t(lang, 'runTraceCopied') : t(lang, 'runTraceCopy')
                  }
                  onClick={() => {
                    const text = runTraceView.text;
                    if (!text.trim()) return;
                    void (async () => {
                      try {
                        await copyTextToClipboard(text);
                        setRunTraceCopied(true);
                        window.setTimeout(() => setRunTraceCopied(false), 1500);
                      } catch (err) {
                        toast.error(formatSystemError(err));
                      }
                    })();
                  }}
                >
                  {runTraceCopied ? <CheckIcon /> : <CopyIcon />}
                </button>
                <button
                  type="button"
                  className="prompt-context-icon-btn"
                  title={t(lang, 'runTraceClose')}
                  aria-label={t(lang, 'runTraceClose')}
                  onClick={() => setRunTraceView(null)}
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
            <pre className="prompt-context-body">
              {runTraceView.loading
                ? t(lang, 'runTraceLoading')
                : runTraceView.text.trim()
                  ? runTraceView.text
                  : t(lang, 'runTraceEmpty')}
            </pre>
          </div>
        </div>
      ) : null}

      {createTarget && (
        <BotFormModal
          lang={lang}
          title={t(lang, 'createTitle')}
          autoApply
          botId={createTarget.id}
          providers={normalizeModelSettings(settings?.model).providers}
          defaultProviderId={normalizeModelSettings(settings?.model).defaultProviderId}
          defaultModelId={normalizeModelSettings(settings?.model).defaultModelId}
          initial={{
            name: createTarget.name,
            description: createTarget.description,
            avatarKind: createTarget.avatarKind || 'bot-avatar',
            emoji: createTarget.emoji,
            color: createTarget.color || '',
            botAvatarType: createTarget.botAvatarType || 'clover',
            providerId: createTarget.providerId || '',
            modelId: createTarget.modelId || '',
            useGlobalSkills: createTarget.useGlobalSkills === true,
            enabledGlobalSkills: createTarget.enabledGlobalSkills ?? [],
          }}
          onCancel={() => setCreateTarget(null)}
          onApply={(v) => void handleCreateApply(v)}
        />
      )}

      {profileBot && (
        <BotFormModal
          lang={lang}
          title={t(lang, 'profile')}
          autoApply
          botId={profileBot.id}
          providers={normalizeModelSettings(settings?.model).providers}
          defaultProviderId={normalizeModelSettings(settings?.model).defaultProviderId}
          defaultModelId={normalizeModelSettings(settings?.model).defaultModelId}
          initial={{
            name: profileBot.name,
            description: profileBot.description,
            avatarKind: profileBot.avatarKind || 'bot-avatar',
            emoji: profileBot.emoji,
            color: typeof profileBot.color === 'string' ? profileBot.color : '',
            botAvatarType: profileBot.botAvatarType || 'clover',
            providerId: profileBot.providerId || '',
            modelId: profileBot.modelId || '',
            useGlobalSkills: profileBot.useGlobalSkills === true,
            enabledGlobalSkills: profileBot.enabledGlobalSkills ?? [],
          }}
          onCancel={() => setProfileBot(null)}
          onApply={(v) => void handleProfileApply(v)}
        />
      )}

      {searchOpen ? (
        <GlobalSearchModal
          lang={lang}
          bots={bots}
          squads={squads}
          onClose={() => setSearchOpen(false)}
          onSelect={handleGlobalSearchSelect}
        />
      ) : null}

      {squadWizard ? (
        <SquadWizardModal
          lang={lang}
          bots={bots}
          value={squadWizard}
          providers={normalizeModelSettings(settings?.model).providers}
          defaultProviderId={normalizeModelSettings(settings?.model).defaultProviderId}
          defaultModelId={normalizeModelSettings(settings?.model).defaultModelId}
          onChange={setSquadWizard}
          onClose={() => setSquadWizard(null)}
          onSubmit={() => void submitSquadWizard()}
          syncMembers={syncSquadMembers}
          removeMember={removeSquadMember}
          reorderMember={reorderSquadMember}
        />
      ) : null}

      {settingsOpen && settings && (
        <SettingsModal
          settings={settings}
          dataDir={dataDir}
          hwAccelActive={hwAccelActive}
          bots={bots}
          squads={squads}
          initialTab={settingsFocus?.tab}
          focusSection={settingsFocus?.sectionId}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsFocus(null);
          }}
          onSave={async (next) => {
            try {
              const saved = await window.okbot.saveSettings(next);
              setSettings(saved);
              applyTheme(saved.theme);
              document.documentElement.lang = resolveUiLang(saved.language) === 'en' ? 'en' : 'zh-CN';
            } catch (err) {
              toast.error(formatSystemError(err));
            }
          }}
        />
      )}

      {aboutOpen ? (
        <AboutModal lang={lang} onClose={() => setAboutOpen(false)} />
      ) : null}

      {tokenUsageView ? (
        <div
          className="modal-backdrop"
          onClick={() => setTokenUsageView(null)}
          role="presentation"
        >
          <div
            className="modal about-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t(lang, 'tokenUsageTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setTokenUsageView(null)}
              aria-label={t(lang, 'close')}
            >
              <CloseIcon />
            </button>
            <h2 className="about-name" style={{ fontSize: 18, marginTop: 8 }}>
              {t(lang, 'tokenUsageTitle')}
            </h2>
            {tokenUsageView.usage &&
            (tokenUsageView.usage.input ||
              tokenUsageView.usage.output ||
              tokenUsageView.usage.cache) ? (
              <p className="about-meta">
                {t(lang, 'usageInput')}：{tokenUsageView.usage.input}
                <br />
                {t(lang, 'usageOutput')}：{tokenUsageView.usage.output}
                <br />
                {t(lang, 'usageCache')}：{tokenUsageView.usage.cache}
              </p>
            ) : (
              <p className="about-meta">{t(lang, 'tokenUsageEmpty')}</p>
            )}
          </div>
        </div>
      ) : null}
      <ToastHost closeLabel={t(lang, 'close')} />
      <ConfirmHost />
    </div>
  );
}
