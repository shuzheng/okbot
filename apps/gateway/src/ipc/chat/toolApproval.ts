import { isSquadOwnerId } from '../../storage/ids';
import { resolveLiveToolApproval } from '../chatControl';
import { resumeSquadAfterRestart } from '../squadResume';
import { resumeBotAfterRestart } from './coldRestoreBot';
import type { TurnContext } from './turnContext';

export async function respondToToolApproval(
  ctx: TurnContext,
  payload: { requestId: string; approved: boolean; message?: string },
): Promise<{ ok: boolean; error?: string; resumed?: boolean; aborted?: boolean }> {
  const decision = {
    approved: Boolean(payload.approved),
    message: payload.message,
  };

  const live = resolveLiveToolApproval(ctx, payload);
  if (live) return live;

  // Cold start: resume from disk-persisted RunState.
  const diskEntries = ctx.storage.listAllPendingHitl();
  const disk = diskEntries.find((p) => p.requestId === payload.requestId);
  if (!disk) return { ok: false, error: '没有待处理的工具审批' };

  // disk.botId is the chat owner (bot or squad). Squad cold-resume needs the
  // captain agent graph; mis-looking-up via listBots used to wipe squad pending.
  if (isSquadOwnerId(disk.botId)) {
    const squad = ctx.storage.listSquads().find((s) => s.id === disk.botId);
    if (!squad) {
      ctx.storage.clearPendingHitl(disk.botId);
      return { ok: false, error: '小队不存在' };
    }
    return resumeSquadAfterRestart(ctx, squad, disk, decision);
  }

  const bot = ctx.storage.listBots().find((b) => b.id === disk.botId);
  if (!bot) {
    ctx.storage.clearPendingHitl(disk.botId);
    return { ok: false, error: '助手不存在' };
  }

  return resumeBotAfterRestart(ctx, bot, disk, decision);
}
