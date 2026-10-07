import assert from 'node:assert/strict';
import { abortChatOwner, resolveLiveToolApproval } from './chatControl';
import type { IpcContext } from './context';

function makeCtx(overrides: Partial<IpcContext> = {}): Pick<
  IpcContext,
  'abortControllers' | 'pendingToolApprovals' | 'storage' | 'rejectPendingApprovalsForBot'
> {
  const abortControllers = new Map<string, Map<string, AbortController>>();
  const pendingToolApprovals = new Map<
    string,
    {
      computerId: string;
      botId: string;
      messageId: string;
      toolName: string;
      arguments: string;
      resolve: (d: { approved: boolean; message?: string }) => void;
      cancelTimeout?: () => void;
    }
  >();
  const cleared: string[] = [];
  return {
    abortControllers,
    pendingToolApprovals,
    storage: {
      clearPendingHitl: (ownerId: string) => {
        cleared.push(ownerId);
      },
      clearPendingHitlRequest: (ownerId: string) => {
        cleared.push(ownerId);
      },
    } as unknown as IpcContext['storage'],
    rejectPendingApprovalsForBot: (botId: string, message?: string) => {
      for (const [requestId, pending] of [...pendingToolApprovals.entries()]) {
        if (pending.botId !== botId) continue;
        pending.cancelTimeout?.();
        pendingToolApprovals.delete(requestId);
        pending.resolve({ approved: false, message: message || '已取消' });
      }
    },
    ...overrides,
  };
}

// Live toolRespond path resolves waiter and clears HITL.
{
  const ctx = makeCtx();
  let decided: { approved: boolean; message?: string } | undefined;
  ctx.pendingToolApprovals.set('req-1', {
    computerId: 'local',
    botId: 'bot-1',
    messageId: 'm1',
    toolName: 'run_shell',
    arguments: '{}',
    resolve: (d) => {
      decided = d;
    },
  });
  const live = resolveLiveToolApproval(ctx, { requestId: 'req-1', approved: true });
  assert.deepEqual(live, { ok: true });
  assert.equal(decided?.approved, true);
  assert.equal(ctx.pendingToolApprovals.size, 0);
}

// Missing live approval returns null (cold path may resume).
{
  const ctx = makeCtx();
  assert.equal(resolveLiveToolApproval(ctx, { requestId: 'nope', approved: false }), null);
}

// Abort clears controller and rejects pending approvals for that owner.
{
  const ctx = makeCtx();
  const controller = new AbortController();
  ctx.abortControllers.set('bot-2', new Map([['run-1', controller]]));
  let decided: { approved: boolean; message?: string } | undefined;
  ctx.pendingToolApprovals.set('req-2', {
    computerId: 'local',
    botId: 'bot-2',
    messageId: 'm2',
    toolName: 'write_file',
    arguments: '{}',
    resolve: (d) => {
      decided = d;
    },
  });
  assert.equal(abortChatOwner(ctx, 'bot-2'), true);
  assert.equal(ctx.abortControllers.has('bot-2'), false);
  assert.equal(controller.signal.aborted, true);
  assert.equal(decided?.approved, false);
  assert.equal(ctx.pendingToolApprovals.size, 0);
}

console.log('gatewayBridgeControl.test ok');
