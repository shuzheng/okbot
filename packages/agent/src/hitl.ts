import {
  Agent,
  OpenAIProvider,
  Runner,
  type AgentInputItem,
  type Session,
  type SessionInputCallback,
  type Tool,
} from '@openai/agents';
import type { ChatMessage, ResolvedModelConfig, SecuritySettings, ToolPreferences } from '@okbot/shared';
import { createId, DEFAULT_SECURITY, DEFAULT_TOOL_PREFERENCES } from '@okbot/shared';
import { buildAgentInstructions } from './instructions.js';
import { shellFsRoutingSection, type ComputerRoute } from './computerSelection.js';
import { buildTools, type SkillLookup } from './tools.js';
import type { ExecutionBackend } from './executionBackend.js';
import type { ToolRunBudget } from './toolRunBudget.js';
import type { HitlLoopHooks, RunChatResult } from './types.js';
import { tokenUsageFromRunResult } from './usage.js';



export function parseToolArgs(raw: string | undefined): unknown {
  if (!raw?.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}

export async function consumeAgentTextStream(
  result: {
    toTextStream: (options?: { compatibleWithNodeStreams: true }) => AsyncIterable<unknown>;
    completed: Promise<void>;
    error: unknown;
  },
  onDelta: ((delta: string) => void) | undefined,
  signal?: AbortSignal,
): Promise<string> {
  let streamed = '';
  const textStream = result.toTextStream({ compatibleWithNodeStreams: true });
  for await (const chunk of textStream) {
    if (signal?.aborted) break;
    const piece =
      typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : chunk == null
            ? ''
            : String(chunk);
    if (!piece) continue;
    streamed += piece;
    onDelta?.(piece);
  }
  await result.completed;
  if (result.error) throw result.error;
  return streamed;
}

export type AgentRunStreamResult = Awaited<ReturnType<Runner['run']>> & {
  interruptions?: Array<{ name?: string; arguments?: string }>;
  state: {
    approve: (interruption: unknown) => void;
    reject: (interruption: unknown, options?: { message?: string }) => void;
    toString: (options?: { includeTracingApiKey?: boolean }) => string;
  };
  finalOutput?: unknown;
  history?: Array<{ role?: string; content?: unknown }>;
};

export function createAgentAndRunner(input: {
  botName: string;
  botDescription: string;
  agentsMd?: string;
  skillsText?: string;
  skillLookup?: SkillLookup;
  memoriesText?: string;
  sessionSummary?: string;
  /** settings.instructions.assistantRoleTemplate */
  assistantRoleTemplate?: string;
  model: ResolvedModelConfig;
  tools?: ToolPreferences;
  security?: SecuritySettings;
  toolRunBudget?: ToolRunBudget;
  session?: Session;
  history?: ChatMessage[];
  /** Current turn includes vision image parts (overrides stale AGENTS "no images" claims). */
  hasVisionInput?: boolean;
  /** Bot/squad id for generate_image save path. */
  ownerId?: string;
  /** Absolute owner `resources/` dir for generate_image. */
  resourcesDir?: string;
  /** Shell/fs backend (local or remote cloud computer). Ignored when computerRoute is set. */
  executionBackend?: ExecutionBackend;
  /** Per-call computer selection for shell/fs tools. */
  computerRoute?: ComputerRoute;
  /** Extra tools appended after the built-ins (for example MCP tools; see mcp/). */
  extraTools?: readonly Tool[];
}) {
  const toolPrefs = input.tools ?? DEFAULT_TOOL_PREFERENCES;
  const security = input.security ?? DEFAULT_SECURITY;
  const provider = new OpenAIProvider({
    apiKey: input.model.apiKey,
    baseURL: input.model.baseURL.replace(/\/$/, ''),
    useResponses: input.model.apiFormat === 'responses',
  });
  const historyForInstructions = input.session ? [] : (input.history ?? []);
  const agent = new Agent({
    name: input.botName || 'OkBot',
    instructions: buildAgentInstructions(
      input.botName,
      input.botDescription,
      historyForInstructions,
      toolPrefs,
      input.agentsMd,
      input.skillsText,
      input.memoriesText,
      input.sessionSummary,
      input.assistantRoleTemplate,
      input.hasVisionInput === true,
      shellFsRoutingSection(input.computerRoute, toolPrefs),
    ),
    model: input.model.model,
    ...(typeof input.model.maxTokens === 'number' && input.model.maxTokens >= 1
      ? { modelSettings: { maxTokens: input.model.maxTokens } }
      : {}),
    tools: [
      ...buildTools(toolPrefs, security, input.toolRunBudget, {
      skillLookup: input.skillLookup,
      imageApi: {
        baseURL: input.model.baseURL,
        apiKey: input.model.apiKey,
        catalogModelIds: input.model.providerModelIds,
        providerName: input.model.providerName,
      },
      imageAssets:
        input.ownerId && input.resourcesDir
          ? { ownerId: input.ownerId, resourcesDir: input.resourcesDir }
          : undefined,
      backend: input.computerRoute ? undefined : input.executionBackend,
      computerRoute: input.computerRoute,
      }),
      ...(input.extraTools ?? []),
    ],
  });
  const runner = new Runner({
    modelProvider: provider,
    model: input.model.model,
  });
  return { agent, runner, toolPrefs };
}

export function buildRunOpts(input: {
  signal?: AbortSignal;
  session?: Session;
  sessionInputCallback?: SessionInputCallback;
  /** When set, passed to runner.run (avoids SDK DEFAULT_MAX_TURNS=10). */
  maxTurns?: number;
}) {
  const runOpts: {
    stream: true;
    signal?: AbortSignal;
    session?: Session;
    sessionInputCallback?: SessionInputCallback;
    maxTurns?: number;
  } = { stream: true, signal: input.signal };
  if (input.maxTurns != null) {
    runOpts.maxTurns = input.maxTurns;
  }
  if (input.session) {
    runOpts.session = input.session;
    runOpts.sessionInputCallback =
      input.sessionInputCallback ??
      ((history: AgentInputItem[], _newItems: AgentInputItem[]) => history);
  }
  return runOpts;
}

export function resolveFinalContent(
  result: AgentRunStreamResult,
  streamed: string,
): string {
  // Prefer the live stream. onClearLiveText resets streamed at tool interrupts so
  // post-tool text is formal-only; without tools, multi-segment answers stay intact.
  // Using finalOutput first caused a UI flash: live 1+2+3 → done shrinks to final-only
  // → getMessagesPage reload restores fuller session rows.
  if (streamed.trim()) return streamed;

  let content =
    typeof result.finalOutput === 'string'
      ? result.finalOutput
      : result.finalOutput != null
        ? String(result.finalOutput)
        : '';

  if (!content.trim()) {
    const history = result.history;
    if (Array.isArray(history)) {
      for (let i = history.length - 1; i >= 0; i--) {
        const item = history[i];
        if (item?.role === 'assistant' && typeof item.content === 'string' && item.content.trim()) {
          content = item.content;
          break;
        }
      }
    }
  }

  return content;
}

/**
 * Shared HITL loop: for each interruption, ask UI (with serialized RunState),
 * approve/reject on state, then resume streaming until no interruptions remain.
 */
export async function runHitlStreamLoop(
  agent: Agent<any, any>,
  runner: Runner,
  runOpts: ReturnType<typeof buildRunOpts>,
  result: AgentRunStreamResult,
  streamedIn: string,
  hooks: HitlLoopHooks,
): Promise<RunChatResult> {
  let streamed = streamedIn;
  let current = result;

  while (current.interruptions?.length) {
    if (hooks.signal?.aborted) {
      return { content: streamed, usage: tokenUsageFromRunResult(current) };
    }

    // Drop pre-tool / between-tool think-aloud; keep only post-tool formal reply.
    streamed = '';
    hooks.onClearLiveText?.();

    for (const interruption of current.interruptions) {
      if (hooks.signal?.aborted) {
        return { content: streamed, usage: tokenUsageFromRunResult(current) };
      }

      const toolName = interruption.name || 'unknown_tool';
      const args = parseToolArgs(interruption.arguments);
      const requestId = createId('tool');
      // Chat Completions / custom gateways can produce item shapes the SDK serializer
      // rejects (e.g. string content vs Responses array content). Never block the live
      // approval card on serialize failure — cold-start resume just won't be available.
      let serializedRunState = '';
      try {
        serializedRunState = current.state.toString();
      } catch (err) {
        console.error('[okbot] RunState.toString failed; continuing live HITL only', err);
      }

      hooks.toolRunBudget?.pauseDuration();
      let decision: Awaited<ReturnType<typeof hooks.onToolApprovalRequest>>;
      try {
        decision = await hooks.onToolApprovalRequest({
          requestId,
          toolName,
          arguments: args,
          serializedRunState,
        });
      } finally {
        hooks.toolRunBudget?.resumeDuration();
      }

      if (hooks.signal?.aborted) {
        return { content: streamed, usage: tokenUsageFromRunResult(current) };
      }

      if (decision.approved) {
        current.state.approve(interruption);
        hooks.onToolResult?.({
          requestId,
          toolName,
          approved: true,
        });
      } else {
        const message = decision.message?.trim() || '用户拒绝了该工具调用';
        current.state.reject(interruption, { message });
        hooks.onToolResult?.({
          requestId,
          toolName,
          approved: false,
          output: message,
        });
      }
    }

    current = (await runner.run(agent, current.state, runOpts)) as AgentRunStreamResult;
    streamed += await consumeAgentTextStream(current, hooks.onDelta, hooks.signal);
  }

  if (hooks.signal?.aborted) {
    return { content: streamed, usage: tokenUsageFromRunResult(current) };
  }

  const content = resolveFinalContent(current, streamed);
  if (!content.trim()) throw new Error('模型返回为空');
  return { content, usage: tokenUsageFromRunResult(current) };
}

/**
 * Cold-start resume: find the interrupted call in a restored RunState and apply
 * the user's decision. Throws when the call cannot be found.
 */
export function applyResumeDecision(
  state: {
    getInterruptions: () => Array<{ name?: string }>;
    approve: (item: any) => void;
    reject: (item: any, options?: { message?: string }) => void;
  },
  input: Pick<HitlLoopHooks, 'onToolResult'> & {
    requestId: string;
    toolName: string;
    decision: { approved: boolean; message?: string };
  },
): void {
  const interruptions = state.getInterruptions();
  // Prefer exact toolName; only fall back to the sole interruption (never a random
  // same-name sibling / interruptions[0] when several are pending).
  const byName = interruptions.filter((item) => (item.name || '') === input.toolName);
  const match =
    byName.length >= 1 ? byName[0] : interruptions.length === 1 ? interruptions[0] : undefined;
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
    input.onToolResult?.({ requestId: input.requestId, toolName, approved: true });
  } else {
    const message = input.decision.message?.trim() || '用户拒绝了该工具调用';
    state.reject(match, { message });
    input.onToolResult?.({ requestId: input.requestId, toolName, approved: false, output: message });
  }
}
