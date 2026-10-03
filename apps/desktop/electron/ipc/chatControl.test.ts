import assert from 'node:assert/strict';
import { abortChatOwner, resolveLiveToolApproval } from './chatControl';

const cleared: string[] = [];
const resolved: Array<{ approved: boolean; message?: string }> = [];
const controller = new AbortController();
const ctx = {
  abortControllers: new Map<string, AbortController>([['bot_1', controller]]),
  rejectPendingApprovalsForBot: (id: string) => {
    cleared.push(id);
  },
  pendingToolApprovals: new Map([
    [
      'req_1',
      {
        botId: 'bot_1',
        messageId: 'm',
        toolName: 'run_shell',
        arguments: {},
        resolve: (d: { approved: boolean; message?: string }) => {
          resolved.push(d);
        },
      },
    ],
  ]),
  storage: {
    clearPendingHitl: (id: string) => {
      cleared.push(`hitl:${id}`);
    },
  },
};

const live = resolveLiveToolApproval(ctx as never, { requestId: 'req_1', approved: false, message: 'no' });
assert.deepEqual(live, { ok: true });
assert.equal(ctx.pendingToolApprovals.size, 0);
assert.deepEqual(resolved, [{ approved: false, message: 'no' }]);
assert.deepEqual(cleared, ['hitl:bot_1']);
assert.equal(resolveLiveToolApproval(ctx as never, { requestId: 'missing', approved: true }), null);
assert.deepEqual(resolveLiveToolApproval(ctx as never, { requestId: '  ', approved: true }), {
  ok: false,
  error: 'missing_request_id',
});

assert.equal(abortChatOwner(ctx as never, 'bot_1'), true);
assert.equal(controller.signal.aborted, true);
assert.equal(ctx.abortControllers.has('bot_1'), false);
assert.ok(cleared.includes('bot_1'));
assert.equal(abortChatOwner(ctx as never, '  '), false);

console.log('chatControl.test.ts OK');
