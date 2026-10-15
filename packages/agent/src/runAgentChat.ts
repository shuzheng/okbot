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
  type StreamResetHandle,
} from './hitl.js';
import type {
  ResumeAgentChatAfterHitlInput,
  RunAgentChatInput,
  RunChatResult,
} from './types.js';
import {
  buildAskAssistantTool,
  meshAskToolAllowed,
  type MeshRuntimeContext,
} from './mesh.js';

function attachMeshAskTool(
  input: RunAgentChatInput | ResumeAgentChatAfterHitlInput,
): (RunAgentChatInput | ResumeAgentChatAfterHitlInput) & {
  meshAskTool?: import('@openai/agents').Tool;
} {
  const peers = input.meshPeers;
  if (peers == null || !input.ownerId || !input.resourcesDir) return input;
  const meshDepth = input.meshDepth ?? 0;
  if (!peers.length || !meshAskToolAllowed()) {
    return input;
  }
  if (!input.onToolApprovalRequest) return input;
  const meshStack =
    input.meshStack && input.meshStack.length ? input.meshStack : [input.ownerId];
  const meshCtx: MeshRuntimeContext = {
    depth: meshDepth,
    stack: meshStack,
  };
  const peerRoster = peers.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
  }));
  const askTool = buildAskAssistantTool({
    peers,
    callerBotId: input.ownerId,
    callerName: input.botName || 'OkBot',
    mesh: meshCtx,
    model: input.model,
    tools: input.tools,
    security: input.security,
    toolRunBudget: input.toolRunBudget,
    web: input.web,
    memberMaxTurns: input.meshMemberMaxTurns,
    ownerId: input.ownerId,
    resourcesDir: input.resourcesDir,
    executionBackend: input.executionBackend,
    computerRoute: input.computerRoute,
    rosterForCallee: (calleeId) => peerRoster.filter((p) => p.id !== calleeId),
    onMeshExchange: input.onMeshExchange,
    signal: input.signal,
    onToolApprovalRequest: input.onToolApprovalRequest,
    onToolResult: input.onToolResult,
    onModelTurnStart: input.onModelTurnStart,
    onModelTurnEnd: input.onModelTurnEnd,
    onApprovalWaitStart: input.onApprovalWaitStart,
    onApprovalWaitEnd: input.onApprovalWaitEnd,
    onCommitLiveAssistant: input.onCommitLiveAssistant,
    onClearLiveText: input.onClearLiveText,
    onDelta: input.onDelta,
  });
  if (!askTool) return input;
  return { ...input, meshAskTool: askTool };
}

export async function runAgentChat(input: RunAgentChatInput): Promise<RunChatResult> {
  assertModel(input.model);
  if (input.signal?.aborted) return { content: '' };

  const streamReset: StreamResetHandle = { reset: () => {} };
  const withCommit: RunAgentChatInput = {
    ...input,
    onCommitLiveAssistant: async () => {
      await input.onCommitLiveAssistant?.();
      streamReset.committedInterim = true;
      streamReset.reset();
    },
  };
  const withMesh = attachMeshAskTool(withCommit) as RunAgentChatInput & {
    meshAskTool?: import('@openai/agents').Tool;
  };
  const { agent, runner } = createAgentAndRunner(withMesh);
  const runOpts = buildRunOpts(withMesh);

  const first = await runModelSegment(withMesh, async () => {
    const result = (await runner.run(agent, withMesh.userText, runOpts)) as AgentRunStreamResult;
    const streamed = await consumeAgentTextStream(
      result,
      withMesh.onDelta,
      withMesh.signal,
      streamReset,
    );
    return { result, streamed };
  });

  return runHitlStreamLoop(agent, runner, runOpts, first.result, first.streamed, withMesh, streamReset);
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

  const streamReset: StreamResetHandle = { reset: () => {} };
  const withCommit: ResumeAgentChatAfterHitlInput = {
    ...input,
    onCommitLiveAssistant: async () => {
      await input.onCommitLiveAssistant?.();
      streamReset.committedInterim = true;
      streamReset.reset();
    },
  };
  const withMesh = attachMeshAskTool(withCommit) as ResumeAgentChatAfterHitlInput & {
    meshAskTool?: import('@openai/agents').Tool;
  };
  const { agent, runner } = createAgentAndRunner(withMesh);
  const runOpts = buildRunOpts(withMesh);

  const state = await RunState.fromString(agent, withMesh.serializedRunState);
  applyResumeDecision(state, withMesh);

  const first = await runModelSegment(withMesh, async () => {
    const result = (await runner.run(agent, state, runOpts)) as AgentRunStreamResult;
    const streamed = await consumeAgentTextStream(
      result,
      withMesh.onDelta,
      withMesh.signal,
      streamReset,
    );
    return { result, streamed };
  });

  return runHitlStreamLoop(agent, runner, runOpts, first.result, first.streamed, withMesh, streamReset);
}
