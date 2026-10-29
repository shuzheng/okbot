/**
 * send_message host helper: seal live → emit content bubble → rotate id.
 */
import assert from 'node:assert/strict';
import type { ChatMessage } from '@okbot/shared';
import {
  clearLiveAssistantForTools,
  commitLiveAssistantBubble,
  emitAssistantMessageBubble,
  isDuplicateOpeningAck,
  stripLeadingOpeningAckSentence,
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

// emitAssistantMessage: seals live then emits tool content then rotates again
{
  upserts.length = 0;
  emits.length = 0;
  noted.length = 0;
  const live = makeLive('直播中');
  const firstId = live.assistantId;
  await emitAssistantMessageBubble(live, '独立气泡正文', hostFor(live));
  assert.equal(upserts.length, 2);
  assert.equal(upserts[0]!.content, '直播中');
  assert.equal(upserts[0]!.meshInterim, true);
  assert.equal(upserts[1]!.content, '独立气泡正文');
  assert.equal(upserts[1]!.meshInterim, undefined);
  assert.equal(emits.length, 2);
  assert.notEqual(live.assistantId, firstId);
  assert.equal(live.assistantMsg.content, '');
  // empty content no-op
  const idAfter = live.assistantId;
  await emitAssistantMessageBubble(live, '   ', hostFor(live));
  assert.equal(live.assistantId, idAfter);
  assert.equal(upserts.length, 2);
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

// clearLiveAssistantForTools: visible ack → seal bubble + rotate
{
  upserts.length = 0;
  emits.length = 0;
  noted.length = 0;
  const live = makeLive('<think>计划</think>\n收到。Doubao 6 步，先开清单。');
  const beforeId = live.assistantId;
  await clearLiveAssistantForTools(live, hostFor(live));
  assert.equal(upserts.length, 1);
  assert.equal(emits.length, 1);
  assert.match(upserts[0]!.content, /收到/);
  assert.notEqual(live.assistantId, beforeId);
  assert.equal(live.assistantMsg.content, '');
}

// isDuplicateOpeningAck: near-identical opening 收到
{
  assert.equal(
    isDuplicateOpeningAck('收到，开始课题 5 步调研。', '收到，课题调研分 5 步，先列清单再动手。'),
    true,
  );
  assert.equal(
    isDuplicateOpeningAck('<think>x</think>收到，开始。', '收到，开始。'),
    true,
  );
  assert.equal(
    isDuplicateOpeningAck('收到，开始课题 5 步调研。', '第 1 步完成：课题背景与范围…详细内容'),
    false,
  );
  assert.equal(
    isDuplicateOpeningAck('继续。第 4 步生态对比：开源协议。', '第 4 步生态对比已开干，并行抓 GitHub。'),
    false,
  );
  // Short opening + long bullet-plan second bubble (both start with 收到) → duplicate
  const longPlan =
    '收到，并行开两份 5 步调研：\n' +
    '- Baidu：公司与产品矩阵、核心模型能力、开发者生态、竞品对比、结论与风险\n' +
    '- Google：公司与产品矩阵、核心模型能力、开发者生态、竞品对比、结论与风险\n' +
    '- 两边并行抓公开资料、文档与新闻，交叉核对要点后再汇总交付';
  assert.ok(longPlan.length > 120, 'fixture must exceed old ≤120 gate');
  assert.equal(
    isDuplicateOpeningAck(
      '收到，Baidu 和 Google 各 5 步调研并行开起来。先发确认气泡，再写两份清单。',
      longPlan,
    ),
    true,
  );
  // Mid-run「继续」must not length-bypass against a long progress body
  assert.equal(
    isDuplicateOpeningAck('继续。第 4 步生态对比。', longPlan.replace(/^收到/, '第 4 步')),
    false,
  );
}

// stripLeadingOpeningAckSentence: keep body after 收到 intro
{
  const body = stripLeadingOpeningAckSentence(
    '收到，并行开两份 5 步调研：\n- Baidu\n- Google',
  );
  assert.equal(body.includes('收到'), false);
  assert.match(body, /Baidu/);
  assert.equal(stripLeadingOpeningAckSentence('收到，开始调研。'), '');
}

// emitAssistantMessage: live opening ack ≈ send_message → only one bubble
{
  upserts.length = 0;
  emits.length = 0;
  noted.length = 0;
  const live = makeLive('<think>计划</think>\n收到，开始课题 5 步调研。');
  await emitAssistantMessageBubble(live, '收到，课题调研分 5 步，先列清单再动手。', hostFor(live));
  assert.equal(upserts.length, 1, 'must not seal live + send_message as two 收到');
  assert.equal(emits.length, 1);
  assert.match(upserts[0]!.content, /课题调研分 5 步/);
  assert.equal(upserts[0]!.meshInterim, undefined);
  assert.equal(live.lastEmittedVisible?.includes('收到') || live.lastEmittedVisible?.includes('课题'), true);
}

// emitAssistantMessage: prior sealed ack + similar send_message → skip send
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('');
  live.lastEmittedVisible = '收到，开始课题 5 步调研。';
  await emitAssistantMessageBubble(live, '收到，课题调研分 5 步，先列清单再动手。', hostFor(live));
  assert.equal(upserts.length, 0, 'skip send when lastEmitted is duplicate opening ack');
  assert.equal(emits.length, 0);
}

// emitAssistantMessage: distinct live progress + send_message → two bubbles
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('第 1 步完成：公司与产品矩阵已摸清。');
  await emitAssistantMessageBubble(live, '开始第 2 步：模型架构。', hostFor(live));
  assert.equal(upserts.length, 2);
  assert.equal(emits.length, 2);
}

// clearLive then duplicate: second commit dropped
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('<think>x</think>收到，开始调研。');
  await clearLiveAssistantForTools(live, hostFor(live));
  assert.equal(upserts.length, 1);
  live.assistantMsg.content = '收到，马上开干。';
  const did = await commitLiveAssistantBubble(live, hostFor(live), { meshInterim: true });
  assert.equal(did, false, 'second near-identical opening ack must not seal');
  assert.equal(upserts.length, 1);
}

// send_message short 收到 + sealed long 收到+bullets → strip, one body bubble
{
  upserts.length = 0;
  emits.length = 0;
  const live = makeLive('');
  live.lastEmittedVisible =
    '收到，Baidu 和 Google 各 5 步调研并行开起来。先发确认气泡，再写两份清单。';
  const longPlan =
    '收到，并行开两份 5 步调研：\n' +
    '- Baidu：公司与产品矩阵、核心模型能力、开发者生态、竞品对比、结论与风险\n' +
    '- Google：公司与产品矩阵、核心模型能力、开发者生态、竞品对比、结论与风险\n' +
    '- 两边并行抓公开资料、文档与新闻，交叉核对要点后再汇总交付';
  live.assistantMsg.content = longPlan;
  const did = await commitLiveAssistantBubble(live, hostFor(live), { meshInterim: true });
  assert.equal(did, true, 'long re-open should seal stripped body');
  assert.equal(upserts.length, 1);
  const sealed = upserts[0] as ChatMessage;
  assert.equal(sealed.content.includes('收到'), false, 'leading 收到 stripped');
  assert.match(sealed.content, /Baidu/);
}

console.log('emitAssistantMessage.test.ts: ok');

