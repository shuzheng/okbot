import { RunState } from '@openai/agents';
import { assertModel } from './model.js';
import {
  applyResumeDecision,
  buildRunOpts,
  consumeAgentTextStream,
  createAgentAndRunner,
  runHitlStreamLoop,
  runModelSegment,
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

  const first = await runModelSegment(input, async () => {
    const result = (await runner.run(agent, input.userText, runOpts)) as AgentRunStreamResult;
    const streamed = await consumeAgentTextStream(result, input.onDelta, input.signal);
    return { result, streamed };
  });

  return runHitlStreamLoop(agent, runner, runOpts, first.result, first.streamed, input);
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
  applyResumeDecision(state, input);

  const first = await runModelSegment(input, async () => {
    const result = (await runner.run(agent, state, runOpts)) as AgentRunStreamResult;
    const streamed = await consumeAgentTextStream(result, input.onDelta, input.signal);
    return { result, streamed };
  });

  return runHitlStreamLoop(agent, runner, runOpts, first.result, first.streamed, input);
}
