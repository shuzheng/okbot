import { plainTextFromMarkdown, stripThinkContent } from '@okbot/shared';
import { truncateNotifyBody } from './systemNotify';

/** Store key for the last formal assistant bubble in a turn. */
export function visibleReplyStoreKey(botId: string, runId?: string): string {
  const id = (runId || '').trim();
  return id ? `${botId}:${id}` : botId;
}

/** Plain, truncated body for a completed-reply system notification. */
export function notifyBodyFromReply(content: string, max = 180): string {
  return truncateNotifyBody(plainTextFromMarkdown(stripThinkContent(content || '')), max);
}

/**
 * Prefer the last visible formal bubble (`send_message`) from this turn.
 * Fall back to done-event content when this turn never called `send_message`
 * and the final output_text is the visible reply. Returns an empty string
 * when neither has usable text — callers must not substitute a fixed
 * "reply finished" phrase.
 */
export function pickNotifyReplyBody(opts: {
  lastVisibleReply?: string;
  doneContent?: string;
  max?: number;
}): string {
  const max = opts.max ?? 180;
  return (
    notifyBodyFromReply(opts.lastVisibleReply || '', max) ||
    notifyBodyFromReply(opts.doneContent || '', max)
  );
}
