import {
  Agent,
  OpenAIProvider,
  Runner,
  type AgentInputItem,
  type Session,
  type SessionInputCallback,
  type Tool,
} from '@openai/agents';
import type { ChatMessage, ResolvedModelConfig, SecuritySettings, ToolPreferences, WebSettings } from '@okbot/shared';
import { createId, DEFAULT_RUNNER_MAX_TURNS, DEFAULT_SECURITY, DEFAULT_TOOL_PREFERENCES } from '@okbot/shared';
import { buildAgentInstructions } from './instructions.js';
import { shellFsRoutingSection, type ComputerRoute } from './computerSelection.js';
import { buildTools, resolveImageCapability, type SkillLookup } from './tools.js';
import { agentGuardrailsFromSecurity } from './guardrails.js';
import type { ExecutionBackend } from './executionBackend.js';
import type { ToolRunBudget } from './toolRunBudget.js';
import type { HitlLoopHooks, RunChatResult } from './types.js';
import { stripLeadingCommittedInterim } from './meshCommit.js';
import { tokenUsageFromRunResult } from './usage.js';
import {
  type MeshPeerSpec,
} from './meshPolicy.js';
import type { MeshSettings } from '@okbot/shared';


/** Prefer SDK callId on the interruption / raw function_call item. */
function stableArgsKey(args: unknown): string {
  try {
    return JSON.stringify(args ?? null);
  } catch {
    return String(args);
  }
}

export function interruptionCallId(item: {
  callId?: string;
  rawItem?: unknown;
}): string {
  const direct = typeof item?.callId === 'string' ? item.callId.trim() : '';
  if (direct) return direct;
  const raw = item?.rawItem;
  if (raw && typeof raw === 'object') {
    const o = raw as { callId?: unknown; call_id?: unknown };
    if (typeof o.callId === 'string' && o.callId.trim()) return o.callId.trim();
    if (typeof o.call_id === 'string' && o.call_id.trim()) return o.call_id.trim();
  }
  return '';
}

export function parseToolArgs(raw: string | undefined): unknown {
  if (!raw?.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}

/** Mutable handle so mid-stream hooks (mesh commit) can drop pre-tool accumulation. */
export type StreamResetHandle = {
  reset: () => void;
  /** Set when mesh finalized an interim bubble; empty follow-up must not error. */
  committedInterim?: boolean;
  /** Sealed interim text (message A); follow-up content strips this prefix when repeated. */
  committedText?: string;
};

export async function consumeAgentTextStream(
  result: {
    toTextStream: (options?: { compatibleWithNodeStreams: true }) => AsyncIterable<unknown>;
    completed: Promise<void>;
    error: unknown;
  },
  onDelta: ((delta: string) => void) | undefined,
  signal?: AbortSignal,
  resetHandle?: StreamResetHandle | null,
): Promise<string> {
  let streamed = '';
  if (resetHandle) {
    resetHandle.reset = () => {
      if (streamed.trim() && !resetHandle.committedText) {
        resetHandle.committedText = streamed;
      }
      streamed = '';
    };
  }
  try {
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
  } finally {
    if (resetHandle) {
      resetHandle.reset = () => {};
    }
  }
}

export type AgentRunStreamResult = Awaited<ReturnType<Runner['run']>> & {
  interruptions?: Array<{ name?: string; arguments?: string; callId?: string; rawItem?: unknown }>;
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
  soulMd?: string;
  skillsText?: string;
  skillLookup?: SkillLookup;
  historySearch?: import('./tools.js').HistorySearch;
  scheduleManage?: import('./tools.js').ScheduleManage;
  taskProgressManage?: import('./tools.js').TaskProgressManage;
  memoryManage?: import('./tools.js').MemoryManage;
  emitAssistantMessage?: import('./tools.js').EmitAssistantMessage;
  /** Seal live narration at auto-allow tool boundaries (see BuildToolsOptions). */
  onBeforeToolExecute?: () => void | Promise<void>;
  memoriesText?: string;
  sessionSummary?: string;
  taskProgressText?: string;
  /** settings.instructions.assistantRoleTemplate */
  assistantRoleTemplate?: string;
  /** User-chosen default assistant (identity hint in system prompt). */
  isDefaultAssistant?: boolean;
  /** New-assistant onboarding guide while onboarding is incomplete. */
  onboardingGuide?: string;
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
  /** Built-in web_fetch / web_search settings (`settings.web`). */
  web?: WebSettings;
  /** 1:1 mesh peers; omit for squad / mesh-disabled. */
  meshPeers?: MeshPeerSpec[];
  meshSettings?: MeshSettings;
  meshDepth?: number;
  meshStack?: string[];
  onMeshExchange?: HitlLoopHooks['onMeshExchange'];
  /** Pre-built ask_assistant tool (from runAgentChat); depth/roster already applied. */
  meshAskTool?: Tool;
  onToolApprovalRequest?: HitlLoopHooks['onToolApprovalRequest'];
  onToolResult?: HitlLoopHooks['onToolResult'];
  onModelTurnStart?: HitlLoopHooks['onModelTurnStart'];
  onModelTurnEnd?: HitlLoopHooks['onModelTurnEnd'];
  onApprovalWaitStart?: HitlLoopHooks['onApprovalWaitStart'];
  onApprovalWaitEnd?: HitlLoopHooks['onApprovalWaitEnd'];
  signal?: AbortSignal;
}) {
  const toolPrefs = input.tools ?? DEFAULT_TOOL_PREFERENCES;
  const security = input.security ?? DEFAULT_SECURITY;
  const imageApi = {
    baseURL: input.model.baseURL,
    apiKey: input.model.apiKey,
    catalogModelIds: input.model.providerModelIds,
    providerName: input.model.providerName,
  };
  const imageCapable = resolveImageCapability(imageApi) != null;
  const provider = new OpenAIProvider({
    apiKey: input.model.apiKey,
    baseURL: input.model.baseURL.replace(/\/$/, ''),
    useResponses: input.model.apiFormat === 'responses',
  });
  const historyForInstructions = input.session ? [] : (input.history ?? []);
  const meshPeers = input.meshPeers ?? [];
  const askEnabled = meshPeers.length > 0;
  const peerRoster = meshPeers.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
  }));
  const agent = new Agent({
    name: input.botName || 'OkBot',
    instructions: buildAgentInstructions(
      input.botName,
      input.botDescription,
      historyForInstructions,
      toolPrefs,
      input.soulMd,
      input.skillsText,
      input.memoriesText,
      input.sessionSummary,
      input.assistantRoleTemplate,
      input.hasVisionInput === true,
      shellFsRoutingSection(input.computerRoute, toolPrefs, { imageCapable }),
      imageCapable,
      // Only inject roster on 1:1 when peers were provided (including empty → "none").
      input.meshPeers != null ? peerRoster : undefined,
      askEnabled,
      input.isDefaultAssistant === true,
      input.taskProgressText,
      input.onboardingGuide,
    ),
    model: input.model.model,
    ...(typeof input.model.maxTokens === 'number' && input.model.maxTokens >= 1
      ? { modelSettings: { maxTokens: input.model.maxTokens } }
      : {}),
    tools: [
      ...buildTools(toolPrefs, security, input.toolRunBudget, {
      skillLookup: input.skillLookup,
      historySearch: input.historySearch,
      scheduleManage: input.scheduleManage,
      memoryManage: input.memoryManage,
      taskProgressManage: input.taskProgressManage,
      emitAssistantMessage: input.emitAssistantMessage,
      onBeforeToolExecute: input.onBeforeToolExecute,
      imageApi,
      imageAssets:
        input.ownerId && input.resourcesDir
          ? { ownerId: input.ownerId, resourcesDir: input.resourcesDir }
          : undefined,
      backend: input.computerRoute ? undefined : input.executionBackend,
      computerRoute: input.computerRoute,
      web: input.web,
      }),
      ...(input.extraTools ?? []),
      ...(input.meshAskTool ? [input.meshAskTool] : []),
    ],
    ...agentGuardrailsFromSecurity(security),
  });
  const runner = new Runner({
    modelProvider: provider,
    model: input.model.model,
    // Unknown tool names (e.g. model invents `shell` vs registered `run_shell`)
    // return a model-visible error so the run can retry instead of hard-stopping.
    toolNotFoundBehavior: 'return_error_to_model',
  });
  return { agent, runner, toolPrefs };
}

export function buildRunOpts(input: {
  signal?: AbortSignal;
  session?: Session;
  sessionInputCallback?: SessionInputCallback;
  /** Override hardcoded DEFAULT_RUNNER_MAX_TURNS (avoids SDK DEFAULT_MAX_TURNS=10). */
  maxTurns?: number;
}) {
  const runOpts: {
    stream: true;
    signal?: AbortSignal;
    session?: Session;
    sessionInputCallback?: SessionInputCallback;
    maxTurns: number;
    toolNotFoundBehavior: 'return_error_to_model';
  } = {
    stream: true,
    signal: input.signal,
    // Always pass a finite cap — SDK falls back to 10 when omitted.
    maxTurns: input.maxTurns ?? DEFAULT_RUNNER_MAX_TURNS,
    // Same as Runner config: keep unknown-tool soft-fail even if a caller rebuilds Runner.
    toolNotFoundBehavior: 'return_error_to_model',
  };
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
export async function runModelSegment(
  hooks: HitlLoopHooks,
  run: () => Promise<{ result: AgentRunStreamResult; streamed: string }>,
): Promise<{ result: AgentRunStreamResult; streamed: string }> {
  const started = hooks.onModelTurnStart?.();
  const spanId = typeof started === 'string' ? started : undefined;
  try {
    const out = await run();
    hooks.onModelTurnEnd?.({ ok: true, ...(spanId ? { spanId } : {}) });
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    hooks.onModelTurnEnd?.({ ok: false, error: message, ...(spanId ? { spanId } : {}) });
    throw err;
  }
}


function emitRunCheckpoint(hooks: HitlLoopHooks, state: { toString: (options?: { includeTracingApiKey?: boolean }) => string }): void {
  if (!hooks.onRunCheckpoint) return;
  try {
    const serializedRunState = state.toString();
    if (serializedRunState) hooks.onRunCheckpoint({ serializedRunState });
  } catch (err) {
    // Soft-fail: skip this checkpoint write; the live run must continue.
    // Prefer fixing item shapes (normalizeAgentInputItemForRunState in Session.getItems)
    // so originalInput validates — do not silence permanently without that fix.
    console.error('[okbot] RunState.toString failed for checkpoint; skipping', err);
  }
}

export async function runHitlStreamLoop(
  agent: Agent<any, any>,
  runner: Runner,
  runOpts: ReturnType<typeof buildRunOpts>,
  result: AgentRunStreamResult,
  streamedIn: string,
  hooks: HitlLoopHooks,
  streamReset?: StreamResetHandle | null,
): Promise<RunChatResult> {
  let streamed = streamedIn;
  let current = result;
  // Persist mid-run state at each safe model+tools boundary (crash recovery).
  emitRunCheckpoint(hooks, current.state);

  while (current.interruptions?.length) {
    if (hooks.signal?.aborted) {
      return { content: streamed, usage: tokenUsageFromRunResult(current) };
    }

    // Reset live buffer at HITL tool boundary. Host seals visible narration (or
    // drops think-only). Auto-allow tools seal via onBeforeToolExecute instead.
    streamed = '';
    await Promise.resolve(hooks.onClearLiveText?.());

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
      const approvalStarted = hooks.onApprovalWaitStart?.(toolName);
      const approvalSpanId = typeof approvalStarted === 'string' ? approvalStarted : undefined;
      let decision: Awaited<ReturnType<typeof hooks.onToolApprovalRequest>>;
      try {
        const callId = interruptionCallId(interruption);
        decision = await hooks.onToolApprovalRequest({
          requestId,
          toolName,
          ...(callId ? { callId } : {}),
          arguments: args,
          serializedRunState,
        });
        hooks.onApprovalWaitEnd?.({
          toolName,
          approved: decision.approved,
          ...(approvalSpanId ? { spanId: approvalSpanId } : {}),
        });
      } catch (err) {
        hooks.onApprovalWaitEnd?.({
          toolName,
          approved: false,
          ...(approvalSpanId ? { spanId: approvalSpanId } : {}),
        });
        throw err;
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

    const resumed = await runModelSegment(hooks, async () => {
      const next = (await runner.run(agent, current.state, runOpts)) as AgentRunStreamResult;
      const piece = await consumeAgentTextStream(
        next,
        hooks.onDelta,
        hooks.signal,
        streamReset,
      );
      return { result: next, streamed: piece };
    });
    current = resumed.result;
    streamed += resumed.streamed;
    emitRunCheckpoint(hooks, current.state);
  }

  if (hooks.signal?.aborted) {
    return { content: streamed, usage: tokenUsageFromRunResult(current) };
  }

  let content = resolveFinalContent(current, streamed);
  if (streamReset?.committedText) {
    content = stripLeadingCommittedInterim(content, streamReset.committedText);
  }
  if (!content.trim()) {
    // Mesh may have already persisted the interim reply as its own bubble.
    if (streamReset?.committedInterim) {
      return { content: '', usage: tokenUsageFromRunResult(current) };
    }
    throw new Error('模型返回为空');
  }
  return { content, usage: tokenUsageFromRunResult(current) };
}

/**
 * Cold-start resume: find the interrupted call in a restored RunState and apply
 * the user's decision. Throws when the call cannot be found.
 */
export function applyResumeDecision(
  state: {
    // Broad: SDK RunToolApprovalItem.rawItem union is wider than function_call.
    getInterruptions: () => Array<{
      name?: string;
      arguments?: string;
      callId?: string;
      rawItem?: unknown;
    }>;
    approve: (item: any) => void;
    reject: (item: any, options?: { message?: string }) => void;
  },
  input: Pick<HitlLoopHooks, 'onToolResult'> & {
    requestId: string;
    toolName: string;
    /** Preferred: SDK function_call id saved with the pending HITL record. */
    callId?: string;
    /** Optional args snapshot for disambiguating same-name tools when callId missing. */
    arguments?: unknown;
    decision: { approved: boolean; message?: string };
  },
): void {
  const interruptions = state.getInterruptions();
  const wantCallId = (input.callId || '').trim();
  let match:
    | (typeof interruptions)[number]
    | undefined;

  if (wantCallId) {
    match = interruptions.find((item) => interruptionCallId(item) === wantCallId);
  }

  if (!match) {
    // Prefer exact toolName; only fall back to the sole interruption (never a random
    // same-name sibling / interruptions[0] when several are pending).
    const byName = interruptions.filter((item) => (item.name || '') === input.toolName);
    if (byName.length === 1) {
      match = byName[0];
    } else if (byName.length > 1 && input.arguments !== undefined) {
      const want = stableArgsKey(input.arguments);
      const byArgs = byName.filter(
        (item) => stableArgsKey(parseToolArgs(item.arguments)) === want,
      );
      if (byArgs.length === 1) match = byArgs[0];
      else {
        throw new Error(
          `恢复失败：工具「${input.toolName}」有 ${byName.length} 个同名待审批中断，无法唯一匹配` +
            (wantCallId ? `（callId=${wantCallId}）` : ''),
        );
      }
    } else if (byName.length > 1) {
      throw new Error(
        `恢复失败：工具「${input.toolName}」有 ${byName.length} 个同名待审批中断，缺少 callId 无法唯一匹配`,
      );
    } else if (interruptions.length === 1) {
      match = interruptions[0];
    }
  }

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
