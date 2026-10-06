import { createRequire } from 'node:module';
import { takeRestoreNotice } from '../backup';
import type { Dialog, IpcMain } from 'electron';

/** Loaded only when registering IPC, so the gateway process does not import Electron. */
function loadElectronUi(): { ipcMain: IpcMain; dialog: Dialog } {
  const require = createRequire(import.meta.url);
  return require('electron') as { ipcMain: IpcMain; dialog: Dialog };
}

import { IpcChannels, type AppSettings } from '@okbot/shared';
import { probeRemoteComputer } from '@okbot/agent';
import type { IpcContext } from './context';
import { createEntityOps } from '../entityOps';

/** Make an assistant display name safe to use as a cross-platform filename. */
export function sanitizeAssistantFilename(name: string): string {
  const safe = name
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!safe || safe === '.' || safe === '..') return 'assistant';
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(safe)) return `_${safe}`;
  return safe;
}

/** Same write path for Electron IPC and the gateway HTTP API. */
export function persistAppSettings(
  ctx: IpcContext,
  settings: AppSettings,
  opts?: { deferListenerRestart?: boolean },
): AppSettings {
  const prev = ctx.storage.getSettings();
  const saved = ctx.storage.saveSettings(settings);
  ctx.applyTheme(saved.theme);
  if (prev.autoUpdate !== saved.autoUpdate) {
    ctx.onAutoUpdatePreferenceChanged?.(saved.autoUpdate !== false);
  }
  const prevApi = prev.localHttpApi;
  const nextApi = saved.localHttpApi;
  const listenerChanged =
    prevApi?.enabled !== nextApi.enabled ||
    prevApi?.port !== nextApi.port ||
    prevApi?.token !== nextApi.token ||
    prevApi?.bindLan !== nextApi.bindLan ||
    prevApi?.serveUi !== nextApi.serveUi;
  if (listenerChanged) {
    const notify = () => ctx.onLocalHttpApiSettingsChanged?.();
    // Restarting the HTTP server drops the socket that is still writing this response.
    if (opts?.deferListenerRestart) setImmediate(notify);
    else notify();
  }
  return saved;
}

export function registerEntityIpc(ctx: IpcContext): void {
  const { ipcMain, dialog } = loadElectronUi();
  const ops = createEntityOps(ctx);

  ipcMain.handle(
    IpcChannels.probeComputer,
    async (
      _e,
      payload: { host?: string; port?: number; token?: string; name?: string },
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const host = (payload?.host || '').trim();
      const token = (payload?.token || '').trim();
      const port = Number(payload?.port);
      if (!host || !token || !Number.isInteger(port) || port < 1 || port > 65535) {
        return { ok: false, error: 'need_fields' };
      }
      const baseUrl = /^https?:\/\//i.test(host) ? host.replace(/\/+$/, '') : `http://${host}:${port}`;
      return probeRemoteComputer({
        name: (payload?.name || '').trim() || host,
        baseUrl,
        token,
      });
    },
  );

  ipcMain.handle(IpcChannels.getBootstrap, () => {
    const settings = ctx.storage.getSettings();
    const settingsLoadWarning = ctx.storage.takeSettingsLoadWarning() ?? undefined;
    const restoreNotice = takeRestoreNotice(ctx.storage.root);
    return {
      bots: ctx.storage.withReplyPreviews(ctx.storage.listBots()),
      squads: ctx.storage.withReplyPreviews(ctx.storage.listSquads()),
      settings,
      hardwareAccelerationActive: ctx.hardwareAccelerationActive,
      dataDir: ctx.storage.root,
      ...(settingsLoadWarning ? { settingsLoadWarning } : {}),
      ...(restoreNotice?.mcpTurnedOff ? { restoreMcpTurnedOff: true } : {}),
      ...ctx.snapshotActiveRuns(),
    };
  });

  ipcMain.handle(IpcChannels.listBots, () => ctx.storage.withReplyPreviews(ctx.storage.listBots()));
  ipcMain.handle(IpcChannels.createBot, (_e, input) => ops.createBot(input ?? {}));
  ipcMain.handle(IpcChannels.updateBot, (_e, id: string, patch) => ops.updateBot({ id, patch }));
  ipcMain.handle(IpcChannels.finishBotOnboarding, (_e, botId: string, answers) =>
    ops.finishBotOnboarding({ botId, answers }),
  );
  ipcMain.handle(IpcChannels.deleteBot, (_e, id: string) => ops.deleteBot({ id: id || '' }));

  ipcMain.handle(IpcChannels.readAgentsMd, (_e, botId: string) => ops.readAgentsMd({ botId }));
  ipcMain.handle(IpcChannels.writeAgentsMd, (_e, botId: string, content: string) =>
    ops.writeAgentsMd({ botId, content }),
  );
  ipcMain.handle(IpcChannels.listBotMemories, (_e, botId: string) => ops.listBotMemories({ botId }));
  ipcMain.handle(IpcChannels.upsertBotMemory, (_e, entry) => ops.upsertBotMemory({ entry }));
  ipcMain.handle(IpcChannels.deleteBotMemory, (_e, payload: { botId: string; memoryId: string }) =>
    ops.deleteBotMemory(payload ?? {}),
  );
  ipcMain.handle(IpcChannels.listGlobalMemories, () => ops.listGlobalMemories());
  ipcMain.handle(IpcChannels.upsertGlobalMemory, (_e, entry) => ops.upsertGlobalMemory({ entry }));
  ipcMain.handle(IpcChannels.deleteGlobalMemory, (_e, memoryId: string) =>
    ops.deleteGlobalMemory({ memoryId }),
  );
  ipcMain.handle(IpcChannels.listBotSkills, (_e, botId: string) => ops.listBotSkills({ botId }));
  ipcMain.handle(IpcChannels.writeBotSkill, (_e, botId: string, skill) =>
    ops.writeBotSkill({ botId, skill }),
  );
  ipcMain.handle(IpcChannels.deleteBotSkill, (_e, payload: { botId: string; slug: string }) =>
    ops.deleteBotSkill(payload ?? {}),
  );
  ipcMain.handle(IpcChannels.listGlobalAgentsSkills, () => ops.listGlobalAgentsSkills());

  ipcMain.handle(
    IpcChannels.exportAssistantPackage,
    async (_e, payload: { botId: string; targetPath?: string }) => {
      const botId = typeof payload?.botId === 'string' ? payload.botId : '';
      if (!botId) throw new Error('缺少 botId');
      let targetPath = typeof payload?.targetPath === 'string' ? payload.targetPath.trim() : '';
      if (!targetPath) {
        const botName = ctx.storage.listBots().find((bot) => bot.id === botId)?.name || 'assistant';
        const defaultFilename = `${sanitizeAssistantFilename(botName)}.okbot`;
        const result = await dialog.showSaveDialog({
          title: '导出助手',
          defaultPath: defaultFilename,
          filters: [
            { name: 'OkBot 助手包', extensions: ['okbot'] },
            { name: 'All', extensions: ['*'] },
          ],
        });
        if (result.canceled || !result.filePath) return { canceled: true as const };
        targetPath = result.filePath.endsWith('.okbot')
          ? result.filePath
          : `${result.filePath}.okbot`;
      }
      const out = ctx.storage.exportAssistantPackage(botId, targetPath);
      return { canceled: false as const, path: out.path };
    },
  );

  ipcMain.handle(
    IpcChannels.importAssistantPackage,
    async (_e, sourcePath?: string) => {
      let src = typeof sourcePath === 'string' ? sourcePath.trim() : '';
      if (!src) {
        const result = await dialog.showOpenDialog({
          title: '导入助手',
          properties: ['openFile', 'openDirectory'],
          filters: [
            { name: 'OkBot 助手包', extensions: ['okbot'] },
            { name: 'All', extensions: ['*'] },
          ],
        });
        if (result.canceled || !result.filePaths?.[0]) return { canceled: true as const };
        src = result.filePaths[0]!;
      }
      const bot = ctx.storage.importAssistantPackage(src);
      return { canceled: false as const, bot };
    },
  );

  ipcMain.handle(IpcChannels.listSquads, () => ctx.storage.withReplyPreviews(ctx.storage.listSquads()));
  ipcMain.handle(IpcChannels.createSquad, (_e, input) => ops.createSquad(input ?? {}));
  ipcMain.handle(IpcChannels.updateSquad, (_e, id: string, patch) => ops.updateSquad({ id, patch }));
  ipcMain.handle(IpcChannels.deleteSquad, (_e, id: string) => ops.deleteSquad({ id: id || '' }));
  ipcMain.handle(IpcChannels.listAssistantGallery, (_e, lang?: string) => ops.listAssistantGallery({ lang }));
  ipcMain.handle(IpcChannels.installGalleryAssistant, (_e, id: string, lang?: string) =>
    ops.installGalleryAssistant({ id: id || '', lang }),
  );
  ipcMain.handle(
    IpcChannels.setChatUnread,
    (_e, payload: { ownerId?: string; hasUnread?: boolean }) => ops.setChatUnread(payload ?? {}),
  );

  ipcMain.handle(IpcChannels.getSettings, () => ctx.storage.getSettings());
  ipcMain.handle(IpcChannels.getGatewayAccessToken, () => {
    const token = ctx.storage.getSettings().localHttpApi?.token;
    return typeof token === 'string' ? token : '';
  });
  ipcMain.handle(IpcChannels.getUsageStats, () => ctx.storage.getUsageStats());
  ipcMain.handle(IpcChannels.saveSettings, (_e, settings: AppSettings) =>
    persistAppSettings(ctx, settings),
  );

  ipcMain.handle(IpcChannels.discoverModels, (_e, payload) => ops.discoverModels(payload ?? {}));
  ipcMain.handle(IpcChannels.testModelConnection, (_e, payload) =>
    ops.testModelConnection(payload ?? {}),
  );

  ipcMain.handle(IpcChannels.getMessages, (_e, botId: string) => ctx.storage.getMessages(botId));
  ipcMain.handle(
    IpcChannels.getMessagesPage,
    (
      _e,
      payload: { botId: string; limit?: number; beforeMessageId?: string | null },
    ) =>
      ctx.storage.getMessagesPage(payload.botId, {
        limit: payload.limit,
        beforeMessageId: payload.beforeMessageId,
      }),
  );
  ipcMain.handle(IpcChannels.searchMessages, (_e, payload: { query: string; limit?: number }) =>
    ops.searchMessages(payload ?? {}),
  );
  ipcMain.handle(IpcChannels.getLastRunTrace, (_e, payload: { ownerId: string }) =>
    ops.getLastRunTrace(payload ?? {}),
  );
  ipcMain.handle(IpcChannels.getPromptContext, (_e, payload: { botId: string; messageId: string }) =>
    ops.getPromptContext(payload ?? {}),
  );
  ipcMain.handle(IpcChannels.getRecentErrorLog, (_e, limit?: number) =>
    ops.getRecentErrorLog({ limit }),
  );
  ipcMain.handle(
    IpcChannels.clearModelBindingsForProvider,
    (_e, payload: { providerId: string; removedModelIds?: string[] }) =>
      ops.clearModelBindingsForProvider(payload ?? {}),
  );
}
