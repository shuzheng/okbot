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
    /** User message quotes another bubble by id (UI only; content stays body-only). */
    quoteMessageId?: string;
    /** Short preview snapshot of the quoted message. */
    quotePreview?: string;
    /** User attachments for chip UI (content may still carry `[Attached]` for the model). */
    attachments?: Array<{ kind: 'image' | 'file' | 'folder'; path: string; name: string }>;
    /** Assistant turn token usage. */
    usage?: { input: number; output: number; cache: number };
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
  createdAt: string;
};
