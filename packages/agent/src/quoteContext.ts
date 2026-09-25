import type { AgentInputItem, SessionInputCallback } from '@openai/agents';

/**
 * Session already has the body-only user turn from appendMessage.
 * Enrich that last user item for the model without writing quote text into disk content.
 * Mutate in place and return the same history array — a new array/object identity makes
 * the SDK treat the turn as changed and double-persist the user message.
 */
export function quoteSessionInputCallback(modelUserText: string): SessionInputCallback {
  return (history: AgentInputItem[]) => {
    if (!history.length) return history;
    const last = history[history.length - 1] as Record<string, unknown> | undefined;
    if (!last || last.role !== 'user') return history;
    last.content = modelUserText;
    return history;
  };
}
