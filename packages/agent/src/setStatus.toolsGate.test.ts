/**
 * set_status: prefs-gated registration, never HITL, instructions when enabled.
 * Host setAssistantStatus is required at execute time (1:1 binds it).
 */
import assert from 'node:assert/strict';
import { DEFAULT_TOOL_PREFERENCES, DEFAULT_SECURITY } from '@okbot/shared';
import { listEnabledToolIds, formatEnabledLocalToolsLine, buildAgentInstructions } from './instructions.js';
import { buildTools } from './tools.js';

async function invokeTool(
  tool: { invoke: (...args: any[]) => Promise<unknown> },
  args: Record<string, unknown>,
): Promise<string> {
  const runContext = { context: {}, usage: {} };
  const out = await tool.invoke(runContext, JSON.stringify(args));
  return String(out);
}

const prefsOn = {
  ...DEFAULT_TOOL_PREFERENCES,
  set_status: { enabled: true, approval: 'allow' as const },
};

const prefsOff = {
  ...DEFAULT_TOOL_PREFERENCES,
  set_status: { enabled: false, approval: 'allow' as const },
};

assert.equal(listEnabledToolIds(prefsOn).includes('set_status'), true);
assert.equal(listEnabledToolIds(prefsOff).includes('set_status'), false);
assert.equal(formatEnabledLocalToolsLine(prefsOn).includes('set_status'), true);
assert.equal(formatEnabledLocalToolsLine(prefsOn).includes('占位'), true);

const instrOn = buildAgentInstructions('t', '', [], prefsOn);
assert.equal(instrOn.includes('set_status'), true);
assert.equal(instrOn.includes('占位气泡'), true, 'must teach placeholder usage');
assert.equal(instrOn.includes('必须先调用'), true, 'must require set_status before work or reply');
assert.equal(instrOn.includes('即使本轮只回一条气泡'), true, 'must require placeholder even for a single reply');
assert.equal(instrOn.includes('当分条回复'), false, 'must not limit set_status to split replies only');
assert.equal(instrOn.includes('不要逐步刷屏'), true, 'must not spam per milestone');
assert.equal(instrOn.includes('开场那条「要做什么」发出后，开始第一步前也要再 set_status'), true, 'must set_status again after the start bubble');
assert.equal(instrOn.includes('表情回应仍走 send_message'), true);
assert.equal(instrOn.includes('skipped_live_content'), true, 'must mention skip when live text exists');
assert.equal(instrOn.includes('每条用户消息一到（含忙时插入/软接管）'), true, 'start bubble on every message including steer');
assert.equal(instrOn.includes('同一条里同时说正在做的和这条新消息要做的'), true, 'busy-steer start bubble covers in-flight and new work');
assert.equal(instrOn.includes('某步有阶段性进展或可见结果，立刻发一条'), true, 'must send staged progress immediately');
assert.equal(instrOn.includes('还要继续就再 set_status 下一步'), true, 'must set_status again before later steps');
assert.equal(instrOn.includes('不要等全部做完再一次性发出'), true, 'must not hold bubbles until the end');
assert.equal(
  instrOn.includes('不要按字数、句号或气泡长度把同一份进展切碎'),
  true,
  'must not split one update by length or punctuation',
);
assert.equal(
  instrOn.includes('不要在同一次工具调用批次里连发多条 send_message'),
  true,
  'must not batch multiple send_message',
);
assert.equal(instrOn.includes('某一件事做完，发一条短结果'), true, 'finish bubble reports the completed item');
assert.equal(instrOn.includes('若同轮还有其他未完成的事，自然带一句那些事的进度'), true, 'finish bubble mentions other in-flight work');
assert.equal(instrOn.includes('send_message 与最终回复是二选一的出口'), true, 'send_message and final reply are XOR');
assert.equal(instrOn.includes('已用 send_message 发过内容则不要再追加最终回复'), true, 'no leftover final after send_message');
assert.equal(instrOn.includes('长任务开场'), false, 'old long-task opening-ack essay must be gone');
assert.equal(instrOn.includes('开场确认、「继续」确认和表情回应仍走 send_message'), false, 'old opening-ack special case must be gone');
assert.equal(instrOn.includes('不要预先规划要点再分条'), false, 'old pre-plan split wording must be gone');
assert.equal(instrOn.includes('两三个不同的要点'), false, 'old beat-based split wording must be gone');
assert.equal(instrOn.includes('不要按步骤把同一次汇报切碎'), false, 'must not forbid step-based splits');

const instrOff = buildAgentInstructions('t', '', [], prefsOff);
assert.equal(instrOff.includes('占位气泡'), false);

const toolsOn = buildTools(prefsOn, DEFAULT_SECURITY, undefined, {
  setAssistantStatus: async () => 'ok',
});
const statusOn = toolsOn.find((t) => (t as { name?: string }).name === 'set_status') as
  | { name?: string; description?: string }
  | undefined;
assert.ok(statusOn, 'prefs-on must register set_status');
assert.equal(
  (statusOn!.description ?? '').includes('即使只回一条气泡也必须先调用'),
  true,
  'tool description must require set_status even for a single reply',
);
assert.equal(
  (statusOn!.description ?? '').includes('开场那条发出后，开始第一步前也要再调用'),
  true,
  'tool description must require set_status again after the start bubble',
);
assert.equal(
  (statusOn!.description ?? '').includes('不是正式消息'),
  true,
  'tool description must say the placeholder is not a formal message',
);
assert.equal(
  (statusOn!.description ?? '').includes('不要为每个工具都调用'),
  true,
  'tool description must not require set_status for every tool',
);

const prefsAsk = {
  ...DEFAULT_TOOL_PREFERENCES,
  set_status: { enabled: true, approval: 'ask' as const },
};
const toolsAsk = buildTools(prefsAsk, DEFAULT_SECURITY, undefined, {
  setAssistantStatus: async () => 'ok',
});
const statusAsk = toolsAsk.find((t) => (t as { name?: string }).name === 'set_status') as
  | { needsApproval?: boolean | ((args: unknown) => boolean) }
  | undefined;
assert.ok(statusAsk);
const needsRaw =
  typeof statusAsk!.needsApproval === 'function'
    ? (statusAsk!.needsApproval as (args: unknown) => boolean | Promise<boolean>)({})
    : statusAsk!.needsApproval;
const needs = await Promise.resolve(needsRaw);
assert.equal(needs, false, 'set_status must never require HITL');

const toolsNoHost = buildTools(prefsOn, DEFAULT_SECURITY);
assert.equal(
  toolsNoHost.some((t) => (t as { name?: string }).name === 'set_status'),
  true,
  'still registered without host hook (execute returns a bind error)',
);

const toolsOff = buildTools(prefsOff, DEFAULT_SECURITY, undefined, {
  setAssistantStatus: async () => 'ok',
});
assert.equal(
  toolsOff.some((t) => (t as { name?: string }).name === 'set_status'),
  false,
);

assert.equal(
  listEnabledToolIds(prefsOn).includes('set_status'),
  toolsOn.some((t) => (t as { name?: string }).name === 'set_status'),
);

const calls: string[] = [];
const toolsExec = buildTools(prefsOn, DEFAULT_SECURITY, undefined, {
  setAssistantStatus: async (status) => {
    calls.push(status);
    return 'ok';
  },
});
const execTool = toolsExec.find((t) => (t as { name?: string }).name === 'set_status') as {
  invoke: (...args: any[]) => Promise<unknown>;
};
const ok = await invokeTool(execTool, { status: '  正在对比两家餐厅  ' });
assert.equal(ok, '已更新回复占位。');
assert.deepEqual(calls, ['正在对比两家餐厅']);

const empty = await invokeTool(execTool, { status: '   ' });
assert.match(empty, /请传一句/);
assert.equal(calls.length, 1);

const skipTools = buildTools(prefsOn, DEFAULT_SECURITY, undefined, {
  setAssistantStatus: async () => 'skipped_live_content',
});
const skipTool = skipTools.find((t) => (t as { name?: string }).name === 'set_status') as {
  invoke: (...args: any[]) => Promise<unknown>;
};
const skipped = await invokeTool(skipTool, { status: '正在对比两家餐厅' });
assert.match(skipped, /已有正文/);

const unbound = toolsNoHost.find((t) => (t as { name?: string }).name === 'set_status') as {
  invoke: (...args: any[]) => Promise<unknown>;
};
const unboundOut = await invokeTool(unbound, { status: '正在对比两家餐厅' });
assert.match(unboundOut, /仅 1:1/);

console.log('setStatus.toolsGate.test.ts: ok');
