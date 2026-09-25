import type { AgentInputItem, Session } from '@openai/agents';
import { stripThinkFromAgentInputItem } from '@okbot/shared';

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
    // Model context must never include `<think>` spans (UI storage may still keep them).
    return (items as AgentInputItem[]).map((item) =>
      stripThinkFromAgentInputItem(item as Record<string, unknown>) as AgentInputItem,
    );
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    if (!items.length) return;
    await this.store.appendItems(items);
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
