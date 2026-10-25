import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  IpcChannels,
  buildChatStartPayload,
  type AppInfo,
  type AppSettings,
  type Bot,
  type ChatStartOpts,
  type McpServerEntry,
  type RuntimeEvent,
  type LocalizedChangelogNotes,
  type UpdaterStatus,
  type UsageStats,
  type ScheduledJobInfo,
} from '@okbot/shared';
import type { AssistantGalleryItem, McpServerStatus } from '@okbot/agent';
import type { ClientGatewayEntry, ClientGatewayPrefs } from './clientGatewayPrefs';

const api = {
  getBootstrap: () => ipcRenderer.invoke(IpcChannels.getBootstrap),
  listBots: () => ipcRenderer.invoke(IpcChannels.listBots),
  createBot: (input: {
    name: string;
    description?: string;
    emoji?: string;
    color?: string;
    providerId?: string;
    modelId?: string;
    avatarKind?: 'emoji' | 'bot-avatar';
    botAvatarType?: string;
  }) => ipcRenderer.invoke(IpcChannels.createBot, input),
  updateBot: (
    id: string,
    patch: {
      name?: string;
      description?: string;
      emoji?: string;
      color?: string;
      providerId?: string;
      modelId?: string;
      avatarKind?: 'emoji' | 'bot-avatar';
      botAvatarType?: string;
      useGlobalSkills?: boolean;
      enabledGlobalSkills?: string[];
    },
  ) => ipcRenderer.invoke(IpcChannels.updateBot, id, patch),
  startBotOnboarding: (botId: string): Promise<{ started: boolean }> =>
    ipcRenderer.invoke(IpcChannels.startBotOnboarding, botId),
  deleteBot: (id: string) => ipcRenderer.invoke(IpcChannels.deleteBot, id),
  listSquads: () => ipcRenderer.invoke(IpcChannels.listSquads),
  createSquad: (input: {
    name: string;
    description?: string;
    members: Array<{ botId: string }>;
    providerId?: string;
    modelId?: string;
  }) => ipcRenderer.invoke(IpcChannels.createSquad, input),
  updateSquad: (
    id: string,
    patch: {
      name?: string;
      description?: string;
      members?: Array<{ botId: string }>;
      providerId?: string;
      modelId?: string;
    },
  ) => ipcRenderer.invoke(IpcChannels.updateSquad, id, patch),
  deleteSquad: (id: string) => ipcRenderer.invoke(IpcChannels.deleteSquad, id),
  listAssistantGallery: (lang?: 'zh' | 'en') =>
    ipcRenderer.invoke(IpcChannels.listAssistantGallery, lang) as Promise<AssistantGalleryItem[]>,
  installGalleryAssistant: (id: string, lang?: 'zh' | 'en') =>
    ipcRenderer.invoke(IpcChannels.installGalleryAssistant, id, lang) as Promise<Bot>,
  importAssistantFromUrl: (url: string, opts?: { overwrite?: boolean }) =>
    ipcRenderer.invoke(IpcChannels.importAssistantFromUrl, {
      url,
      overwrite: opts?.overwrite === true,
    }) as Promise<Bot>,
  cancelImportAssistantFromUrl: () =>
    ipcRenderer.invoke(IpcChannels.cancelImportAssistantFromUrl) as Promise<boolean>,
  readSoulMd: (botId: string) =>
    ipcRenderer.invoke(IpcChannels.readSoulMd, botId) as Promise<string>,
  writeSoulMd: (botId: string, content: string) =>
    ipcRenderer.invoke(IpcChannels.writeSoulMd, botId, content) as Promise<boolean>,
  listBotMemories: (botId: string) =>
    ipcRenderer.invoke(IpcChannels.listBotMemories, botId),
  upsertBotMemory: (entry: {
    id: string;
    bot_id: string;
    memory: string;
    expires: string | null;
  }) => ipcRenderer.invoke(IpcChannels.upsertBotMemory, entry) as Promise<boolean>,
  deleteBotMemory: (botId: string, memoryId: string) =>
    ipcRenderer.invoke(IpcChannels.deleteBotMemory, { botId, memoryId }) as Promise<boolean>,
  listGlobalMemories: () => ipcRenderer.invoke(IpcChannels.listGlobalMemories),
  upsertGlobalMemory: (entry: {
    id: string;
    bot_id: string;
    memory: string;
    expires: string | null;
  }) => ipcRenderer.invoke(IpcChannels.upsertGlobalMemory, entry) as Promise<boolean>,
  deleteGlobalMemory: (memoryId: string) =>
    ipcRenderer.invoke(IpcChannels.deleteGlobalMemory, memoryId) as Promise<boolean>,
  listBotSkills: (botId: string) => ipcRenderer.invoke(IpcChannels.listBotSkills, botId),
  writeBotSkill: (
    botId: string,
    skill: { slug: string; name: string; description: string; body: string },
  ) => ipcRenderer.invoke(IpcChannels.writeBotSkill, botId, skill) as Promise<boolean>,
  deleteBotSkill: (botId: string, slug: string) =>
    ipcRenderer.invoke(IpcChannels.deleteBotSkill, { botId, slug }) as Promise<boolean>,
  listGlobalAgentsSkills: () => ipcRenderer.invoke(IpcChannels.listGlobalAgentsSkills),
  exportAssistantPackage: (botId: string, targetPath?: string) =>
    ipcRenderer.invoke(IpcChannels.exportAssistantPackage, { botId, targetPath }) as Promise<
      { canceled: true } | { canceled: false; path: string }
    >,
  importAssistantPackage: (sourcePath?: string) =>
    ipcRenderer.invoke(IpcChannels.importAssistantPackage, sourcePath) as Promise<
      { canceled: true } | { canceled: false; bot: unknown }
    >,
  getSettings: () => ipcRenderer.invoke(IpcChannels.getSettings),
  getGatewayAccessToken: () =>
    ipcRenderer.invoke(IpcChannels.getGatewayAccessToken) as Promise<string>,
  getGatewayAdminToken: () =>
    ipcRenderer.invoke(IpcChannels.getGatewayAdminToken) as Promise<string>,
  getGatewayApiTokens: () =>
    ipcRenderer.invoke(IpcChannels.getGatewayApiTokens) as Promise<
      import('@okbot/shared').GatewayApiTokenEntry[]
    >,
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke(IpcChannels.saveSettings, settings),
  applyWindowTranslucent: (translucent: boolean) =>
    ipcRenderer.invoke(IpcChannels.applyWindowTranslucent, translucent) as Promise<boolean>,
  discoverModels: (payload: { baseURL: string; apiKey: string; providerId?: string }) =>
    ipcRenderer.invoke(IpcChannels.discoverModels, payload) as Promise<{
      ok: boolean;
      models?: Array<{
        id: string;
        name: string;
        contextWindow: number;
        maxTokens: number | null;
        enabled: boolean;
        showThinking?: boolean;
      }>;
      error?: string;
    }>,
  testModelConnection: (payload: {
    baseURL: string;
    apiKey: string;
    apiFormat: 'chat_completions' | 'responses';
    modelId: string;
    providerId?: string;
  }) =>
    ipcRenderer.invoke(IpcChannels.testModelConnection, payload) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  probeComputer: (payload: { host: string; port: number; token: string; name?: string }) =>
    ipcRenderer.invoke(IpcChannels.probeComputer, payload) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  getMessages: (botId: string) => ipcRenderer.invoke(IpcChannels.getMessages, botId),
  getTasks: (ownerId: string) =>
    ipcRenderer.invoke(IpcChannels.getTasks, ownerId) as Promise<import('@okbot/shared').TaskRecord[]>,
  listOwnerTasks: (ownerId: string) =>
    ipcRenderer.invoke(IpcChannels.listOwnerTasks, ownerId) as Promise<
      import('@okbot/shared').TaskRecord[]
    >,
  listOwnerResources: (ownerId: string) =>
    ipcRenderer.invoke(IpcChannels.listOwnerResources, ownerId) as Promise<
      import('@okbot/shared').OwnerResourceInfo[]
    >,
  getMessagesPage: (botId: string, opts?: { limit?: number; beforeMessageId?: string | null }) =>
    ipcRenderer.invoke(IpcChannels.getMessagesPage, {
      botId,
      limit: opts?.limit,
      beforeMessageId: opts?.beforeMessageId,
    }),
  searchMessages: (query: string, opts?: { limit?: number }) =>
    ipcRenderer.invoke(IpcChannels.searchMessages, { query, limit: opts?.limit }),
  getPromptContext: (botId: string, messageId: string) =>
    ipcRenderer.invoke(IpcChannels.getPromptContext, { botId, messageId }) as Promise<{ text: string | null }>,
  chatStart: (botId: string, text: string, opts?: ChatStartOpts) =>
    ipcRenderer.invoke(IpcChannels.chatStart, buildChatStartPayload({ botId }, text, opts)),
  chatStartSquad: (squadId: string, text: string, opts?: ChatStartOpts) =>
    ipcRenderer.invoke(IpcChannels.chatStart, buildChatStartPayload({ squadId }, text, opts)),
  chatAbort: (botId: string) => ipcRenderer.invoke(IpcChannels.chatAbort, botId),
  compressSessionNow: (payload: {
    botId?: string;
    squadId?: string;
    mode: 'compress' | 'newTopic';
  }) =>
    ipcRenderer.invoke(IpcChannels.compressSessionNow, payload) as Promise<{
      ok: boolean;
      didCompress?: boolean;
      coveredThroughId?: string | null;
      error?: string;
    }>,
  setChatUnread: (ownerId: string, hasUnread: boolean) =>
    ipcRenderer.invoke(IpcChannels.setChatUnread, { ownerId, hasUnread }) as Promise<boolean>,
  setBadgeCount: (count: number) =>
    ipcRenderer.invoke(IpcChannels.setBadgeCount, count) as Promise<boolean>,
  toolRespond: (payload: { requestId: string; approved: boolean; message?: string }) =>
    ipcRenderer.invoke(IpcChannels.toolRespond, payload) as Promise<{ ok: boolean; error?: string }>,
  copyText: (text: string) =>
    ipcRenderer.invoke(IpcChannels.copyText, text) as Promise<boolean>,
  pickPaths: (kind: 'image' | 'file' | 'folder') =>
    ipcRenderer.invoke(IpcChannels.pickPaths, { kind }) as Promise<{
      canceled: boolean;
      paths: string[];
      /** HTTP bridge / WebUI only — File blobs for dataBase64 upload. */
      files?: File[];
    }>,
  uploadOwnerAttachment: (payload: {
    ownerId: string;
    name?: string;
    localPath?: string;
    dataBase64?: string;
    mime?: string;
  }) =>
    ipcRenderer.invoke(IpcChannels.uploadOwnerAttachment, payload) as Promise<
      | {
          ok: true;
          attachment: {
            kind: 'image' | 'file';
            path: string;
            name: string;
            size: number;
            mediaPath: string;
            assetRel: string;
          };
        }
      | { ok: false; error: string }
    >,
  /** Absolute path for a File from drag-drop / <input> (Electron 32+; replaces File.path). */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  readGeneratedAssetDataUrl: (assetRel: string) =>
    ipcRenderer.invoke(IpcChannels.readGeneratedAssetDataUrl, { assetRel }) as Promise<
      { ok: true; dataUrl: string } | { ok: false; error: string }
    >,
  setTrafficLightPosition: (pos: { x: number; y: number }) =>
    ipcRenderer.invoke(IpcChannels.setTrafficLightPosition, pos),
  windowMinimize: () => ipcRenderer.invoke(IpcChannels.windowMinimize) as Promise<boolean>,
  windowMaximizeToggle: () =>
    ipcRenderer.invoke(IpcChannels.windowMaximizeToggle) as Promise<boolean>,
  windowClose: () => ipcRenderer.invoke(IpcChannels.windowClose) as Promise<boolean>,
  windowIsMaximized: () => ipcRenderer.invoke(IpcChannels.windowIsMaximized) as Promise<boolean>,
  onWindowMaximizedChanged: (handler: (maximized: boolean) => void): (() => void) => {
    const listener = (_: unknown, maximized: boolean) => handler(maximized);
    ipcRenderer.on(IpcChannels.windowMaximizedChanged, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.windowMaximizedChanged, listener);
    };
  },
  ensureMicrophoneAccess: () => ipcRenderer.invoke(IpcChannels.ensureMicrophoneAccess) as Promise<{
    status: string;
    prompted: boolean;
    askResult?: boolean | null;
    electronAppPath?: string;
  }>,
  openMicrophoneSettings: () => ipcRenderer.invoke(IpcChannels.openMicrophoneSettings) as Promise<boolean>,
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.getAppInfo) as Promise<AppInfo>,
  getRecentErrorLog: (limit?: number) =>
    ipcRenderer.invoke(IpcChannels.getRecentErrorLog, limit) as Promise<{
      entries: Array<{
        ts: string;
        ownerId: string;
        messageId?: string;
        phase: string;
        error: string;
        stack?: string;
      }>;
    }>,
  clearModelBindingsForProvider: (payload: {
    providerId: string;
    removedModelIds?: string[];
  }) =>
    ipcRenderer.invoke(IpcChannels.clearModelBindingsForProvider, payload) as Promise<{
      cleared: number;
    }>,
  getUsageStats: () => ipcRenderer.invoke(IpcChannels.getUsageStats) as Promise<UsageStats>,
  getApiTokenUsage: (tokenId: string) =>
    ipcRenderer.invoke(IpcChannels.getApiTokenUsage, tokenId) as Promise<{
      ok: boolean;
      tokenId?: string;
      name?: string;
      role?: string;
      limits?: unknown;
      usage?: unknown;
      error?: string;
    }>,
  listScheduledJobs: () =>
    ipcRenderer.invoke(IpcChannels.listScheduledJobs) as Promise<ScheduledJobInfo[]>,
  manageScheduledJob: (payload: {
    ownerId: string;
    jobId: string;
    action: 'pause' | 'resume' | 'delete';
  }) =>
    ipcRenderer.invoke(IpcChannels.manageScheduledJob, payload) as Promise<{
      ok: true;
      summary: string;
    }>,
  mcpStatus: () => ipcRenderer.invoke(IpcChannels.mcpStatus) as Promise<McpServerStatus[]>,
  mcpTestServer: (entry: McpServerEntry) =>
    ipcRenderer.invoke(IpcChannels.mcpTestServer, entry) as Promise<McpServerStatus>,
  backupExport: (payload: { excludeSecrets: boolean }) =>
    ipcRenderer.invoke(IpcChannels.backupExport, payload) as Promise<
      { canceled: true; ok?: undefined } | { ok: true; path: string } | { ok: false; error: string }
    >,
  backupRestore: () =>
    ipcRenderer.invoke(IpcChannels.backupRestore) as Promise<
      { canceled: true; ok?: undefined } | { ok: true; previousDir: string } | { ok: false; error: string }
    >,
  windowFocus: () => ipcRenderer.invoke(IpcChannels.windowFocus) as Promise<boolean>,
  claimNotification: (tag: string) =>
    ipcRenderer.invoke(IpcChannels.claimNotification, { tag }) as Promise<boolean>,
  updaterGetStatus: () =>
    ipcRenderer.invoke(IpcChannels.updaterGetStatus) as Promise<UpdaterStatus>,
  updaterCheck: () => ipcRenderer.invoke(IpcChannels.updaterCheck) as Promise<UpdaterStatus>,
  updaterDownload: () =>
    ipcRenderer.invoke(IpcChannels.updaterDownload) as Promise<UpdaterStatus>,
  updaterInstall: () => ipcRenderer.invoke(IpcChannels.updaterInstall) as Promise<void>,
  updaterGetChangelogHistory: (lang?: 'zh' | 'en') =>
    ipcRenderer.invoke(IpcChannels.updaterGetChangelogHistory, lang) as Promise<
      LocalizedChangelogNotes[]
    >,
  updaterGetWhatsNew: (lang?: 'zh' | 'en') =>
    ipcRenderer.invoke(IpcChannels.updaterGetWhatsNew, lang) as Promise<LocalizedChangelogNotes | null>,
  updaterMarkWhatsNewSeen: (version?: string) =>
    ipcRenderer.invoke(IpcChannels.updaterMarkWhatsNewSeen, version) as Promise<boolean>,
  updaterDismissUpdatePrompt: (version?: string) =>
    ipcRenderer.invoke(IpcChannels.updaterDismissUpdatePrompt, version) as Promise<UpdaterStatus>,
  onRuntimeEvent: (handler: (event: RuntimeEvent) => void): (() => void) => {
    const listener = (_: unknown, event: RuntimeEvent) => handler(event);
    ipcRenderer.on(IpcChannels.chatEvent, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.chatEvent, listener);
    };
  },
  onUpdaterEvent: (handler: (status: UpdaterStatus) => void): (() => void) => {
    const listener = (_: unknown, status: UpdaterStatus) => handler(status);
    ipcRenderer.on(IpcChannels.updaterEvent, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.updaterEvent, listener);
    };
  },
  onNativeThemeUpdated: (handler: () => void): (() => void) => {
    const listener = () => handler();
    ipcRenderer.on(IpcChannels.nativeThemeUpdated, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.nativeThemeUpdated, listener);
    };
  },
  onSettingsChanged: (handler: (settings: AppSettings) => void): (() => void) => {
    const listener = (_: unknown, settings: AppSettings) => handler(settings);
    ipcRenderer.on(IpcChannels.settingsChanged, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.settingsChanged, listener);
    };
  },
  onShellNavigate: (
    handler: (payload: import('@okbot/shared').ShellNavigatePayload) => void,
  ): (() => void) => {
    const listener = (_: unknown, payload: import('@okbot/shared').ShellNavigatePayload) =>
      handler(payload);
    ipcRenderer.on(IpcChannels.shellNavigate, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.shellNavigate, listener);
    };
  },
  getClientGatewayPrefs: () =>
    ipcRenderer.invoke(IpcChannels.getClientGatewayPrefs) as Promise<ClientGatewayPrefs>,
  setActiveClientGateway: (id: string) =>
    ipcRenderer.invoke(IpcChannels.setActiveClientGateway, id) as Promise<ClientGatewayPrefs>,
  switchClientGateway: (id: string) =>
    ipcRenderer.invoke(IpcChannels.switchClientGateway, id) as Promise<{
      mode: 'hot' | 'relaunch';
      prefs: ClientGatewayPrefs;
      previousActiveId: string;
      base?: string;
      token?: string;
    }>,
  upsertClientGateway: (entry: ClientGatewayEntry) =>
    ipcRenderer.invoke(IpcChannels.upsertClientGateway, entry) as Promise<ClientGatewayPrefs>,
  removeClientGateway: (id: string) =>
    ipcRenderer.invoke(IpcChannels.removeClientGateway, id) as Promise<ClientGatewayPrefs>,
  probeClientGateway: (payload: { baseUrl: string; token: string }) =>
    ipcRenderer.invoke(IpcChannels.probeClientGateway, payload) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  relaunchApp: () => ipcRenderer.invoke(IpcChannels.relaunchApp) as Promise<boolean>,
};

contextBridge.exposeInMainWorld('okbot', api);

export type OkbotApi = typeof api;
