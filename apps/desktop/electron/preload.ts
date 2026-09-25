import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannels,
  type AppInfo,
  type AppSettings,
  type BotOnboardingAnswers,
  type ChatEvent,
  type UpdaterStatus,
  type UsageStats,
} from '@okbot/shared';

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
  finishBotOnboarding: (botId: string, answers: BotOnboardingAnswers) =>
    ipcRenderer.invoke(IpcChannels.finishBotOnboarding, botId, answers),
  deleteBot: (id: string) => ipcRenderer.invoke(IpcChannels.deleteBot, id),
  listSquads: () => ipcRenderer.invoke(IpcChannels.listSquads),
  createSquad: (input: {
    name: string;
    description?: string;
    members: Array<{ botId: string; role: string }>;
    providerId?: string;
    modelId?: string;
  }) => ipcRenderer.invoke(IpcChannels.createSquad, input),
  updateSquad: (
    id: string,
    patch: {
      name?: string;
      description?: string;
      members?: Array<{ botId: string; role: string }>;
      providerId?: string;
      modelId?: string;
    },
  ) => ipcRenderer.invoke(IpcChannels.updateSquad, id, patch),
  deleteSquad: (id: string) => ipcRenderer.invoke(IpcChannels.deleteSquad, id),
  readAgentsMd: (botId: string) =>
    ipcRenderer.invoke(IpcChannels.readAgentsMd, botId) as Promise<string>,
  writeAgentsMd: (botId: string, content: string) =>
    ipcRenderer.invoke(IpcChannels.writeAgentsMd, botId, content) as Promise<boolean>,
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
  getSettings: () => ipcRenderer.invoke(IpcChannels.getSettings),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke(IpcChannels.saveSettings, settings),
  discoverModels: (payload: { baseURL: string; apiKey: string }) =>
    ipcRenderer.invoke(IpcChannels.discoverModels, payload) as Promise<{
      ok: boolean;
      models?: Array<{
        id: string;
        name: string;
        contextWindow: number;
        maxTokens: number | null;
        enabled: boolean;
        vision?: boolean;
        showThinking?: boolean;
      }>;
      error?: string;
    }>,
  testModelConnection: (payload: {
    baseURL: string;
    apiKey: string;
    apiFormat: 'chat_completions' | 'responses';
    modelId: string;
  }) =>
    ipcRenderer.invoke(IpcChannels.testModelConnection, payload) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  getMessages: (botId: string) => ipcRenderer.invoke(IpcChannels.getMessages, botId),
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
  getLastRunTrace: (ownerId: string) =>
    ipcRenderer.invoke(IpcChannels.getLastRunTrace, { ownerId }) as Promise<{
      trace: {
        runId: string;
        startedAt: string;
        endedAt?: string;
        status: string;
        events: Array<Record<string, unknown>>;
      } | null;
    }>,
  chatStart: (botId: string, text: string, opts?: { quoteMessageId?: string }) =>
    ipcRenderer.invoke(IpcChannels.chatStart, {
      botId,
      text,
      quoteMessageId: opts?.quoteMessageId,
    }),
  chatStartSquad: (squadId: string, text: string, opts?: { quoteMessageId?: string }) =>
    ipcRenderer.invoke(IpcChannels.chatStart, {
      squadId,
      text,
      quoteMessageId: opts?.quoteMessageId,
    }),
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
  toolRespond: (payload: { requestId: string; approved: boolean; message?: string }) =>
    ipcRenderer.invoke(IpcChannels.toolRespond, payload) as Promise<{ ok: boolean; error?: string }>,
  copyText: (text: string) =>
    ipcRenderer.invoke(IpcChannels.copyText, text) as Promise<boolean>,
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
  transcribeAudio: (payload: { bytes: Uint8Array; filename: string; mimeType?: string }) =>
    ipcRenderer.invoke(IpcChannels.transcribeAudio, payload) as Promise<{ text: string }>,
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
  updaterGetStatus: () =>
    ipcRenderer.invoke(IpcChannels.updaterGetStatus) as Promise<UpdaterStatus>,
  updaterCheck: () => ipcRenderer.invoke(IpcChannels.updaterCheck) as Promise<UpdaterStatus>,
  updaterDownload: () =>
    ipcRenderer.invoke(IpcChannels.updaterDownload) as Promise<UpdaterStatus>,
  updaterInstall: () => ipcRenderer.invoke(IpcChannels.updaterInstall) as Promise<void>,
  onChatEvent: (handler: (event: ChatEvent) => void): (() => void) => {
    const listener = (_: unknown, event: ChatEvent) => handler(event);
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
};

contextBridge.exposeInMainWorld('okbot', api);

export type OkbotApi = typeof api;
