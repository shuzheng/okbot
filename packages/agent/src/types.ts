import type {
  ChatMessage,
  ResolvedModelConfig,
  SecuritySettings,
  TokenUsage,
  ToolPreferences,
} from '@okbot/shared';
import type { Session, SessionInputCallback } from '@openai/agents';
import type { ToolRunBudget } from './toolRunBudget.js';
import type { SkillLookup } from './tools.js';
import type { ExecutionBackend } from './executionBackend.js';

export interface RunChatInput {
  botName: string;
  botDescription: string;
  /** Contents of the bot's AGENTS.md (system prompt). */
  agentsMd?: string;
  /** Catalog-only skills text (name/slug/when-to-use) for the system prompt. */
  skillsText?: string;
  /** Resolve full skill body by slug for the `read_skill` tool. */
  skillLookup?: SkillLookup;
  /** Formatted global + bot memories for the system prompt. */
  memoriesText?: string;
  /** Rolling summary of older turns (when context was compressed). */
  sessionSummary?: string;
  /** settings.instructions.assistantRoleTemplate (`{name}` → botName). */
  assistantRoleTemplate?: string;
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
  /** Shell/fs backend for this run (local or cloud computer). */
  executionBackend?: ExecutionBackend;
  onToolApprovalRequest: (req: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
  onToolResult?: (info: {
    requestId: string;
    toolName: string;
    approved: boolean;
    output?: string;
  }) => void;
  /** Clear pre-tool narration from the live assistant bubble when tools interrupt. */
  onClearLiveText?: () => void;
}

export interface ResumeAgentChatAfterHitlInput {
  botName: string;
  botDescription: string;
  agentsMd?: string;
  skillsText?: string;
  skillLookup?: SkillLookup;
  memoriesText?: string;
  sessionSummary?: string;
  assistantRoleTemplate?: string;
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
  /** Shell/fs backend for this run (local or cloud computer). */
  executionBackend?: ExecutionBackend;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onToolApprovalRequest: (req: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
  onToolResult?: (info: {
    requestId: string;
    toolName: string;
    approved: boolean;
    output?: string;
  }) => void;
  onClearLiveText?: () => void;
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
   * Fired when the run hits tool interruptions: discard pre-tool think-aloud from the
   * live bubble so only the post-tool formal reply remains visible.
   */
  onClearLiveText?: () => void;
  /** When set, duration budget pauses while waiting for tool approval (HITL). */
  toolRunBudget?: ToolRunBudget;
  onToolApprovalRequest: (req: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
  onToolResult?: (info: {
    requestId: string;
    toolName: string;
    approved: boolean;
    output?: string;
  }) => void;
  /** Squad only: surface captain↔member exchanges in the UI transcript. */
  onSquadExchange?: (info: {
    kind: 'ask' | 'reply';
    memberBotId: string;
    memberName: string;
    toolName: string;
    content: string;
    usage?: TokenUsage;
  }) => void;
};
