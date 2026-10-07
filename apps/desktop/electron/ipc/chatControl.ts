import type { IpcContext } from './context';
import { abortAllOwnerRuns } from './ownerRuns';

/**
 * Stop one bot or squad the same way the desktop Stop button does:
 * cancel queued parallel waits, abort every in-flight run for that owner,
 * and reject live HITL waiters.
 */
export function abortChatOwner(
  ctx: Pick<IpcContext, 'abortControllers' | 'rejectPendingApprovalsForBot'>,
  ownerId: string,
): boolean {
  const id = (ownerId || '').trim();
  if (!id) return false;
  const had = abortAllOwnerRuns(ctx.abortControllers, id);
  ctx.rejectPendingApprovalsForBot(id, '已取消');
  return had;
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
  live.cancelTimeout?.();
  ctx.pendingToolApprovals.delete(requestId);
  // Only this approval: a parallel turn may still wait on its own card.
  ctx.storage.clearPendingHitlRequest(live.botId, requestId);
  live.resolve({
    approved: Boolean(payload.approved),
    message: payload.message,
  });
  return { ok: true };
}

/** Ask-mode approvals otherwise wait forever if the UI never answers. */
export const TOOL_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Default-deny a live approval. No-op if it was already resolved.
 * Returns a cancel function for abort or an explicit decision.
 */
export function armPendingToolTimeout(
  ctx: Pick<IpcContext, 'pendingToolApprovals' | 'storage'>,
  requestId: string,
  ownerId: string,
  resolve: (decision: { approved: boolean; message?: string }) => void,
  timeoutMs = TOOL_APPROVAL_TIMEOUT_MS,
): () => void {
  const timer = setTimeout(() => {
    const live = ctx.pendingToolApprovals.get(requestId);
    if (!live) return;
    ctx.pendingToolApprovals.delete(requestId);
    try {
      ctx.storage.clearPendingHitlRequest(ownerId, requestId);
    } catch (err) {
      console.error('[okbot] clear pending hitl on approval timeout failed', err);
    }
    resolve({ approved: false, message: '审批超时，已拒绝' });
  }, timeoutMs);
  timer.unref?.();
  return () => clearTimeout(timer);
}
