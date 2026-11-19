/**
 * set_status host helper: emit ephemeral placeholder, skip when live has text,
 * clear on abort / empty finish. Must not persist or write into the live bubble.
 */
import assert from 'node:assert/strict';
import type { ChatMessage } from '@okbot/shared';
import {
  clearAssistantStatusPlaceholder,
  emitAssistantMessageBubble,
  emitAssistantStatusPlaceholder,
  shouldClearAssistantStatusOnTurnEnd,
  type LiveAssistantState,
} from './turnContext';

function makeLive(content = '', id = 'msg-live-1'): LiveAssistantState {
  return {
    assistantId: id,
    assistantMsg: {
      id,
      role: 'assistant',
      content,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

const upserts: ChatMessage[] = [];
const emits: Array<{ type: string; messageId?: string; status?: string; runId?: string; message?: ChatMessage }> = [];

const storage = {
  upsertAssistantMessage: async (_ownerId: string, msg: ChatMessage) => {
    upserts.push({ ...msg });
  },
} as unknown as Parameters<typeof emitAssistantMessageBubble>[2]['storage'];

function hostFor() {
  return {
    ownerId: 'bot-1',
    runId: 'run-1',
    showThinking: false,
    storage,
    emit: (event: { type: string; messageId?: string; status?: string; runId?: string; message?: ChatMessage }) => {
      emits.push({
        type: event.type,
        messageId: event.messageId,
        status: event.status,
        runId: event.runId,
        message: event.message ? { ...event.message } : undefined,
      });
    },
  };
}

// set: emits assistant_status, does not persist, does not write live content
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('');
  const result = emitAssistantStatusPlaceholder(live, '  正在对比两家餐厅  ', hostFor());
  assert.equal(result, 'ok');
  assert.equal(emits.length, 1);
  assert.equal(emits[0]!.type, 'assistant_status');
  assert.equal(emits[0]!.messageId, 'msg-live-1');
  assert.equal(emits[0]!.status, '正在对比两家餐厅');
  assert.equal(emits[0]!.runId, 'run-1');
  assert.equal(upserts.length, 0);
  assert.equal(live.assistantMsg.content, '');
  assert.equal(live.assistantId, 'msg-live-1');
}

// update same live id (caller emits again; no extra bubble / no persist)
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('');
  emitAssistantStatusPlaceholder(live, '正在对比两家餐厅', hostFor());
  emitAssistantStatusPlaceholder(live, '正在查询今晚 7 点空位', hostFor());
  assert.equal(emits.length, 2);
  assert.equal(emits[1]!.messageId, 'msg-live-1');
  assert.equal(emits[1]!.status, '正在查询今晚 7 点空位');
  assert.equal(upserts.length, 0);
  assert.equal(live.assistantId, 'msg-live-1');
}

// skip when live already has visible streamed text (do not overwrite)
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('已经写了正文');
  const result = emitAssistantStatusPlaceholder(live, '正在对比两家餐厅', hostFor());
  assert.equal(result, 'skipped_live_content');
  assert.equal(emits.length, 0);
  assert.equal(live.assistantMsg.content, '已经写了正文');
}

// think-only live content is not visible — status is allowed
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('<think>还在想</think>');
  const result = emitAssistantStatusPlaceholder(live, '正在对比两家餐厅', hostFor());
  assert.equal(result, 'ok');
  assert.equal(emits.length, 1);
  assert.equal(emits[0]!.status, '正在对比两家餐厅');
  assert.equal(live.assistantMsg.content, '<think>还在想</think>');
}

// empty status is a no-op
{
  emits.length = 0;
  const live = makeLive('');
  assert.equal(emitAssistantStatusPlaceholder(live, '   ', hostFor()), 'empty');
  assert.equal(emits.length, 0);
}

// send_message real content replaces: persist + assistant_message on same id; status not persisted
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('');
  emitAssistantStatusPlaceholder(live, '正在对比两家餐厅', hostFor());
  await emitAssistantMessageBubble(live, 'A 更安静，建议订 A。', hostFor());
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]!.id, 'msg-live-1');
  assert.equal(upserts[0]!.content, 'A 更安静，建议订 A。');
  const statusEvents = emits.filter((e) => e.type === 'assistant_status');
  const messageEvents = emits.filter((e) => e.type === 'assistant_message');
  assert.equal(statusEvents.length, 1);
  assert.equal(messageEvents.length, 1);
  assert.equal(messageEvents[0]!.message?.id, 'msg-live-1');
  assert.notEqual(live.assistantId, 'msg-live-1');
  assert.equal(live.assistantMsg.content, '');
  // placeholder was never upserted as its own row
  assert.equal(upserts.some((m) => m.content === '正在对比两家餐厅'), false);
}

// after a sealed bubble, set_status opens a new placeholder on the rotated id
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('');
  await emitAssistantMessageBubble(live, '先对比这两家，再帮你订。', hostFor());
  const nextId = live.assistantId;
  const result = emitAssistantStatusPlaceholder(live, '正在查询今晚 7 点空位', hostFor());
  assert.equal(result, 'ok');
  const last = emits[emits.length - 1]!;
  assert.equal(last.type, 'assistant_status');
  assert.equal(last.messageId, nextId);
  assert.equal(last.status, '正在查询今晚 7 点空位');
}

// abort / finish without a real reply: clear event, still no persist
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('');
  emitAssistantStatusPlaceholder(live, '正在对比两家餐厅', hostFor());
  clearAssistantStatusPlaceholder(live, hostFor());
  assert.equal(emits.length, 2);
  assert.equal(emits[1]!.type, 'assistant_status');
  assert.equal(emits[1]!.status, '');
  assert.equal(emits[1]!.messageId, 'msg-live-1');
  assert.equal(emits[1]!.runId, 'run-1');
  assert.equal(upserts.length, 0);
  assert.equal(live.assistantMsg.content, '');
}

// Soft-steer abort keeps the placeholder; Stop / clean finish still clear.
assert.equal(
  shouldClearAssistantStatusOnTurnEnd({ aborted: true, softSteerHandoff: true }),
  false,
);
assert.equal(
  shouldClearAssistantStatusOnTurnEnd({ aborted: true, softSteerHandoff: false }),
  true,
);
assert.equal(
  shouldClearAssistantStatusOnTurnEnd({ aborted: false, softSteerHandoff: true }),
  true,
);
assert.equal(
  shouldClearAssistantStatusOnTurnEnd({ aborted: false, softSteerHandoff: false }),
  true,
);

console.log('emitAssistantStatus.test.ts: ok');

