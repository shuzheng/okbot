/**
 * send_message: prefs-gated registration, never HITL, instructions when enabled.
 * Host emitAssistantMessage is required at execute time (1:1 binds it).
 */
import assert from 'node:assert/strict';
import { DEFAULT_TOOL_PREFERENCES, DEFAULT_SECURITY } from '@okbot/shared';
import { listEnabledToolIds, formatEnabledLocalToolsLine, buildAgentInstructions } from './instructions.js';
import { buildTools } from './tools.js';

const prefsOn = {
  ...DEFAULT_TOOL_PREFERENCES,
  send_message: { enabled: true, approval: 'allow' as const },
};

const prefsOff = {
  ...DEFAULT_TOOL_PREFERENCES,
  send_message: { enabled: false, approval: 'allow' as const },
};

assert.equal(listEnabledToolIds(prefsOn).includes('send_message'), true);
assert.equal(listEnabledToolIds(prefsOff).includes('send_message'), false);
assert.equal(formatEnabledLocalToolsLine(prefsOn).includes('send_message'), true);
assert.equal(formatEnabledLocalToolsLine(prefsOn).includes('回复消息'), true);

const instrOn = buildAgentInstructions('t', '', [], prefsOn);
assert.equal(instrOn.includes('send_message'), true);
assert.equal(instrOn.includes('每条用户消息一到（含忙时插入/软接管）'), true, 'start bubble on every message including steer');
assert.equal(instrOn.includes('同一条里同时说正在做的和这条新消息要做的'), true, 'busy-steer start bubble covers in-flight and new work');
assert.equal(instrOn.includes('不要再另写开场确认'), true, 'start bubble replaces the old opening-ack essays');
assert.equal(instrOn.includes('某步有阶段性进展或可见结果，立刻发一条'), true, 'must send staged progress immediately');
assert.equal(instrOn.includes('不要等全部做完再一次性发出'), true, 'must not hold bubbles until the end');
assert.equal(instrOn.includes('不要按字数、句号或气泡长度把同一份进展切碎'), true, 'must not split by length or punctuation');
assert.equal(instrOn.includes('不要在同一次工具调用批次里连发多条 send_message'), true, 'must not batch multiple send_message');
assert.equal(instrOn.includes('某一件事做完，发一条短结果'), true, 'finish bubble reports the completed item');
assert.equal(instrOn.includes('若同轮还有其他未完成的事，自然带一句那些事的进度'), true, 'finish bubble mentions other in-flight work');
assert.equal(instrOn.includes('不要套固定句式'), true, 'must not copy a fixed finish template');
assert.equal(instrOn.includes('不要再写最终 output_text、摘要或同义收尾'), true, 'no leftover final output_text after send_message');
assert.equal(instrOn.includes('send_message 与最终回复是二选一的出口'), true, 'send_message and final reply are alternative exits');
assert.equal(instrOn.includes('不是先后两步'), true, 'must not treat final reply as a second step after tools');
assert.equal(instrOn.includes('已用 send_message 发过内容则不要再追加最终回复'), true, 'no leftover final after send_message');
assert.equal(instrOn.includes('长任务开场'), false, 'old long-task opening-ack essay must be gone');
assert.equal(instrOn.includes('开场确认只能走 send_message 一次'), false, 'old special-case opening ack must be gone');
assert.equal(instrOn.includes('不要预先规划要点再分条'), false, 'old pre-plan split wording must be gone');
assert.equal(instrOn.includes('按 set_status 的步骤循环拆分'), false, 'old set_status-step split wording must be gone');
assert.equal(instrOn.includes('两三个不同的要点'), false, 'old beat-based split wording must be gone');
assert.equal(instrOn.includes('表情回应'), true, 'must teach emoji-only reactions via send_message');
assert.equal(instrOn.includes('reactToMessageId'), true, 'must name reactToMessageId in prompt');
assert.equal(instrOn.includes('react_message'), false, 'must not invent a separate react_message tool');

const instrOff = buildAgentInstructions('t', '', [], prefsOff);
assert.equal(instrOff.includes('每条用户消息一到（含忙时插入/软接管）'), false);
assert.equal(instrOff.includes('不要预先规划要点再分条'), false);
assert.equal(instrOff.includes('长任务开场'), false);

const toolsOn = buildTools(prefsOn, DEFAULT_SECURITY, undefined, {
  emitAssistantMessage: async () => {},
});
const sendOn = toolsOn.find((t) => (t as { name?: string }).name === 'send_message') as
  | { name?: string; description?: string }
  | undefined;
assert.ok(sendOn, 'prefs-on must register send_message');
assert.equal(
  (sendOn!.description ?? '').includes('send_message 与最终回复是二选一的出口'),
  true,
  'tool description must treat send_message and final reply as alternative exits',
);
assert.equal(
  (sendOn!.description ?? '').includes('每条用户消息先发一句要做什么'),
  true,
  'tool description must require a start bubble on every message',
);
assert.equal(
  (sendOn!.description ?? '').includes('忙时插入则同时说正在做的和要做的'),
  true,
  'tool description must cover in-flight and new work on busy steer',
);
assert.equal(
  (sendOn!.description ?? '').includes('某步有进展就立刻发一条'),
  true,
  'tool description must require staged progress sends',
);
assert.equal(
  (sendOn!.description ?? '').includes('一件事做完发短结果，同轮还有其他事则自然带进度'),
  true,
  'tool description must require a finish bubble that mentions other in-flight work',
);
assert.equal(
  (sendOn!.description ?? '').includes('不要按字数或句号切碎'),
  true,
  'tool description must not split by length or punctuation',
);
assert.equal(
  (sendOn!.description ?? '').includes('不要在同一批次连发多条'),
  true,
  'tool description must forbid batching send_message',
);
assert.equal(
  (sendOn!.description ?? '').includes('已用本工具发过内容则不要再写任何最终回复'),
  true,
  'tool description must forbid a leftover final reply',
);
assert.equal(
  (sendOn!.description ?? '').includes('按 set_status 步骤循环拆分'),
  false,
  'old set_status-step split wording must be gone from the tool description',
);

// needsApproval must be false (non-HITL) even if prefs.approval were ask
const prefsAsk = {
  ...DEFAULT_TOOL_PREFERENCES,
  send_message: { enabled: true, approval: 'ask' as const },
};
const toolsAsk = buildTools(prefsAsk, DEFAULT_SECURITY, undefined, {
  emitAssistantMessage: async () => {},
});
const sendAsk = toolsAsk.find((t) => (t as { name?: string }).name === 'send_message') as
  | { needsApproval?: boolean | ((args: unknown) => boolean) }
  | undefined;
assert.ok(sendAsk);
const needsRaw =
  typeof sendAsk!.needsApproval === 'function'
    ? (sendAsk!.needsApproval as (args: unknown) => boolean | Promise<boolean>)({})
    : sendAsk!.needsApproval;
const needs = await Promise.resolve(needsRaw);
assert.equal(needs, false, 'send_message must never require HITL');

// Without host callback: still registered (lockstep with prefs / listEnabledToolIds).
const toolsNoHost = buildTools(prefsOn, DEFAULT_SECURITY);
assert.equal(
  toolsNoHost.some((t) => (t as { name?: string }).name === 'send_message'),
  true,
);

const toolsOff = buildTools(prefsOff, DEFAULT_SECURITY, undefined, {
  emitAssistantMessage: async () => {},
});
assert.equal(
  toolsOff.some((t) => (t as { name?: string }).name === 'send_message'),
  false,
);

// Lockstep: listEnabledToolIds vs buildTools
assert.equal(
  listEnabledToolIds(prefsOn).includes('send_message'),
  toolsOn.some((t) => (t as { name?: string }).name === 'send_message'),
);

console.log('sendMessage.toolsGate.test.ts: ok');
