import { RunState } from '@openai/agents';
import { assertModel } from './model.js';
import {
  buildRunOpts,
  consumeAgentTextStream,
  createAgentAndRunner,
  runHitlStreamLoop,
  type AgentRunStreamResult,
} from './hitl.js';
import type {
  ResumeAgentChatAfterHitlInput,
  RunAgentChatInput,
  RunChatResult,
} from './types.js';

export async function runAgentChat(input: RunAgentChatInput): Promise<RunChatResult> {
  assertModel(input.model);
  if (input.signal?.aborted) return { content: '' };

  const { agent, runner } = createAgentAndRunner(input);
  const runOpts = buildRunOpts(input);

  let result = (await runner.run(agent, input.userText, runOpts)) as AgentRunStreamResult;
  const streamed = await consumeAgentTextStream(result, input.onDelta, input.signal);

  return runHitlStreamLoop(agent, runner, runOpts, result, streamed, input);
}

/**
 * Cold-start resume: deserialize RunState, apply the user's approve/deny for the
 * interrupted tool via `state.getInterruptions()`, then continue the same HITL loop.
 */
export async function resumeAgentChatAfterHitl(
  input: ResumeAgentChatAfterHitlInput,
): Promise<RunChatResult> {
  assertModel(input.model);
  if (input.signal?.aborted) return { content: '' };

  const { agent, runner } = createAgentAndRunner(input);
  const runOpts = buildRunOpts(input);

  const state = await RunState.fromString(agent, input.serializedRunState);
  const interruptions = state.getInterruptions();
  // Prefer exact toolName; only fall back to the sole interruption (never a random
  // same-name sibling / interruptions[0] when several are pending).
  const byName = interruptions.filter((item) => (item.name || '') === input.toolName);
  const match =
    byName.length === 1
      ? byName[0]
      : byName.length > 1
        ? byName[0] // same toolName twice — first is best-effort; caller should approve in order
        : interruptions.length === 1
          ? interruptions[0]
          : undefined;
  if (!match) {
    throw new Error(
      interruptions.length
        ? `恢复失败：找不到工具「${input.toolName}」的待审批中断（共 ${interruptions.length} 个中断）`
        : '恢复失败：找不到待审批的工具调用（RunState.getInterruptions 为空）',
    );
  }

  const toolName = match.name || input.toolName || 'unknown_tool';
  if (input.decision.approved) {
    state.approve(match);
    input.onToolResult?.({
      requestId: input.requestId,
      toolName,
      approved: true,
    });
  } else {
    const message = input.decision.message?.trim() || '用户拒绝了该工具调用';
    state.reject(match, { message });
    input.onToolResult?.({
      requestId: input.requestId,
      toolName,
      approved: false,
      output: message,
    });
  }

  let result = (await runner.run(agent, state, runOpts)) as AgentRunStreamResult;
  const streamed = await consumeAgentTextStream(result, input.onDelta, input.signal);

  return runHitlStreamLoop(agent, runner, runOpts, result, streamed, input);
}
