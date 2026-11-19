import type { MemoryEntry } from '@okbot/shared';

/** Timestamp shown on a memory row: last hit if any, else created. */
export function memoryListTimestamp(
  entry: Pick<MemoryEntry, 'lastHitAt' | 'createdAt'>,
): string | undefined {
  const ts = entry.lastHitAt || entry.createdAt;
  if (typeof ts !== 'string' || !ts.trim()) return undefined;
  return ts;
}

/** Compact score label: integers as-is, otherwise one decimal. */
export function formatMemoryScore(score: number): string {
  if (!Number.isFinite(score)) return '0';
  const rounded = Math.round(score * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Last visible user message for memory relevance (skips quiet auto-continue rows). */
export function lastUserQueryText(
  messages: Array<{ role: string; content?: string; autoContinue?: boolean }>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'user' || m.autoContinue) continue;
    const text = (m.content || '').trim();
    if (text) return text;
  }
  return undefined;
}
