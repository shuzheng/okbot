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
assert.equal(instrOn.includes('多条独立回复消息'), true);
assert.equal(instrOn.includes('里程碑'), true, 'long-task milestones must use send_message');
assert.equal(instrOn.includes('长任务开场'), true, 'long-task must send_message ack before tools');
assert.equal(instrOn.includes('开场确认只能走 send_message 一次'), true, 'must not double opening 收到');
assert.equal(instrOn.includes('流式正文或最终 output_text'), true, 'no second opening in final/stream');
assert.equal(instrOn.includes('先发确认气泡'), true, 'must forbid meta narration of ack bubble');
assert.equal(instrOn.includes('用户说「继续」或催促后'), true, '继续 must send_message before tools');

const instrOff = buildAgentInstructions('t', '', [], prefsOff);
assert.equal(instrOff.includes('多条独立回复消息'), false);

const toolsOn = buildTools(prefsOn, DEFAULT_SECURITY, undefined, {
  emitAssistantMessage: async () => {},
});
assert.equal(
  toolsOn.some((t) => (t as { name?: string }).name === 'send_message'),
  true,
  'prefs-on must register send_message',
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
