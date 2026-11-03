/**
 * Collapse composer draft text for the session-list subtitle.
 * Returns null when there is nothing meaningful to show (empty / whitespace-only).
 * Structured @[kind:id|label] tokens render as @label for readability.
 */
import { humanizeMentionTokens } from './entityMentions';

export function formatSessionDraftPreview(raw: string): string | null {
  const text = humanizeMentionTokens(raw).replace(/\s+/g, ' ').trim();
  return text || null;
}
