import type { IpcContext } from './context';
import { bumpSteerGeneration } from './steerGate';

/**
 * Stop one bot or squad run the same way the desktop Stop button does:
 * bump steer generation (so a queued restart does not proceed), abort, and
 * reject live HITL waiters.
 */
export function abortChatOwner(
  ctx: Pick<IpcContext, 'abortControllers' | 'rejectPendingApprovalsForBot'>,
  ownerId: string,
): boolean {
  const id = (ownerId || '').trim();
  if (!id) return false;
  bumpSteerGeneration(id);
  const ctrl = ctx.abortControllers.get(id);
  ctrl?.abort();
  ctx.abortControllers.delete(id);
  ctx.rejectPendingApprovalsForBot(id, '已取消');
  return true;
}

/**
 * Resolve an in-memory tool approval. Returns null when this request is not
 * live (caller may cold-resume from disk).
 */
export function resolveLiveToolApproval(
  ctx: Pick<IpcContext, 'pendingToolApprovals' | 'storage'>,
  payload: { requestId: string; approved: boolean; message?: string },
): { ok: true } | { ok: false; error: string } | null {
  const requestId = (payload.requestId || '').trim();
  if (!requestId) return { ok: false, error: 'missing_request_id' };
  const live = ctx.pendingToolApprovals.get(requestId);
  if (!live) return null;
  ctx.pendingToolApprovals.delete(requestId);
  ctx.storage.clearPendingHitl(live.botId);
  live.resolve({
    approved: Boolean(payload.approved),
    message: payload.message,
  });
  return { ok: true };
}
