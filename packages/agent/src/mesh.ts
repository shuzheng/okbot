import { Agent, OpenAIProvider, RunState, Runner, tool, type Tool } from '@openai/agents';
import { z } from 'zod';
import {
  DEFAULT_RUNNER_MAX_TURNS,
  DEFAULT_SECURITY,
  DEFAULT_TOOL_PREFERENCES,
  createId,
  emptyTokenUsage,
  stripThinkContent,
  type ResolvedModelConfig,
  type SecuritySettings,
  type ToolPreferences,
  type WebSettings,
} from '@okbot/shared';
import {
  applyResumeDecision,
  consumeAgentTextStream,
  runHitlStreamLoop,
  runModelSegment,
  type AgentRunStreamResult,
} from './hitl.js';
import { buildTools, resolveImageCapability } from './tools.js';
import { agentGuardrailsFromSecurity } from './guardrails.js';
import { shellFsRoutingSection, type ComputerRoute } from './computerSelection.js';
import type { ExecutionBackend } from './executionBackend.js';
import { wrapToolExecute, type ToolRunBudget } from './toolRunBudget.js';
import type { HitlLoopHooks, ToolApprovalDecision } from './types.js';
import {
  MESH_ASK_TOOL_NAME,
  buildMeshCalleeInstructions,
  canAskMeshPeer,
  resolveMeshPeer,
  type MeshExchangeInfo,
  type MeshPeerRosterEntry,
  type MeshPeerSpec,
  type MeshRuntimeContext,
} from './meshPolicy.js';

export {
  MESH_ASK_TOOL_NAME,
  formatPeerRosterSection,
  resolveMeshPeer,
  canAskMeshPeer,
  buildMeshCalleeInstructions,
  defaultMeshSettings,
  type MeshPeerRosterEntry,
  type MeshPeerSpec,
  type MeshRuntimeContext,
  type MeshExchangeInfo,
} from './meshPolicy.js';
export { MESH_USER_FACING_REPLY_RULE } from './instructions.js';

export type BuildAskAssistantToolInput = HitlLoopHooks & {
  peers: MeshPeerSpec[];
  callerBotId: string;
  callerName: string;
  mesh: MeshRuntimeContext;
  model: ResolvedModelConfig;
  tools?: ToolPreferences;
  security?: SecuritySettings;
  toolRunBudget?: ToolRunBudget;
  web?: WebSettings;
  ownerId: string;
  resourcesDir: string;
  executionBackend?: ExecutionBackend;
  computerRoute?: ComputerRoute;
  rosterForCallee: (calleeId: string) => MeshPeerRosterEntry[];
  onMeshExchange?: (info: MeshExchangeInfo) => void | Promise<void>;
};

/**
 * Build the ask_assistant tool for the current nesting level.
 * Depth/call caps removed; always returns a tool (caller omits when no peers).
 */
export function buildAskAssistantTool(input: BuildAskAssistantToolInput): Tool | null {
  if (!input.peers.length) {
    return null;
  }
  const toolPrefs = input.tools ?? DEFAULT_TOOL_PREFERENCES;
  const security = input.security ?? DEFAULT_SECURITY;
  const imageApi = {
    baseURL: input.model.baseURL,
    apiKey: input.model.apiKey,
    catalogModelIds: input.model.providerModelIds,
    providerName: input.model.providerName,
  };
  const imageCapable = resolveImageCapability(imageApi) != null;

  return tool({
    name: MESH_ASK_TOOL_NAME,
    description:
      '向本机另一名助手求助。传入 assistant（精确名称或 id）与 task。当对方描述明显匹配任务时优先求助；仅在无合适伙伴、伙伴失败或琐碎无关任务时亲自做。',
    parameters: z.object({
      assistant: z.string().describe('目标助手的精确名称或 id'),
      task: z.string().describe('交给对方的子任务说明（越具体越好）'),
    }),
    execute: wrapToolExecute(MESH_ASK_TOOL_NAME, input.toolRunBudget, async ({ assistant, task }) => {
      try {
        const taskText = String(task ?? '').trim();
        if (!taskText) return '（空任务，已跳过）';

        const resolved = resolveMeshPeer(input.peers, String(assistant ?? ''));
        if (!resolved.ok) return resolved.error;

        const peer = input.peers.find((p) => p.id === resolved.peer.id);
        if (!peer) return `找不到助手「${resolved.peer.id}」。`;

        const gate = canAskMeshPeer({
          stack: input.mesh.stack,
          targetId: peer.id,
        });
        if (!gate.ok) return gate.error;

        const exchangeId = createId('mesh');
        // Finalize interim narration as its own bubble; follow-up streams into a new message.
        // (ask_assistant has no HITL interrupt, so onClearLiveText would only discard — wrong.)
        await input.onCommitLiveAssistant?.();

        await input.onMeshExchange?.({
          kind: 'ask',
          exchangeId,
          peerBotId: peer.id,
          peerName: peer.name,
          callerBotId: input.callerBotId,
          callerName: input.callerName,
          content: taskText,
        });

        const childDepth = input.mesh.depth + 1;
        const childStack = [...input.mesh.stack, peer.id];
        const childMesh: MeshRuntimeContext = {
          depth: childDepth,
          stack: childStack,
        };
        const childRoster = input.rosterForCallee(peer.id);
        // Unlimited depth: allow further asks whenever another peer remains on the roster.
        // Cycle prevention still blocks anyone already on childStack at execute time.
        const childAskEnabled = childRoster.length > 0;
        const peerRoute = input.computerRoute
          ? {
              ...input.computerRoute,
              userText: [input.computerRoute.userText, taskText].filter(Boolean).join('\n'),
            }
          : undefined;

        const childTools: Tool[] = [
          ...buildTools(toolPrefs, security, input.toolRunBudget, {
            skillLookup: peer.skillLookup,
            imageApi,
            imageAssets: { ownerId: input.ownerId, resourcesDir: input.resourcesDir },
            backend: peerRoute ? undefined : input.executionBackend,
            computerRoute: peerRoute,
            web: input.web,
          }),
        ];
        if (childAskEnabled) {
          const nested = buildAskAssistantTool({
            ...input,
            callerBotId: peer.id,
            callerName: peer.name,
            mesh: childMesh,
            peers: input.peers.filter((p) => p.id !== peer.id),
            // Nested peer runs do not stream to the main bubble — never commit/rotate it.
            onCommitLiveAssistant: undefined,
            onClearLiveText: undefined,
            onDelta: undefined,
          });
          if (nested) childTools.push(nested);
        }

        const agent = new Agent({
          name: peer.name || peer.id,
          instructions: buildMeshCalleeInstructions({
            calleeName: peer.name,
            calleeDescription: peer.description,
            callerName: input.callerName,
            soulMd: peer.soulMd,
            skillsText: peer.skillsText,
            memoriesText: peer.memoriesText,
            prefs: toolPrefs,
            peerRoster: childAskEnabled ? childRoster : undefined,
            askEnabled: childAskEnabled,
            computerRouting: shellFsRoutingSection(peerRoute, toolPrefs, { imageCapable }),
            imageCapable,
          }),
          model: input.model.model,
          ...(typeof input.model.maxTokens === 'number' && input.model.maxTokens >= 1
            ? { modelSettings: { maxTokens: input.model.maxTokens } }
            : {}),
          tools: childTools,
          ...agentGuardrailsFromSecurity(security),
        });

        const provider = new OpenAIProvider({
          apiKey: input.model.apiKey,
          baseURL: input.model.baseURL.replace(/\/$/, ''),
          useResponses: input.model.apiFormat === 'responses',
        });
        const runner = new Runner({
          modelProvider: provider,
          model: input.model.model,
          toolNotFoundBehavior: 'return_error_to_model',
        });
        const runOpts: {
          stream: true;
          signal?: AbortSignal;
          maxTurns: number;
          toolNotFoundBehavior: 'return_error_to_model';
        } = {
          stream: true,
          signal: input.signal,
          maxTurns: DEFAULT_RUNNER_MAX_TURNS,
          toolNotFoundBehavior: 'return_error_to_model',
        };

        const first = await runModelSegment(input, async () => {
          const result = (await runner.run(agent, taskText, runOpts)) as AgentRunStreamResult;
          const streamed = await consumeAgentTextStream(result, undefined, input.signal);
          return { result, streamed };
        });

        const out = await runHitlStreamLoop(agent, runner, runOpts, first.result, first.streamed, {
          signal: input.signal,
          onDelta: undefined,
          toolRunBudget: input.toolRunBudget,
          onModelTurnStart: input.onModelTurnStart,
          onModelTurnEnd: input.onModelTurnEnd,
          onApprovalWaitStart: input.onApprovalWaitStart,
          onApprovalWaitEnd: input.onApprovalWaitEnd,
          onToolApprovalRequest: (req) =>
            input.onToolApprovalRequest({
              ...req,
              squadMember: {
                botId: peer.id,
                toolName: MESH_ASK_TOOL_NAME,
                task: taskText,
              },
            }),
          onToolResult: input.onToolResult,
          onMeshExchange: input.onMeshExchange,
        });

        const rawReply = out.content?.trim() || '（助手未返回内容）';
        // Keep mesh detail free of callee CoT clutter.
        const reply = stripThinkContent(rawReply).trim() || rawReply;
        const usage = out.usage ?? emptyTokenUsage();
        await input.onMeshExchange?.({
          kind: 'reply',
          exchangeId,
          peerBotId: peer.id,
          peerName: peer.name,
          callerBotId: input.callerBotId,
          callerName: input.callerName,
          content: reply,
          usage,
        });
        return reply;
      } catch (err) {
        if (input.signal?.aborted) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        return `（向助手求助失败：${msg}）`;
      }
    }),
  });
}

export type ResumeMeshCalleeAfterHitlInput = HitlLoopHooks & {
  peer: MeshPeerSpec;
  task: string;
  callerBotId: string;
  callerName: string;
  peers: MeshPeerSpec[];
  mesh: MeshRuntimeContext;
  model: ResolvedModelConfig;
  tools?: ToolPreferences;
  security?: SecuritySettings;
  toolRunBudget?: ToolRunBudget;
  web?: WebSettings;
  ownerId: string;
  resourcesDir: string;
  executionBackend?: ExecutionBackend;
  computerRoute?: ComputerRoute;
  rosterForCallee: (calleeId: string) => MeshPeerRosterEntry[];
  onMeshExchange?: (info: MeshExchangeInfo) => void | Promise<void>;
  serializedRunState: string;
  requestId: string;
  toolName: string;
  callId?: string;
  arguments?: unknown;
  decision: ToolApprovalDecision;
};

/** Note injected into the caller after a cold-restored ask_assistant callee finishes. */
export function formatMeshResumeNote(peerName: string, task: string, reply: string): string {
  return [
    '## 恢复的助手求助结果',
    '应用重启前，你通过 ask_assistant 把下面的任务交给了另一名助手。该助手已完成任务。',
    '不要再次呼叫同一任务。用这些结果继续完成用户的最新请求。',
    '',
    `- 助手「${peerName}」`,
    `  任务：${task.trim() || '（无）'}`,
    `  结果：${reply.trim() || '（无）'}`,
  ].join('\n');
}

/**
 * Cold-start resume of a mesh ask_assistant callee approval.
 * Rebuilds the callee agent (same graph as live ask_assistant), restores its RunState,
 * applies the user's decision, and runs to the callee's reply.
 */
export async function resumeMeshCalleeAfterHitl(
  input: ResumeMeshCalleeAfterHitlInput,
): Promise<{ reply: string; usage: import('@okbot/shared').TokenUsage; peerName: string; peerBotId: string; task: string }> {
  const peer = input.peer;
  const taskText = input.task.trim() || '（无）';
  const toolPrefs = input.tools ?? DEFAULT_TOOL_PREFERENCES;
  const security = input.security ?? DEFAULT_SECURITY;
  const imageApi = {
    baseURL: input.model.baseURL,
    apiKey: input.model.apiKey,
    catalogModelIds: input.model.providerModelIds,
    providerName: input.model.providerName,
  };
  const imageCapable = resolveImageCapability(imageApi) != null;

  const childDepth = input.mesh.depth + 1;
  const childStack = [...input.mesh.stack, peer.id];
  const childMesh: MeshRuntimeContext = { depth: childDepth, stack: childStack };
  const childRoster = input.rosterForCallee(peer.id);
  const childAskEnabled = childRoster.length > 0;
  const peerRoute = input.computerRoute
    ? {
        ...input.computerRoute,
        userText: [input.computerRoute.userText, taskText].filter(Boolean).join('\n'),
      }
    : undefined;

  const childTools: Tool[] = [
    ...buildTools(toolPrefs, security, input.toolRunBudget, {
      skillLookup: peer.skillLookup,
      imageApi,
      imageAssets: { ownerId: input.ownerId, resourcesDir: input.resourcesDir },
      backend: peerRoute ? undefined : input.executionBackend,
      computerRoute: peerRoute,
      web: input.web,
    }),
  ];
  if (childAskEnabled) {
    const nested = buildAskAssistantTool({
      ...input,
      callerBotId: peer.id,
      callerName: peer.name,
      mesh: childMesh,
      peers: input.peers.filter((p) => p.id !== peer.id),
      onCommitLiveAssistant: undefined,
      onClearLiveText: undefined,
      onDelta: undefined,
    });
    if (nested) childTools.push(nested);
  }

  const agent = new Agent({
    name: peer.name || peer.id,
    instructions: buildMeshCalleeInstructions({
      calleeName: peer.name,
      calleeDescription: peer.description,
      callerName: input.callerName,
      soulMd: peer.soulMd,
      skillsText: peer.skillsText,
      memoriesText: peer.memoriesText,
      prefs: toolPrefs,
      peerRoster: childAskEnabled ? childRoster : undefined,
      askEnabled: childAskEnabled,
      computerRouting: shellFsRoutingSection(peerRoute, toolPrefs, { imageCapable }),
      imageCapable,
    }),
    model: input.model.model,
    ...(typeof input.model.maxTokens === 'number' && input.model.maxTokens >= 1
      ? { modelSettings: { maxTokens: input.model.maxTokens } }
      : {}),
    tools: childTools,
    ...agentGuardrailsFromSecurity(security),
  });

  const provider = new OpenAIProvider({
    apiKey: input.model.apiKey,
    baseURL: input.model.baseURL.replace(/\/$/, ''),
    useResponses: input.model.apiFormat === 'responses',
  });
  const runner = new Runner({
    modelProvider: provider,
    model: input.model.model,
    toolNotFoundBehavior: 'return_error_to_model',
  });
  const runOpts = {
    stream: true as const,
    signal: input.signal,
    maxTurns: DEFAULT_RUNNER_MAX_TURNS,
    toolNotFoundBehavior: 'return_error_to_model' as const,
  };

  const state = await RunState.fromString(agent, input.serializedRunState);
  applyResumeDecision(state, input);

  const first = await runModelSegment(input, async () => {
    const result = (await runner.run(agent, state, runOpts)) as AgentRunStreamResult;
    const streamed = await consumeAgentTextStream(result, undefined, input.signal);
    return { result, streamed };
  });

  const out = await runHitlStreamLoop(agent, runner, runOpts, first.result, first.streamed, {
    signal: input.signal,
    onDelta: undefined,
    toolRunBudget: input.toolRunBudget,
    onModelTurnStart: input.onModelTurnStart,
    onModelTurnEnd: input.onModelTurnEnd,
    onApprovalWaitStart: input.onApprovalWaitStart,
    onApprovalWaitEnd: input.onApprovalWaitEnd,
    onToolApprovalRequest: (req) =>
      input.onToolApprovalRequest({
        ...req,
        squadMember: {
          botId: peer.id,
          toolName: MESH_ASK_TOOL_NAME,
          task: taskText,
        },
      }),
    onToolResult: input.onToolResult,
    onMeshExchange: input.onMeshExchange,
  });

  const rawReply = out.content?.trim() || '（助手未返回内容）';
  const reply = stripThinkContent(rawReply).trim() || rawReply;
  const usage = out.usage ?? emptyTokenUsage();
  await input.onMeshExchange?.({
    kind: 'reply',
    exchangeId: createId('mesh'),
    peerBotId: peer.id,
    peerName: peer.name,
    callerBotId: input.callerBotId,
    callerName: input.callerName,
    content: reply,
    usage,
  });
  return { reply, usage, peerName: peer.name, peerBotId: peer.id, task: taskText };
}
