/** Pure unread counters for dock badge and scroll-to-bottom label. */

export function countUnreadSessions(
  bots: Array<{ hasUnreadReply?: boolean }>,
  squads: Array<{ hasUnreadReply?: boolean }>,
): number {
  let n = 0;
  for (const b of bots) if (b.hasUnreadReply === true) n += 1;
  for (const s of squads) if (s.hasUnreadReply === true) n += 1;
  return n;
}

/**
 * Assistant replies after the message the user was on when they left the bottom.
 * Skips mesh status chips (not main reply bubbles).
 */
export function countAssistantRepliesAfter(
  messages: Array<{ id: string; role: string; meshExchange?: unknown }>,
  anchorId: string | null,
): number {
  if (!anchorId) return 0;
  const idx = messages.findIndex((m) => m.id === anchorId);
  if (idx < 0) return 0;
  let n = 0;
  for (let i = idx + 1; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    if (m.meshExchange) continue;
    n += 1;
  }
  return n;
}
