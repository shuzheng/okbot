import { resolveToolApproval, type AppSettings } from '@okbot/shared';
import type { ToolApprovalDecision, ToolApprovalRequest } from '@okbot/agent';
import type { IpcContext } from './context';
import { armPendingToolTimeout } from './chatControl';

/**
 * One `onToolApprovalRequest` for every run kind (1:1, squad, cold resume).
 * Auto-approval rules first; otherwise park a live waiter, persist the RunState
 * per request for cold resume, emit `tool_request`, and arm the default-deny timer.
 */
export function createApprovalWaiter(
  ctx: IpcContext,
  opts: {
    ownerId: string;
    /** Current assistant bubble id (squad rotates it between segments). */
    messageId: () => string;
    settings: Pick<AppSettings, 'autoApprovalEnabled' | 'autoApprovalRules'>;
    signal: AbortSignal;
    computerId?: string;
    userText?: string;
    /** Squad only: groups parallel member approvals of one turn for cold resume. */
    turnId?: string;
    /** Parallel-turn id; required so gateway/attach SSE filters keep approval cards. */
    runId?: string;
    /**
     * Prefer the turn's `emitTurn` so `runId` is stamped like delta/tool_result.
     * Falls back to `sendRuntimeEvent` (still includes `runId` when provided).
     */
    emit?: (event: Parameters<IpcContext['sendRuntimeEvent']>[0]) => void;
    /** Called when a request waits for the user (not auto-approved). */
    onParked?: (requestId: string) => void;
  },
): (req: ToolApprovalRequest) => Promise<ToolApprovalDecision> {
  return ({ requestId, toolName, arguments: toolArgs, serializedRunState, squadMember }) =>
    new Promise<ToolApprovalDecision>((resolve) => {
      if (opts.signal.aborted) {
        resolve({ approved: false, message: '已取消' });
        return;
      }
      // MCP tools always ask (resolveToolApproval); rules apply to built-in tools only.
      const decision = resolveToolApproval(opts.settings, toolName, toolArgs);
      if (decision === 'allow') {
        resolve({ approved: true, message: '自动审批规则已允许' });
        return;
      }
      const messageId = opts.messageId();
      opts.onParked?.(requestId);
      ctx.pendingToolApprovals.set(requestId, {
        computerId: opts.computerId,
        botId: opts.ownerId,
        messageId,
        toolName,
        arguments: toolArgs,
        resolve,
      });
      if (serializedRunState) {
        try {
          ctx.storage.savePendingHitl(opts.ownerId, {
            computerId: opts.computerId,
            userText: opts.userText,
            v: 1,
            requestId,
            messageId,
            toolName,
            arguments: toolArgs,
            serializedRunState,
            ...(squadMember ? { squadMember } : {}),
            ...(opts.turnId ? { turnId: opts.turnId } : {}),
            createdAt: new Date().toISOString(),
          });
        } catch (err) {
          console.error('[okbot] save pending hitl failed', err);
        }
      }
      const runId = (opts.runId || '').trim() || undefined;
      const emit = opts.emit ?? ((event) => ctx.sendRuntimeEvent(event));
      emit({
        type: 'tool_request',
        botId: opts.ownerId,
        messageId,
        requestId,
        toolName,
        arguments: toolArgs,
        ...(runId ? { runId } : {}),
      });
      const pending = ctx.pendingToolApprovals.get(requestId);
      const cancelTimeout = armPendingToolTimeout(ctx, requestId, opts.ownerId, resolve);
      if (pending) pending.cancelTimeout = cancelTimeout;
      const onAbort = () => {
        cancelTimeout();
        if (!ctx.pendingToolApprovals.has(requestId)) return;
        ctx.pendingToolApprovals.delete(requestId);
        ctx.storage.clearPendingHitlRequest(opts.ownerId, requestId);
        resolve({ approved: false, message: '已取消' });
      };
      opts.signal.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * End of one run: reject the waiters this run parked and drop only their disk
 * records. Cold approvals of other requests (for example a parallel squad member
 * after a restart) and the collected member replies stay on disk.
 */
export function releaseRunApprovals(
  ctx: Pick<IpcContext, 'pendingToolApprovals' | 'storage'>,
  ownerId: string,
  requestIds: Iterable<string>,
  message: string,
): void {
  for (const requestId of requestIds) {
    const pending = ctx.pendingToolApprovals.get(requestId);
    if (pending && pending.botId === ownerId) {
      pending.cancelTimeout?.();
      ctx.pendingToolApprovals.delete(requestId);
      pending.resolve({ approved: false, message });
    }
    ctx.storage.clearPendingHitlRequest(ownerId, requestId);
  }
}
