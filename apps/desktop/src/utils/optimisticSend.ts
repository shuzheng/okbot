import type { ChatMessage } from '@okbot/shared';

/** Fields needed to restore a failed optimistic user bubble when it never persisted. */
export interface FailedOptimisticSend {
  localId: string;
  text: string;
  quoteMessageId?: string;
  quotePreview?: string;
  attachments?: ChatMessage['attachments'];
  createdAt: string;
}

export const RECONCILED_LOCAL_CAP = 64;

/** Insertion-ordered cap so a long session cannot grow this set without bound. */
export function rememberReconciledLocalId(set: Set<string>, localId: string): void {
  set.delete(localId);
  set.add(localId);
  while (set.size > RECONCILED_LOCAL_CAP) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
}

/**
 * One send must leave one user bubble.
 * If chatStart rejects after `user_message` replaced `local_*` with the persisted id,
 * the optimistic row is already gone — do not append a second failed copy.
 * The same applies when the persisted row is already the latest user message
 * (the chat was left and re-entered before the failure settled).
 * A failure before that replacement still marks the same bubble failed so retry works.
 */
export function applyOptimisticSendFailure(
  prev: ChatMessage[],
  failed: FailedOptimisticSend,
  reconciledLocalIds: ReadonlySet<string>,
): ChatMessage[] {
  const idx = prev.findIndex((m) => m.id === failed.localId);
  if (idx >= 0) {
    const next = prev.slice();
    next[idx] = { ...next[idx], sendStatus: 'failed' };
    return next;
  }
  if (reconciledLocalIds.has(failed.localId)) return prev;
  for (let i = prev.length - 1; i >= 0; i--) {
    const row = prev[i]!;
    if (row.role !== 'user') continue;
    if (
      row.id !== failed.localId &&
      !String(row.id).startsWith('local_') &&
      (row.content || '') === failed.text
    ) {
      return prev;
    }
    break;
  }
  return [
    ...prev,
    {
      id: failed.localId,
      role: 'user',
      content: failed.text,
      createdAt: failed.createdAt,
      sendStatus: 'failed',
      ...(failed.quoteMessageId && failed.quotePreview
        ? { quoteMessageId: failed.quoteMessageId, quotePreview: failed.quotePreview }
        : {}),
      ...(failed.attachments?.length ? { attachments: failed.attachments } : {}),
    },
  ];
}
