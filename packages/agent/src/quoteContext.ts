import type { SessionInputCallback } from '@openai/agents';
import { enrichLastUserContentSessionInputCallback } from './visionInput.js';

/**
 * Session already has the body-only user turn from appendMessage.
 * Enrich that last user item for the model without writing quote text into disk content.
 * Mutate in place and return the same history array — a new array/object identity makes
 * the SDK treat the turn as changed and double-persist the user message.
 */
export function quoteSessionInputCallback(modelUserText: string): SessionInputCallback {
  return enrichLastUserContentSessionInputCallback(modelUserText);
}
