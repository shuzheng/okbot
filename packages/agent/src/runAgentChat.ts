import { RunState } from '@openai/agents';
import { assertModel } from './model.js';
import {
  applyResumeDecision,
  buildRunOpts,
  consumeAgentTextStream,
  createAgentAndRunner,
  createRunCheckpointBox,
  noteRunCheckpointState,
  runHitlStreamLoop,
  runModelSegment,
  wireRunCheckpointFlush,
  type AgentRunStreamResult,
  type StreamResetHandle,
} from './hitl.js';
import type {
  ResumeAgentChatAfterHitlInput,
  ResumeAgentChatFromCheckpointInput,
  RunAgentChatInput,
  RunChatResult,
} from './types.js';
import {
  buildAskAssistantTool,
  type MeshRuntimeContext,
} from './mesh.js';

/** Merge host `buildExtraTools` (onboarding/MCP) after seal hooks exist. */
async function withResolvedExtraTools<T extends {
  extraTools?: readonly import('@openai/agents').Tool[];
  buildExtraTools?: RunAgentChatInput['buildExtraTools'];
  toolRunBudget?: RunAgentChatInput['toolRunBudget'];
  onBeforeToolExecute?: () => void | Promise<void>;
}>(input: T): Promise<T> {
  const build = input.buildExtraTools;
  if (!build || !input.onBeforeToolExecute) return input;
  const built = await build({
    onBeforeToolExecute: input.onBeforeToolExecute,
    toolRunBudget: input.toolRunBudget,
  });
  const merged = [...(input.extraTools ?? []), ...(built ?? [])];
  return { ...input, extraTools: merged, buildExtraTools: undefined };
}


function attachMeshAskTool(
  input: RunAgentChatInput | ResumeAgentChatAfterHitlInput,
): (RunAgentChatInput | ResumeAgentChatAfterHitlInput) & {
  meshAskTool?: import('@openai/agents').Tool;
} {
  const peers = input.meshPeers;
  if (peers == null || !input.ownerId || !input.resourcesDir) return input;
  const meshDepth = input.meshDepth ?? 0;
  if (!peers.length) {
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
    ownerId: input.ownerId,
    resourcesDir: input.resourcesDir,
    onGeneratedImageSaved: input.onGeneratedImageSaved,
    assertLibraryWriteAllowed: input.assertLibraryWriteAllowed,
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
    emitAssistantMessage: async (payload) => {
      await input.emitAssistantMessage?.(payload);
      streamReset.committedInterim = true;
      streamReset.reset();
    },
    /**
     * Auto-allow tool boundary: seal host live text (progress/ack) and clear the
     * stream accumulator so done/abort does not re-dump sealed narration.
     * send_message / ask_assistant skip this (TOOLS_SEAL_THEMSELVES).
     */
    onBeforeToolExecute: async () => {
      await input.onClearLiveText?.();
      streamReset.reset();
      if (streamReset.committedText) streamReset.committedInterim = true;
    },
  };
  const withMesh = attachMeshAskTool(withCommit) as RunAgentChatInput & {
    meshAskTool?: import('@openai/agents').Tool;
  };
  const ready = await withResolvedExtraTools(withMesh);
  const { agent, runner } = createAgentAndRunner(ready);
  const runOpts = buildRunOpts(ready);
  const checkpointBox = createRunCheckpointBox();
  wireRunCheckpointFlush(ready, checkpointBox);

  const first = await runModelSegment(ready, async () => {
    const result = (await runner.run(agent, ready.userText, runOpts)) as AgentRunStreamResult;
    noteRunCheckpointState(checkpointBox, result.state);
    const streamed = await consumeAgentTextStream(
      result,
      withMesh.onDelta,
      withMesh.signal,
      streamReset,
    );
    return { result, streamed };
  });

  return runHitlStreamLoop(
    agent,
    runner,
    runOpts,
    first.result,
    first.streamed,
    ready,
    streamReset,
    checkpointBox,
  );
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
    emitAssistantMessage: async (payload) => {
      await input.emitAssistantMessage?.(payload);
      streamReset.committedInterim = true;
      streamReset.reset();
    },
    /**
     * Auto-allow tool boundary: seal host live text (progress/ack) and clear the
     * stream accumulator so done/abort does not re-dump sealed narration.
     * send_message / ask_assistant skip this (TOOLS_SEAL_THEMSELVES).
     */
    onBeforeToolExecute: async () => {
      await input.onClearLiveText?.();
      streamReset.reset();
      if (streamReset.committedText) streamReset.committedInterim = true;
    },
  };
  const withMesh = attachMeshAskTool(withCommit) as ResumeAgentChatAfterHitlInput & {
    meshAskTool?: import('@openai/agents').Tool;
  };
  const ready = await withResolvedExtraTools(withMesh);
  const { agent, runner } = createAgentAndRunner(ready);
  const runOpts = buildRunOpts(ready);
  const checkpointBox = createRunCheckpointBox();
  wireRunCheckpointFlush(ready, checkpointBox);

  const state = await RunState.fromString(agent, ready.serializedRunState);
  applyResumeDecision(state, ready);

  const first = await runModelSegment(ready, async () => {
    const result = (await runner.run(agent, state, runOpts)) as AgentRunStreamResult;
    noteRunCheckpointState(checkpointBox, result.state);
    const streamed = await consumeAgentTextStream(
      result,
      ready.onDelta,
      ready.signal,
      streamReset,
    );
    return { result, streamed };
  });

  return runHitlStreamLoop(
    agent,
    runner,
    runOpts,
    first.result,
    first.streamed,
    ready,
    streamReset,
    checkpointBox,
  );
}

/**
 * Cold-start resume from a mid-run checkpoint (crash recovery, no HITL decision).
 * Restores RunState and continues the HITL loop (may immediately hit interruptions).
 */
export async function resumeAgentChatFromCheckpoint(
  input: ResumeAgentChatFromCheckpointInput,
): Promise<RunChatResult> {
  assertModel(input.model);
  if (input.signal?.aborted) return { content: '' };

  const streamReset: StreamResetHandle = { reset: () => {} };
  const withCommit: ResumeAgentChatFromCheckpointInput = {
    ...input,
    onCommitLiveAssistant: async () => {
      await input.onCommitLiveAssistant?.();
      streamReset.committedInterim = true;
      streamReset.reset();
    },
    emitAssistantMessage: async (payload) => {
      await input.emitAssistantMessage?.(payload);
      streamReset.committedInterim = true;
      streamReset.reset();
    },
    /**
     * Auto-allow tool boundary: seal host live text (progress/ack) and clear the
     * stream accumulator so done/abort does not re-dump sealed narration.
     * send_message / ask_assistant skip this (TOOLS_SEAL_THEMSELVES).
     */
    onBeforeToolExecute: async () => {
      await input.onClearLiveText?.();
      streamReset.reset();
      if (streamReset.committedText) streamReset.committedInterim = true;
    },
  };
  const withMesh = attachMeshAskTool(withCommit as ResumeAgentChatAfterHitlInput) as ResumeAgentChatFromCheckpointInput & {
    meshAskTool?: import('@openai/agents').Tool;
  };
  const ready = await withResolvedExtraTools(withMesh);
  const { agent, runner } = createAgentAndRunner(ready);
  const runOpts = buildRunOpts(ready);
  const checkpointBox = createRunCheckpointBox();
  wireRunCheckpointFlush(ready, checkpointBox);

  const state = await RunState.fromString(agent, ready.serializedRunState);

  const first = await runModelSegment(ready, async () => {
    const result = (await runner.run(agent, state, runOpts)) as AgentRunStreamResult;
    noteRunCheckpointState(checkpointBox, result.state);
    const streamed = await consumeAgentTextStream(
      result,
      ready.onDelta,
      ready.signal,
      streamReset,
    );
    return { result, streamed };
  });

  return runHitlStreamLoop(
    agent,
    runner,
    runOpts,
    first.result,
    first.streamed,
    ready,
    streamReset,
    checkpointBox,
  );
}

