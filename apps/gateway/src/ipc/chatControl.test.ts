import assert from 'node:assert/strict';
import { abortChatOwner, armPendingToolTimeout, resolveLiveToolApproval } from './chatControl';
import {
  registerOwnerRun,
  resetOwnerRunQueuesForTests,
  setOwnerRunCheckpointFlush,
  type AbortControllerMap,
} from './ownerRuns';
import { resetSoftSteerStateForTests } from './softSteerGate';

const cleared: string[] = [];
const resolved: Array<{ approved: boolean; message?: string }> = [];
const controller = new AbortController();
const ctx = {
  abortControllers: new Map([['bot_1', new Map([['run_1', controller]])]]),
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
    clearPendingHitlRequest: (id: string, requestId: string) => {
      cleared.push(`hitl:${id}:${requestId}`);
    },
  },
};

const live = resolveLiveToolApproval(ctx as never, { requestId: 'req_1', approved: false, message: 'no' });
assert.deepEqual(live, { ok: true });
assert.equal(ctx.pendingToolApprovals.size, 0);
assert.deepEqual(resolved, [{ approved: false, message: 'no' }]);
assert.deepEqual(cleared, ['hitl:bot_1:req_1']);
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

await (async () => {
  const timed = {
    pendingToolApprovals: new Map<string, {
      botId: string;
      messageId: string;
      toolName: string;
      arguments: unknown;
      resolve: (d: { approved: boolean; message?: string }) => void;
      cancelTimeout?: () => void;
    }>(),
    storage: { clearPendingHitlRequest: (id: string) => cleared.push(`hitl:${id}`) },
  };
  const box: { decision: { approved: boolean; message?: string } | null } = { decision: null };
  timed.pendingToolApprovals.set('slow', {
    botId: 'bot_9',
    messageId: 'm',
    toolName: 'run_shell',
    arguments: {},
    resolve: (d) => {
      box.decision = d;
    },
  });
  const cancel = armPendingToolTimeout(
    timed as never,
    'slow',
    'bot_9',
    (d) => {
      box.decision = d;
    },
    20,
  );
  timed.pendingToolApprovals.get('slow')!.cancelTimeout = cancel;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(box.decision?.approved, false);
  assert.match(box.decision?.message || '', /超时/);
  assert.equal(timed.pendingToolApprovals.size, 0);

  const settled = {
    pendingToolApprovals: new Map<string, {
      botId: string;
      messageId: string;
      toolName: string;
      arguments: unknown;
      resolve: (d: { approved: boolean; message?: string }) => void;
      cancelTimeout?: () => void;
    }>(),
    storage: { clearPendingHitlRequest: () => cleared.push('settled') },
  };
  let late = 0;
  settled.pendingToolApprovals.set('fast', {
    botId: 'bot_8',
    messageId: 'm',
    toolName: 'run_shell',
    arguments: {},
    resolve: () => {
      late += 1;
    },
  });
  settled.pendingToolApprovals.get('fast')!.cancelTimeout = armPendingToolTimeout(
    settled as never,
    'fast',
    'bot_8',
    () => {
      late += 1;
    },
    30,
  );
  assert.deepEqual(
    resolveLiveToolApproval(settled as never, { requestId: 'fast', approved: true }),
    { ok: true },
  );
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(late, 1);
})();

{
  // Stop (abortChatOwner) flushes latest checkpoint before abort; resume can read it.
  resetOwnerRunQueuesForTests();
  resetSoftSteerStateForTests();
  const map: AbortControllerMap = new Map();
  const ctrl = new AbortController();
  const order: string[] = [];
  let savedPayload = '';
  registerOwnerRun(map, 'bot_stop_ckpt', 'run_stop', ctrl);
  setOwnerRunCheckpointFlush('bot_stop_ckpt', 'run_stop', () => {
    order.push('flush');
    savedPayload = 'stop-flushed-latest';
    assert.equal(ctrl.signal.aborted, false, 'Stop flush precedes abort');
  });
  ctrl.signal.addEventListener('abort', () => {
    order.push('abort');
  });
  const stopCtx = {
    abortControllers: map,
    rejectPendingApprovalsForBot: () => undefined,
    pendingToolApprovals: new Map(),
    storage: { clearPendingHitlRequest: () => undefined },
  };
  assert.equal(abortChatOwner(stopCtx as never, 'bot_stop_ckpt'), true);
  assert.deepEqual(order, ['flush', 'abort']);
  assert.equal(savedPayload, 'stop-flushed-latest');
  assert.equal(ctrl.signal.aborted, true);
  assert.equal(map.has('bot_stop_ckpt'), false);
}

console.log('chatControl.test.ts OK');
