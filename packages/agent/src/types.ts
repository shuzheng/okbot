import type {
  ChatMessage,
  ResolvedModelConfig,
  SecuritySettings,
  TokenUsage,
  ToolPreferences,
  WebSettings,
} from '@okbot/shared';
import type { Session, SessionInputCallback, Tool } from '@openai/agents';
import type { ToolRunBudget } from './toolRunBudget.js';
import type { EmitAssistantMessage, HistorySearch, ScheduleManage, SkillLookup, TaskProgressManage } from './tools.js';
import type { ExecutionBackend } from './executionBackend.js';
import type { ComputerRoute } from './computerSelection.js';

export interface RunChatInput {
  botName: string;
  botDescription: string;
  /** Contents of the bot's AGENTS.md (system prompt). */
  agentsMd?: string;
  /** Catalog-only skills text (name/slug/when-to-use) for the system prompt. */
  skillsText?: string;
  /** Resolve full skill body by slug for the `read_skill` tool. */
  skillLookup?: SkillLookup;
  /** Search this chat only for `search_history`. */
  historySearch?: HistorySearch;
  /** Manage timed wakeups for this chat (`manage_schedule`). */
  scheduleManage?: ScheduleManage;
  /** Durable long-task checklist (`manage_task_progress`). */
  taskProgressManage?: TaskProgressManage;
  /** Emit a standalone assistant bubble mid-run (`send_message`). */
  emitAssistantMessage?: EmitAssistantMessage;
  /**
   * Internal: seal live narration at auto-allow tool starts (wired in runAgentChat).
   * Hosts use onClearLiveText; do not set this from desktop.
   */
  onBeforeToolExecute?: () => void | Promise<void>;
  /** Built-in web_fetch / web_search (`settings.web`). */
  web?: WebSettings;
  /** Formatted global + bot memories for the system prompt. */
  memoriesText?: string;
  /** Rolling summary of older turns (when context was compressed). */
  sessionSummary?: string;
  /** Formatted durable task checklist for the system prompt. */
  taskProgressText?: string;
  /** settings.instructions.assistantRoleTemplate (`{name}` → botName). */
  assistantRoleTemplate?: string;
  /** User-chosen default assistant (identity hint in system prompt). */
  isDefaultAssistant?: boolean;
  model: ResolvedModelConfig;
  /** Recent UI transcript; ignored for model history when `session` is provided. */
  history?: ChatMessage[];
  userText: string;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

export interface RunChatResult {
  content: string;
  /** Aggregated token usage for this run (captain + nested member runs when squad). */
  usage?: TokenUsage;
}

export interface ToolApprovalRequest {
  requestId: string;
  toolName: string;
  arguments: unknown;
  /** Serialized SDK RunState at the interruption (for cold-start resume). Empty if serialize failed. */
  serializedRunState: string;
  /**
   * Squad only: the call came from a member run inside `ask_*`. Then
   * `serializedRunState` is the member's run, and a cold resume rebuilds that member.
   */
  squadMember?: { botId: string; toolName: string; task: string };
}

export interface ToolApprovalDecision {
  approved: boolean;
  message?: string;
}

export interface RunAgentChatInput extends RunChatInput {
  /** Per-tool enable + approval; omitted tools use defaults. */
  tools?: ToolPreferences;
  /** Local path / shell guardrails; omitted → DEFAULT_SECURITY. */
  security?: SecuritySettings;
  /** Shared per-run tool circuit breaker (1:1 / squad including nested members). */
  toolRunBudget?: ToolRunBudget;
  /** Max agent turns for this 1:1 run (settings.maxTurns). */
  maxTurns?: number;
  /**
   * SDK Session for model history (tool calls included).
   * When set, transcript is NOT stuffed into instructions via formatHistoryBlock.
   */
  session?: Session;
  /**
   * Customize how session history is combined with this turn's input.
   * Default when session is set and history was already persisted: return history only
   * (avoids duplicating the user turn the caller already wrote).
   */
  sessionInputCallback?: SessionInputCallback;
  /** Current user turn includes vision image attachments. */
  hasVisionInput?: boolean;
  /** Bot/squad id — generated images land in `~/.okbot/<ownerId>/resources/`. */
  ownerId: string;
  /** Absolute `~/.okbot/<ownerId>/resources` directory. */
  resourcesDir: string;
  /** Shell/fs backend for this run (local or cloud computer). Ignored when computerRoute is set. */
  executionBackend?: ExecutionBackend;
  /** Per-call computer selection for shell/fs tools. */
  computerRoute?: ComputerRoute;
  /** Extra tools appended after the built-ins (for example MCP tools). Resume must pass the same set. */
  extraTools?: readonly Tool[];
  /**
   * 1:1 peer mesh peers (other assistants). Omitted / empty → no roster / no ask_assistant.
   * Squad runs must not pass this.
   */
  meshPeers?: import('./mesh.js').MeshPeerSpec[];
  /** Mesh settings bag (empty; depth/call caps removed). */
  meshSettings?: import('@okbot/shared').MeshSettings;
  /** Current nesting depth (0 = root). Nested runs set this internally. */
  meshDepth?: number;
  /** Call stack of bot ids (root should be [ownerId]). */
  meshStack?: string[];
  /** @deprecated Call caps removed; optional leftover counter. */
  meshCallBudget?: import('./mesh.js').MeshCallBudget;
  /** Nested ask_assistant maxTurns; prefer settings.squad.memberMaxTurns. */
  meshMemberMaxTurns?: number;
  /** Surface mesh ask/reply bubbles in the current 1:1 session. */
  onMeshExchange?: (info: {
    kind: 'ask' | 'reply';
    exchangeId: string;
    peerBotId: string;
    peerName: string;
    callerBotId: string;
    callerName: string;
    content: string;
    usage?: TokenUsage;
  }) => void | Promise<void>;
  onToolApprovalRequest: (req: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
  onToolResult?: (info: {
    requestId: string;
    toolName: string;
    approved: boolean;
    output?: string;
  }) => void;
  /** Clear pre-tool narration from the live assistant bubble when tools interrupt. */
  onClearLiveText?: () => void | Promise<void>;
  /**
   * Mesh ask_assistant: commit interim live text as message A and start message B
   * for the post-peer reply (see HitlLoopHooks.onCommitLiveAssistant).
   */
  onCommitLiveAssistant?: () => void | Promise<void>;
  /** 1:1 send_message host hook (see HitlLoopHooks.emitAssistantMessage). */
  emitAssistantMessage?: EmitAssistantMessage;
  onModelTurnStart?: () => void | string;
  onModelTurnEnd?: (info: { ok: boolean; error?: string; spanId?: string }) => void;
  onApprovalWaitStart?: (toolName: string) => void | string;
  onApprovalWaitEnd?: (info: { toolName: string; approved: boolean; spanId?: string }) => void;
  onRunCheckpoint?: (info: { serializedRunState: string }) => void;
}

export interface ResumeAgentChatAfterHitlInput {
  botName: string;
  botDescription: string;
  agentsMd?: string;
  skillsText?: string;
  skillLookup?: SkillLookup;
  historySearch?: HistorySearch;
  scheduleManage?: ScheduleManage;
  taskProgressManage?: TaskProgressManage;
  /** Emit a standalone assistant bubble mid-run (`send_message`). */
  emitAssistantMessage?: EmitAssistantMessage;
  /**
   * Internal: seal live narration at auto-allow tool starts (wired in runAgentChat).
   * Hosts use onClearLiveText; do not set this from desktop.
   */
  onBeforeToolExecute?: () => void | Promise<void>;
  /** Built-in web_fetch / web_search (`settings.web`). */
  web?: WebSettings;
  memoriesText?: string;
  sessionSummary?: string;
  taskProgressText?: string;
  assistantRoleTemplate?: string;
  /** User-chosen default assistant (identity hint in system prompt). */
  isDefaultAssistant?: boolean;
  model: ResolvedModelConfig;
  tools?: ToolPreferences;
  security?: SecuritySettings;
  /** Shared per-run tool circuit breaker. */
  toolRunBudget?: ToolRunBudget;
  /** Max agent turns for this 1:1 resume run (settings.maxTurns). */
  maxTurns?: number;
  session?: Session;
  sessionInputCallback?: SessionInputCallback;
  hasVisionInput?: boolean;
  /** Bot/squad id — generated images land in `~/.okbot/<ownerId>/resources/`. */
  ownerId: string;
  /** Absolute `~/.okbot/<ownerId>/resources` directory. */
  resourcesDir: string;
  /** Shell/fs backend for this run (local or cloud computer). Ignored when computerRoute is set. */
  executionBackend?: ExecutionBackend;
  /** Per-call computer selection for shell/fs tools. */
  computerRoute?: ComputerRoute;
  /** Extra tools appended after the built-ins (for example MCP tools). Resume must pass the same set. */
  extraTools?: readonly Tool[];
  meshPeers?: import('./mesh.js').MeshPeerSpec[];
  meshSettings?: import('@okbot/shared').MeshSettings;
  meshDepth?: number;
  meshStack?: string[];
  meshCallBudget?: import('./mesh.js').MeshCallBudget;
  meshMemberMaxTurns?: number;
  onMeshExchange?: (info: {
    kind: 'ask' | 'reply';
    exchangeId: string;
    peerBotId: string;
    peerName: string;
    callerBotId: string;
    callerName: string;
    content: string;
    usage?: TokenUsage;
  }) => void | Promise<void>;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onToolApprovalRequest: (req: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
  onToolResult?: (info: {
    requestId: string;
    toolName: string;
    approved: boolean;
    output?: string;
  }) => void;
  onClearLiveText?: () => void | Promise<void>;
  onCommitLiveAssistant?: () => void | Promise<void>;
  onModelTurnStart?: () => void | string;
  onModelTurnEnd?: (info: { ok: boolean; error?: string; spanId?: string }) => void;
  onApprovalWaitStart?: (toolName: string) => void | string;
  onApprovalWaitEnd?: (info: { toolName: string; approved: boolean; spanId?: string }) => void;
  onRunCheckpoint?: (info: { serializedRunState: string }) => void;
  /** Persisted `RunState.toString()` from the interrupted run. */
  serializedRunState: string;
  /** requestId of the pending approval being decided now. */
  requestId: string;
  /** Tool name used to match `state.getInterruptions()`. */
  toolName: string;
  decision: ToolApprovalDecision;
}

export type HitlLoopHooks = {
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  /**
   * Fired at tool boundaries: HITL interruptions and each auto-allow / post-HITL
   * tool start (via onBeforeToolExecute; skipped for send_message / ask_assistant).
   * Hosts should seal any user-visible pre-tool narration as its own bubble, or
   * discard think-only/empty without emitting a blank row; then reset the live
   * buffer so only the post-tool formal reply remains.
   */
  onClearLiveText?: () => void | Promise<void>;
  /**
   * 1:1 mesh ask_assistant: finalize the current live assistant text as its own
   * persisted bubble, then rotate to a fresh streaming message id for the
   * post-peer follow-up (do not append into the interim bubble).
   */
  onCommitLiveAssistant?: () => void | Promise<void>;
  /**
   * 1:1 send_message: create a persisted assistant bubble from tool content,
   * then rotate the live streaming id (host also seals any prior live text).
   */
  emitAssistantMessage?: EmitAssistantMessage;
  /** When set, duration budget pauses while waiting for tool approval (HITL). */
  toolRunBudget?: ToolRunBudget;
  /** Optional turn-span hooks (desktop RunTraceRecorder → message.trace waterfall). */
  onModelTurnStart?: () => void | string;
  onModelTurnEnd?: (info: { ok: boolean; error?: string; spanId?: string }) => void;
  onApprovalWaitStart?: (toolName: string) => void | string;
  onApprovalWaitEnd?: (info: { toolName: string; approved: boolean; spanId?: string }) => void;
  onToolApprovalRequest: (req: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
  onToolResult?: (info: {
    requestId: string;
    toolName: string;
    approved: boolean;
    output?: string;
  }) => void;
  /**
   * Safe tool-boundary checkpoint: serialized RunState after a model+tools segment
   * (and at HITL interruptions). Host persists for crash recovery; clear on complete/Stop.
   */
  onRunCheckpoint?: (info: { serializedRunState: string }) => void;
  /** Squad only: surface captain↔member exchanges in the UI transcript. */
  onSquadExchange?: (info: {
    kind: 'ask' | 'reply';
    memberBotId: string;
    memberName: string;
    toolName: string;
    content: string;
    usage?: TokenUsage;
  }) => void | Promise<void>;
  /** 1:1 mesh only: surface ask_assistant ask/reply in the UI transcript. */
  onMeshExchange?: (info: {
    kind: 'ask' | 'reply';
    exchangeId: string;
    peerBotId: string;
    peerName: string;
    callerBotId: string;
    callerName: string;
    content: string;
    usage?: TokenUsage;
  }) => void | Promise<void>;
};

/** Cold resume from a mid-run checkpoint (no pending HITL decision). */
export interface ResumeAgentChatFromCheckpointInput extends Omit<
  ResumeAgentChatAfterHitlInput,
  'requestId' | 'toolName' | 'decision'
> {}
