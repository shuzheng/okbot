import { plainTextFromMarkdown, type MessageSearchHit } from '@okbot/shared';
import type { FileStorage } from '../storage';

const HIT_CONTENT_MAX = 400;

function redactHitContent(text: string): string {
  const plain = plainTextFromMarkdown(text || '').replace(/\s+/g, ' ').trim();
  if (plain.length <= HIT_CONTENT_MAX) return plain;
  return `${plain.slice(0, HIT_CONTENT_MAX)}…`;
}

export function formatHistorySearchHits(hits: MessageSearchHit[]): string {
  if (!hits.length) return '（无匹配）';
  return hits
    .map((h, i) => {
      const who =
        h.message.role === 'user'
          ? '用户'
          : h.speakerName
            ? `助手:${h.speakerName}`
            : '助手';
      const when = h.message.createdAt || '';
      const body = redactHitContent(h.message.content || h.snippet || '');
      return `${i + 1}. [${when}] ${who}: ${body}`;
    })
    .join('\n\n');
}

/** Bound `search_history` execute helper for one owner (bot or squad). */
export function historySearchForOwner(storage: FileStorage, ownerId: string) {
  return async (query: string, limit: number): Promise<string> => {
    const hits = await storage.searchMessagesForOwner(ownerId, query, { limit });
    return formatHistorySearchHits(hits);
  };
}
