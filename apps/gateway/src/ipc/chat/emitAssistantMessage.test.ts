/**
 * send_message host helper: emit tool content as a bubble; do not seal leftover live text.
 */
import assert from 'node:assert/strict';
import type { ChatMessage } from '@okbot/shared';
import {
  clearLiveAssistantForTools,
  commitLiveAssistantBubble,
  dropLeftoverFinalAfterSendMessage,
  emitAssistantMessageBubble,
  type LiveAssistantState,
} from './turnContext';

function makeLive(content = ''): LiveAssistantState {
  const id = 'msg-live-1';
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
const emits: Array<{ type: string; message: ChatMessage }> = [];
const noted: string[] = [];

const storage = {
  upsertAssistantMessage: async (_ownerId: string, msg: ChatMessage) => {
    upserts.push({ ...msg });
  },
} as unknown as Parameters<typeof emitAssistantMessageBubble>[2]['storage'];

function hostFor(live: LiveAssistantState) {
  return {
    ownerId: 'bot-1',
    runId: 'run-1',
    showThinking: false,
    storage,
    emit: (event: { type: string; message?: ChatMessage }) => {
      if (event.type === 'assistant_message' && event.message) {
        emits.push({ type: event.type, message: { ...event.message } });
      }
    },
    noteCommitted: (t: string) => {
      noted.push(t);
    },
  };
}

// commitLive: no-op when empty
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('');
  const did = await commitLiveAssistantBubble(live, hostFor(live), { meshInterim: true });
  assert.equal(did, false);
  assert.equal(upserts.length, 0);
  assert.equal(live.assistantId, 'msg-live-1');
}

// commitLive: seals + rotates
{
  upserts.length = 0;
  emits.length = 0;
  noted.length = 0;
  const live = makeLive('先说一句');
  const beforeId = live.assistantId;
  const did = await commitLiveAssistantBubble(live, hostFor(live), { meshInterim: true });
  assert.equal(did, true);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]!.content, '先说一句');
  assert.equal(upserts[0]!.meshInterim, true);
  assert.equal(emits.length, 1);
  assert.equal(noted[0], '先说一句');
  assert.notEqual(live.assistantId, beforeId);
  assert.equal(live.assistantMsg.content, '');
}

// emitAssistantMessage: discards leftover live text, emits only send_message content
{
  upserts.length = 0;
  emits.length = 0;
  noted.length = 0;
  const live = makeLive('直播中');
  const firstId = live.assistantId;
  await emitAssistantMessageBubble(live, '独立气泡正文', hostFor(live));
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]!.content, '独立气泡正文');
  assert.equal(upserts[0]!.meshInterim, undefined);
  assert.equal(emits.length, 1);
  assert.notEqual(live.assistantId, firstId);
  assert.equal(live.assistantMsg.content, '');
  // empty content no-op
  const idAfter = live.assistantId;
  await emitAssistantMessageBubble(live, '   ', hostFor(live));
  assert.equal(live.assistantId, idAfter);
  assert.equal(upserts.length, 1);
}


// clearLiveAssistantForTools: think-only → silent discard, no emit
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('<think>还在想</think>');
  const id = live.assistantId;
  await clearLiveAssistantForTools(live, hostFor(live));
  assert.equal(upserts.length, 0);
  assert.equal(emits.length, 0);
  assert.equal(live.assistantId, id);
  assert.equal(live.assistantMsg.content, '');
}

// clearLiveAssistantForTools: incomplete think → silent discard
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('<think>用户问了什么');
  await clearLiveAssistantForTools(live, hostFor(live));
  assert.equal(upserts.length, 0);
  assert.equal(emits.length, 0);
  assert.equal(live.assistantMsg.content, '');
}

// clearLiveAssistantForTools: visible live text is discarded (send_message is the bubble)
{
  upserts.length = 0;
  emits.length = 0;
  noted.length = 0;
  const live = makeLive('<think>计划</think>\n收到。Doubao 6 步，先开清单。');
  const beforeId = live.assistantId;
  await clearLiveAssistantForTools(live, hostFor(live));
  assert.equal(upserts.length, 0);
  assert.equal(emits.length, 0);
  assert.equal(live.assistantId, beforeId);
  assert.equal(live.assistantMsg.content, '');
}

// clearLiveAssistantForTools: persistVisible still seals when send_message is off
{
  upserts.length = 0;
  emits.length = 0;
  noted.length = 0;
  const live = makeLive('<think>计划</think>\n收到。Doubao 6 步，先开清单。');
  const beforeId = live.assistantId;
  await clearLiveAssistantForTools(live, hostFor(live), { persistVisible: true });
  assert.equal(upserts.length, 1);
  assert.equal(emits.length, 1);
  assert.match(upserts[0]!.content, /收到/);
  assert.notEqual(live.assistantId, beforeId);
  assert.equal(live.assistantMsg.content, '');
}

// emitAssistantMessage: leftover live is not promoted; only send_message text is kept
{
  upserts.length = 0;
  emits.length = 0;
  noted.length = 0;
  const live = makeLive('<think>计划</think>\n收到，开始课题 5 步调研。');
  await emitAssistantMessageBubble(live, '收到，课题调研分 5 步，先列清单再动手。', hostFor(live));
  assert.equal(upserts.length, 1, 'must not seal leftover live output_text as a bubble');
  assert.equal(emits.length, 1);
  assert.match(upserts[0]!.content, /课题调研分 5 步/);
  assert.equal(upserts[0]!.meshInterim, undefined);
}

// emitAssistantMessage: empty live + opening send_message → still emits
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('');
  await emitAssistantMessageBubble(live, '收到，课题调研分 5 步，先列清单再动手。', hostFor(live));
  assert.equal(upserts.length, 1);
  assert.equal(emits.length, 1);
  assert.match(upserts[0]!.content, /课题调研分 5 步/);
}

// emitAssistantMessage: distinct live progress is discarded; only send_message shows
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('第 1 步完成：公司与产品矩阵已摸清。');
  await emitAssistantMessageBubble(live, '开始第 2 步：模型架构。', hostFor(live));
  assert.equal(upserts.length, 1);
  assert.equal(emits.length, 1);
  assert.equal(upserts[0]!.content, '开始第 2 步：模型架构。');
}

// two different send_message calls stay two bubbles
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('');
  await emitAssistantMessageBubble(live, '先查公开口径。', hostFor(live));
  await emitAssistantMessageBubble(live, '结论表在这里。', hostFor(live));
  assert.equal(upserts.length, 2);
  assert.equal(emits.length, 2);
  assert.equal(upserts[0]!.content, '先查公开口径。');
  assert.equal(upserts[1]!.content, '结论表在这里。');
}

// leftover final after send_message is dropped
{
  const live = makeLive('已发送。');
  dropLeftoverFinalAfterSendMessage(live, true);
  assert.equal(live.assistantMsg.content, '');
  const kept = makeLive('正式回答');
  dropLeftoverFinalAfterSendMessage(kept, false);
  assert.equal(kept.assistantMsg.content, '正式回答');
}

// clearLive discards leftover live text; a later explicit commit still seals
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('<think>x</think>收到，开始调研。');
  await clearLiveAssistantForTools(live, hostFor(live));
  assert.equal(upserts.length, 0);
  live.assistantMsg.content = '收到，马上开干。';
  const did = await commitLiveAssistantBubble(live, hostFor(live), { meshInterim: true });
  assert.equal(did, true, 'explicit commit still seals');
  assert.equal(upserts.length, 1);
  assert.match(upserts[0]!.content, /马上开干/);
}

// long body starting with 收到 is sealed verbatim
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('');
  const longPlan =
    '收到，并行开两份 5 步调研：\n' +
    '- Baidu：公司与产品矩阵、核心模型能力、开发者生态、竞品对比、结论与风险\n' +
    '- Google：公司与产品矩阵、核心模型能力、开发者生态、竞品对比、结论与风险\n' +
    '- 两边并行抓公开资料、文档与新闻，交叉核对要点后再汇总交付';
  live.assistantMsg.content = longPlan;
  const did = await commitLiveAssistantBubble(live, hostFor(live), { meshInterim: true });
  assert.equal(did, true);
  assert.equal(upserts.length, 1);
  const sealed = upserts[0] as ChatMessage;
  assert.equal(sealed.content, longPlan, 'must not strip leading 收到');
  assert.match(sealed.content, /Baidu/);
}

console.log('emitAssistantMessage.test.ts: ok');
