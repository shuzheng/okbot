import { createRequire } from 'node:module';
import type { IpcMain } from 'electron';

/** Loaded only when registering IPC, so `okbot serve` can import chat turns under plain Node. */
function loadIpcMain(): IpcMain {
  const require = createRequire(import.meta.url);
  return (require('electron') as { ipcMain: IpcMain }).ipcMain;
}

import { IpcChannels, type ChatMessage } from '@okbot/shared';
import type { IpcContext } from './context';
import { abortChatOwner } from './chatControl';
import { orchestrateBotTurn } from './chat/orchestrateBotTurn';
import { startSquadTurn } from './chat/startSquadTurn';
import { respondToToolApproval } from './chat/toolApproval';
import { compressSessionNow } from './chat/compressSession';
import type { ChatStartPayload, ChatStartResult } from './chat/turnContext';

export type { ChatStartPayload, ChatStartResult } from './chat/turnContext';
export { respondToToolApproval } from './chat/toolApproval';
export { compressSessionNow } from './chat/compressSession';

export async function startChatTurn(
  ctx: IpcContext,
  payload: ChatStartPayload,
): Promise<ChatStartResult> {
  const text = (payload.text ?? '').trim();
  if (!text) throw new Error('请输入内容');

  if (payload.squadId) {
    // Squads: parallel turns unchanged for now (orchestrator classify deferred).
    return startSquadTurn(ctx, payload, text);
  }
  return orchestrateBotTurn(ctx, payload, text);
}

export function registerChatIpc(ctx: IpcContext): void {
  const ipcMain = loadIpcMain();

  ipcMain.handle(
    IpcChannels.toolRespond,
    (
      _e,
      payload: { requestId: string; approved: boolean; message?: string },
    ) => respondToToolApproval(ctx, payload),
  );

  ipcMain.handle(
    IpcChannels.chatStart,
    (
      _e,
      payload: {
        botId?: string;
        squadId?: string;
        text: string;
        quoteMessageId?: string;
        attachments?: ChatMessage['attachments'];
        computerId?: string;
        clientTurnId?: string;
      },
    ) => startChatTurn(ctx, payload),
  );

  ipcMain.handle(IpcChannels.chatAbort, (_e, botId: string) => abortChatOwner(ctx, botId));

  ipcMain.handle(IpcChannels.compressSessionNow, (_e, payload) =>
    compressSessionNow(ctx, payload),
  );

  ipcMain.handle(IpcChannels.getTasks, (_e, ownerId: string) => {
    const id = (ownerId || '').trim();
    if (!id) return [];
    try {
      return ctx.storage.loadOpenTasks(id);
    } catch (err) {
      console.error('[okbot] getTasks failed', err);
      return [];
    }
  });

  ipcMain.handle(IpcChannels.listOwnerTasks, (_e, ownerId: string) => {
    const id = (ownerId || '').trim();
    if (!id) return [];
    try {
      const tasks = ctx.storage.loadTasks(id);
      return [...tasks].sort((a, b) => {
        const at = a.startedAt || a.updatedAt || a.id;
        const bt = b.startedAt || b.updatedAt || b.id;
        return bt.localeCompare(at) || b.id.localeCompare(a.id);
      });
    } catch (err) {
      console.error('[okbot] listOwnerTasks failed', err);
      return [];
    }
  });

  ipcMain.handle(IpcChannels.listOwnerResources, (_e, ownerId: string) => {
    const id = (ownerId || '').trim();
    if (!id) return [];
    try {
      return ctx.storage.listOwnerResources(id);
    } catch (err) {
      console.error('[okbot] listOwnerResources failed', err);
      return [];
    }
  });
}
