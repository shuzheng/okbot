/** IPC channel names and runtime transport vocabulary. */

import type { Bot, Squad, AppSettings } from './settings.js';
import type { ChatMessage } from './chat.js';
import type { TokenUsage } from './usage.js';
import type { MessageTrace } from './trace.js';
import type { TaskRecord } from './tasks.js';

export const IpcChannels = {
  getBootstrap: 'okbot:get-bootstrap',
  listBots: 'okbot:list-bots',
  createBot: 'okbot:create-bot',
  finishBotOnboarding: 'okbot:finish-bot-onboarding',
  updateBot: 'okbot:update-bot',
  deleteBot: 'okbot:delete-bot',
  listSquads: 'okbot:list-squads',
  createSquad: 'okbot:create-squad',
  updateSquad: 'okbot:update-squad',
  deleteSquad: 'okbot:delete-squad',
  getSettings: 'okbot:get-settings',
  /** Live gateway access token this process checks (or the saved one when owning the server). */
  getGatewayAccessToken: 'okbot:get-gateway-access-token',
  /** One-shot: attach preload reads the gateway token. Never put it on the command line. */
  attachGatewayToken: 'okbot:attach-gateway-token',
  saveSettings: 'okbot:save-settings',
  discoverModels: 'okbot:discover-models',
  testModelConnection: 'okbot:test-model-connection',
  probeComputer: 'okbot:probe-computer',
  getMessages: 'okbot:get-messages',
  /** Open (pending/in_progress) tasks for the chat UI above the composer. */
  getTasks: 'okbot:get-tasks',
  /** All tasks (incl. history) for edit-assistant/squad 任务 tab. */
  listOwnerTasks: 'okbot:list-owner-tasks',
  /** Artifacts under ~/.okbot/<owner>/resources/ for 资源 tab. */
  listOwnerResources: 'okbot:list-owner-resources',
  getMessagesPage: 'okbot:get-messages-page',
  searchMessages: 'okbot:search-messages',
  getPromptContext: 'okbot:get-prompt-context',
  chatStart: 'okbot:chat-start',
  chatAbort: 'okbot:chat-abort',
  /** Manual Summary+Buffer pass (bypass ratio). Payload: { botId?|squadId?, mode:'compress'|'newTopic' }. */
  compressSessionNow: 'okbot:compress-session-now',
  chatEvent: 'okbot:chat-event',
  setChatUnread: 'okbot:set-chat-unread',
  toolRespond: 'okbot:tool-respond',
  copyText: 'okbot:copy-text',
  setTrafficLightPosition: 'okbot:set-traffic-light-position',
  windowMinimize: 'okbot:window-minimize',
  windowMaximizeToggle: 'okbot:window-maximize-toggle',
  windowClose: 'okbot:window-close',
  windowIsMaximized: 'okbot:window-is-maximized',
  windowMaximizedChanged: 'okbot:window-maximized-changed',
  /** Main → renderer: OS native theme flipped (esp. Windows when matchMedia is sticky). */
  nativeThemeUpdated: 'okbot:native-theme-updated',
  /** Main → renderer: settings changed outside the renderer (e.g. remember closeAction). */
  settingsChanged: 'okbot:settings-changed',
  ensureMicrophoneAccess: 'okbot:ensure-microphone-access',
  openMicrophoneSettings: 'okbot:open-microphone-settings',
  getAppInfo: 'okbot:get-app-info',
  updaterGetStatus: 'okbot:updater-get-status',
  updaterCheck: 'okbot:updater-check',
  updaterDownload: 'okbot:updater-download',
  updaterInstall: 'okbot:updater-install',
  updaterEvent: 'okbot:updater-event',
  getUsageStats: 'okbot:get-usage-stats',
  /** Recent error-log lines from ~/.okbot/logs (redacted). */
  getRecentErrorLog: 'okbot:get-recent-error-log',
  clearModelBindingsForProvider: 'okbot:clear-model-bindings-for-provider',
  readSoulMd: 'okbot:read-soul-md',
  writeSoulMd: 'okbot:write-soul-md',
  listBotMemories: 'okbot:list-bot-memories',
  upsertBotMemory: 'okbot:upsert-bot-memory',
  deleteBotMemory: 'okbot:delete-bot-memory',
  listGlobalMemories: 'okbot:list-global-memories',
  upsertGlobalMemory: 'okbot:upsert-global-memory',
  deleteGlobalMemory: 'okbot:delete-global-memory',
  listBotSkills: 'okbot:list-bot-skills',
  writeBotSkill: 'okbot:write-bot-skill',
  deleteBotSkill: 'okbot:delete-bot-skill',
  listGlobalAgentsSkills: 'okbot:list-global-agents-skills',
  /** Renderer → main: native open-dialog for composer attachments. */
  pickPaths: 'okbot:pick-paths',
  /**
   * Renderer → main: copy a local file or base64 blob into
   * ~/.okbot/<ownerId>/uploads/ on the gateway host.
   */
  uploadOwnerAttachment: 'okbot:upload-owner-attachment',
  /** Renderer → main: fallback data URL for ~/.okbot/<owner>/resources/* (prefer gateway /v1/media). */
  readGeneratedAssetDataUrl: 'okbot:read-generated-asset-data-url',
  /** Export assistant install package (folder or .okbot zip). */
  exportAssistantPackage: 'okbot:export-assistant-package',
  /** Import assistant install package (folder or .okbot zip). */
  importAssistantPackage: 'okbot:import-assistant-package',
  /** Built-in starter assistants (gallery). */
  listAssistantGallery: 'okbot:list-assistant-gallery',
  installGalleryAssistant: 'okbot:install-gallery-assistant',
  importAssistantFromUrl: 'okbot:import-assistant-from-url',
  cancelImportAssistantFromUrl: 'okbot:cancel-import-assistant-from-url',
  /** Desktop only: MCP connection status / one-off test. */
  mcpStatus: 'okbot:mcp-status',
  mcpTestServer: 'okbot:mcp-test-server',
  /** Desktop only: full data directory backup / restore. */
  backupExport: 'okbot:backup-export',
  backupRestore: 'okbot:backup-restore',
  /** Bring this window to the front (notification click). */
  windowFocus: 'okbot:window-focus',
  claimNotification: 'okbot:claim-notification',
  /** List timed wakeups across all assistants/squads (settings UI). */
  listScheduledJobs: 'okbot:list-scheduled-jobs',
  /** pause | resume | delete one job: { ownerId, jobId, action }. */
  manageScheduledJob: 'okbot:manage-scheduled-job',
  /**
   * Main → renderer: tray / shell navigation.
   * Payload: settings | sessions (legacy) | openSession.
   */
  shellNavigate: 'okbot:shell-navigate',
} as const;

/** Main → renderer shell navigation payload. */
export type ShellNavigateAction = 'sessions' | 'settings' | 'openSession';
export type ShellNavigatePayload =
  | { action: 'sessions' }
  | { action: 'settings' }
  | { action: 'openSession'; kind: 'bot' | 'squad'; id: string };

export type PendingToolRequest = {
  requestId: string;
  botId: string;
  messageId: string;
  toolName: string;
  arguments: unknown;
};

/**
 * Unified agent runtime event stream — one model for desktop IPC, local HTTP API /
 * Gateway SSE, and UI. Adapters must not invent divergent turn state machines.
 */
export type SessionsChangedReason = 'message' | 'created' | 'updated' | 'deleted';

export type RuntimeEvent =
  | { type: 'delta'; botId: string; messageId: string; delta: string; runId?: string }
  | {
      type: 'done';
      botId: string;
      messageId: string;
      content: string;
      usage?: TokenUsage;
      trace?: MessageTrace;
      aborted?: boolean;
      runId?: string;
    }
  | { type: 'error'; botId: string; messageId: string; error: string; runId?: string }
  | { type: 'user_message'; botId: string; message: ChatMessage; runId?: string }
  | { type: 'assistant_message'; botId: string; message: ChatMessage; runId?: string }
  | {
      type: 'tool_request';
      botId: string;
      messageId: string;
      requestId: string;
      toolName: string;
      arguments: unknown;
      runId?: string;
    }
  | {
      type: 'tool_result';
      botId: string;
      messageId: string;
      requestId: string;
      toolName: string;
      approved: boolean;
      output?: string;
      runId?: string;
    }
  | {
      /** Parallel turn binder: links user bubble ↔ assistant bubble ↔ runId. */
      type: 'turn_started';
      botId: string;
      runId: string;
      userMessageId: string;
      assistantMessageId: string;
      clientTurnId?: string;
    }
  | {
      /** Skills catalog changed on disk (hot reload); UI may refresh lists. */
      type: 'skills_changed';
      botId: string;
      paths?: string[];
      at: string;
    }
  | {
      /**
       * Roster, order, or preview changed (message, create, rename, delete).
       * Clients refetch bots and squads. Not a chat-turn event.
       */
      type: 'sessions_changed';
      botId: string;
      reason: SessionsChangedReason;
    }
  | {
      /** Multi-task queue changed on disk; UI refreshes open tasks above composer. */
      type: 'tasks_changed';
      botId: string;
      /** Open tasks snapshot (pending/in_progress). */
      tasks: TaskRecord[];
    };

/** About dialog / clipboard blob. */
export interface AppInfo {
  name: string;
  version: string;
  buildDate: string;
  copyright: string;
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
  isPackaged: boolean;
}

export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdaterStatus {
  phase: UpdaterPhase;
  currentVersion: string;
  availableVersion?: string;
  progress?: number;
  error?: string;
  /**
   * The update could not start installing when the app last quit (reason code, for
   * example `no_space`, `not_writable`). Set on the next launch so the UI can tell the user.
   */
  lastInstallFailed?: string;
}

export interface BootstrapPayload {
  bots: Bot[];
  squads: Squad[];
  settings: AppSettings;
  dataDir: string;
  /** Effective HW accel for this process (set before app ready). */
  hardwareAccelerationActive: boolean;
  /** Bots with an in-flight run and/or disk-persisted HITL waiting for approval. */
  busyBotIds?: string[];
  /** Live + cold-start pending tool approval cards. */
  pendingToolRequests?: PendingToolRequest[];
  /** Corrupt settings.json detected on load (backup kept; defaults not written over it). */
  settingsLoadWarning?: string;
  /** Set once after a restore turned MCP off (the user must turn it on again). */
  restoreMcpTurnedOff?: boolean;
}



