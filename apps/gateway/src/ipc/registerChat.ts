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
import { setMessageReaction } from './messageReaction';

export type { ChatStartPayload, ChatStartResult } from './chat/turnContext';
export { respondToToolApproval } from './chat/toolApproval';
export { compressSessionNow } from './chat/compressSession';

export type StartChatTurnOptions = {
  /**
   * When false, return after the initiating turn; auto-continue runs in the
   * background. Default true (IPC / most callers). Schedule + HTTP SSE pass false.
   */
  awaitAutoContinue?: boolean;
};

export async function startChatTurn(
  ctx: IpcContext,
  payload: ChatStartPayload,
  opts?: StartChatTurnOptions,
): Promise<ChatStartResult> {
  const text = (payload.text ?? '').trim();
  if (!text) throw new Error('请输入内容');

  if (payload.squadId) {
    // Squads: parallel turns unchanged for now (orchestrator classify deferred).
    return startSquadTurn(ctx, payload, text);
  }
  return orchestrateBotTurn(ctx, payload, text, {
    awaitAutoContinue: opts?.awaitAutoContinue,
  });
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

  ipcMain.handle(
    IpcChannels.setMessageReaction,
    (
      _e,
      payload: {
        botId?: string;
        squadId?: string;
        messageId: string;
        emoji: string | null;
      },
    ) => setMessageReaction(ctx, { ...payload, from: 'user' }),
  );

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

  ipcMain.handle(IpcChannels.deleteOwnerTask, (_e, payload: { ownerId?: string; taskId?: string }) => {
    const ownerId = (payload?.ownerId || '').trim();
    const taskId = (payload?.taskId || '').trim();
    if (!ownerId || !taskId) {
      return { ok: false as const, error: 'missing_ids' };
    }
    try {
      ctx.storage.deleteTask(ownerId, taskId);
      try {
        ctx.sendRuntimeEvent({
          type: 'tasks_changed',
          botId: ownerId,
          tasks: ctx.storage.loadOpenTasks(ownerId),
        });
      } catch (err) {
        console.error('[okbot] tasks_changed emit failed', err);
      }
      return { ok: true as const };
    } catch (err) {
      console.error('[okbot] deleteOwnerTask failed', err);
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
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

  ipcMain.handle(
    IpcChannels.deleteOwnerResource,
    (_e, payload: { ownerId?: string; resourceId?: string }) => {
      const ownerId = (payload?.ownerId || '').trim();
      const resourceId = (payload?.resourceId || '').trim();
      if (!ownerId || !resourceId) {
        return { ok: false as const, error: 'missing_ids' };
      }
      try {
        ctx.storage.deleteOwnerResource(ownerId, resourceId);
        return { ok: true as const };
      } catch (err) {
        console.error('[okbot] deleteOwnerResource failed', err);
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    IpcChannels.readOwnerResourceText,
    (_e, payload: { ownerId?: string; resourceId?: string }) => {
      const ownerId = (payload?.ownerId || '').trim();
      const resourceId = (payload?.resourceId || '').trim();
      if (!ownerId || !resourceId) {
        return { ok: false as const, error: 'missing_ids' };
      }
      try {
        const text = ctx.storage.readOwnerResourceText(ownerId, resourceId);
        return { ok: true as const, text };
      } catch (err) {
        console.error('[okbot] readOwnerResourceText failed', err);
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    IpcChannels.writeOwnerResourceText,
    (_e, payload: { ownerId?: string; resourceId?: string; text?: string }) => {
      const ownerId = (payload?.ownerId || '').trim();
      const resourceId = (payload?.resourceId || '').trim();
      const text = typeof payload?.text === 'string' ? payload.text : '';
      if (!ownerId || !resourceId) {
        return { ok: false as const, error: 'ownerId and resourceId required' };
      }
      try {
        const record = ctx.storage.writeOwnerResourceText(ownerId, resourceId, text);
        return { ok: true as const, record };
      } catch (err) {
        console.error('[okbot] writeOwnerResourceText failed', err);
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    IpcChannels.addOwnerResource,
    (
      _e,
      payload: {
        ownerId?: string;
        action?: 'note' | 'url' | 'folder' | 'file-link' | 'ingest';
        title?: string;
        body?: string;
        html?: string;
        target?: string;
        sourcePath?: string;
      },
    ) => {
      const ownerId = (payload?.ownerId || '').trim();
      const action = payload?.action;
      if (!ownerId || !action) {
        return { ok: false as const, error: 'missing_args' };
      }
      try {
        let record;
        if (action === 'note') {
          record = ctx.storage.addOwnerResourceNote(ownerId, {
            title: payload.title,
            body: payload.body,
            html: payload.html,
            createdBy: 'user',
          });
        } else if (action === 'url') {
          record = ctx.storage.addOwnerResourceLink(ownerId, {
            kind: 'url',
            target: payload.target || '',
            title: payload.title,
            createdBy: 'user',
          });
        } else if (action === 'folder') {
          record = ctx.storage.addOwnerResourceLink(ownerId, {
            kind: 'folder',
            target: payload.target || '',
            title: payload.title,
            createdBy: 'user',
          });
        } else if (action === 'file-link') {
          record = ctx.storage.addOwnerResourceLink(ownerId, {
            kind: 'file',
            target: payload.target || payload.sourcePath || '',
            title: payload.title,
            createdBy: 'user',
          });
        } else if (action === 'ingest') {
          record = ctx.storage.ingestOwnerResourceFile(ownerId, {
            sourcePath: payload.sourcePath || payload.target || '',
            title: payload.title,
            createdBy: 'user',
          });
        } else {
          return { ok: false as const, error: 'unknown_action' };
        }
        return { ok: true as const, record };
      } catch (err) {
        console.error('[okbot] addOwnerResource failed', err);
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}
