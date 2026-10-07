import type { AgentInputItem, Session } from '@openai/agents';
import { sanitizeNullsInToolCallArguments, stripThinkFromAgentInputItem } from '@okbot/shared';

/**
 * Persistence adapter for OkbotFileSession.
 * Electron FileStorage implements this with plain JSON objects; we cast at the boundary.
 */
export interface OkbotSessionStore {
  getSessionId(): string;
  readItems(limit?: number): Promise<unknown[]> | unknown[];
  appendItems(items: unknown[]): Promise<void> | void;
  popItem(): Promise<unknown | undefined> | unknown | undefined;
  clearItems(): Promise<void> | void;
  replaceItems(items: unknown[]): Promise<void> | void;
}

/**
 * File-backed Session for @openai/agents Runner.
 * All IO goes through OkbotSessionStore (typically FileStorage session.jsonl v2).
 */
export class OkbotFileSession implements Session {
  constructor(private readonly store: OkbotSessionStore) {}

  async getSessionId(): Promise<string> {
    return this.store.getSessionId();
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const items = await this.store.readItems(limit);
    // Model context: strip `<think>` and drop nulls inside tool-call arguments
    // (strict gateways e.g. MiniMax 400/2013 reject `"job_id":null` in history).
    return (items as AgentInputItem[]).map((item) => {
      const stripped = stripThinkFromAgentInputItem(item as Record<string, unknown>);
      return sanitizeNullsInToolCallArguments(stripped) as AgentInputItem;
    });
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    if (!items.length) return;
    const cleaned = items.map((item) =>
      sanitizeNullsInToolCallArguments(item as Record<string, unknown>),
    );
    await this.store.appendItems(cleaned);
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    const item = await this.store.popItem();
    return item as AgentInputItem | undefined;
  }

  async clearSession(): Promise<void> {
    await this.store.clearItems();
  }

  async replaceHistoryWithCompaction(items: AgentInputItem[]): Promise<void> {
    await this.store.replaceItems(items);
  }
}

/** Convenience factory so Electron does not need to import @openai/agents types. */
export function createOkbotFileSession(store: OkbotSessionStore): OkbotFileSession {
  return new OkbotFileSession(store);
}
