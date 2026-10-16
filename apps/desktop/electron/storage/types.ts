/** On-disk session.jsonl v2 envelope (SDK item + optional UI meta). */
export type SessionRecordV2 = {
  v: 2;
  id: string;
  createdAt: string;
  /** AgentInputItem JSON (kept loose so electron does not import @openai/agents). */
  item: Record<string, unknown>;
  meta?: {
    uiRole?: 'user' | 'assistant';
    /** Squad transcript: which bot authored this assistant bubble. */
    speakerBotId?: string;
    /** 1:1 mesh status row (compact「已发消息给」; ask/reply in dialog). */
    meshExchange?: import('@okbot/shared').MeshExchangeMeta;
    /** Sealed ask_assistant interim (message A); UI hides later SDK dups of this text. */
    meshInterim?: boolean;
    /** Host auto-continue synthetic user row; model sees it, UI transcript hides it. */
    autoContinue?: boolean;
    /** User message quotes another bubble by id (UI only; content stays body-only). */
    quoteMessageId?: string;
    /** Short preview snapshot of the quoted message. */
    quotePreview?: string;
    /** User attachments for chip UI (content may still carry `[Attached]` for the model). */
    attachments?: Array<{ kind: 'image' | 'file' | 'folder'; path: string; name: string }>;
    /** Assistant turn token usage. */
    usage?: { input: number; output: number; cache: number };
    /** Assistant turn waterfall timeline (model / tools / approval). */
    trace?: import('@okbot/shared').MessageTrace;
    /** Parallel chat turn id — hides in-flight sibling rows from other runs. */
    runId?: string;
  };
};

/** Persisted HITL tool approval + serialized SDK RunState (cold-start resume). */
export type PendingHitlRecord = {
  v: 1;
  requestId: string;
  messageId: string;
  toolName: string;
  arguments: unknown;
  serializedRunState: string;
  computerId?: string;
  /** User text for this turn, so a cold resume keeps the same computer routing. */
  userText?: string;
  /**
   * Squad only: the approval came from a member run inside `ask_*`.
   * `serializedRunState` is then the member's run, not the captain's.
   */
  squadMember?: { botId: string; toolName: string; task: string };
  /** Squad only: stable id of the user turn (bubble ids rotate between captain segments). */
  turnId?: string;
  createdAt: string;
};

/** @deprecated Use TaskStatus from @okbot/shared (multi-task tasks.jsonl). */
export type TaskProgressItemStatus = import('@okbot/shared').TaskStatus;
/** @deprecated Use TaskStep from @okbot/shared. */
export type TaskProgressItem = import('@okbot/shared').TaskStep;
/**
 * @deprecated Legacy single-plan shape (task-progress.json). Prefer TaskRecord.
 * Kept for one-shot migration into tasks.jsonl.
 */
export type TaskProgressRecord = {
  v: 1;
  title?: string;
  items: import('@okbot/shared').TaskStep[];
  updatedAt: string;
};

export type { TaskStatus, TaskStep, TaskRecord } from '@okbot/shared';

/** Mid-run SDK RunState checkpoint for crash recovery (not HITL-only). */
export type RunCheckpointRecord = {
  v: 1;
  ownerId: string;
  /** bot = 1:1; squad = captain run (auto-resume currently bots only). */
  kind: 'bot' | 'squad';
  runId: string;
  messageId: string;
  serializedRunState: string;
  computerId?: string;
  userText?: string;
  createdAt: string;
  updatedAt: string;
};
