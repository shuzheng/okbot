/**
 * Ephemeral next-reply placeholder from `set_status`.
 * Not a transcript message; never persisted. One placeholder per owner.
 */

export type AssistantStatusPlaceholder = {
  messageId: string;
  status: string;
  runId?: string;
};

export type AssistantStatusEventInput = {
  type: string;
  botId: string;
  messageId?: string;
  status?: string;
  runId?: string;
  /** Visible assistant text when the event carries it (`done` / error body). */
  hasVisibleReply?: boolean;
  /** True when a `done` event is an abort (Stop / soft-steer). */
  aborted?: boolean;
  /**
   * Most recent `turn_started` runId for this owner. Events from an older
   * run must not clear a placeholder already kept or updated for the new run.
   */
  latestRunId?: string;
};

function eventIsFromStaleRun(event: AssistantStatusEventInput): boolean {
  const ev = (event.runId || '').trim();
  const latest = (event.latestRunId || '').trim();
  return Boolean(ev && latest && ev !== latest);
}

/**
 * Update per-owner placeholder state from a runtime event.
 * - `assistant_status` with text sets/updates the same placeholder.
 * - empty `status` or a real reply / turn end (`done` / `error` / visible
 *   `assistant_message`) clears it, unless the event belongs to a stale run.
 * - aborted `done` (soft-steer / Stop) does not clear; Stop still emits an
 *   empty `assistant_status` for the same run (and the composer clears locally).
 */
export function reduceAssistantStatusPlaceholders(
  prev: Record<string, AssistantStatusPlaceholder>,
  event: AssistantStatusEventInput,
): Record<string, AssistantStatusPlaceholder> {
  const ownerId = event.botId;
  const current = prev[ownerId];

  const clearIfCurrentRun = (): Record<string, AssistantStatusPlaceholder> => {
    if (!current) return prev;
    if (eventIsFromStaleRun(event)) return prev;
    const ev = (event.runId || '').trim();
    const currentRun = (current.runId || '').trim();
    const latest = (event.latestRunId || '').trim();
    // A finish/reply from the latest run must replace a leftover placeholder
    // still tagged with the aborted run after a soft-steer handoff.
    if (latest && ev && ev === latest) {
      const next = { ...prev };
      delete next[ownerId];
      return next;
    }
    // Without latestRunId (or untagged events): only clear the same run.
    if (currentRun && ev && currentRun !== ev) return prev;
    const next = { ...prev };
    delete next[ownerId];
    return next;
  };

  if (event.type === 'assistant_status') {
    const text = (event.status || '').trim();
    if (!text) return clearIfCurrentRun();
    const messageId = (event.messageId || current?.messageId || '').trim();
    if (!messageId) return prev;
    // Never inherit an older runId: a new status without runId must not be
    // cleared later by the aborted run's done / empty-status event.
    const runId = (event.runId || '').trim() || (event.latestRunId || '').trim() || undefined;
    const next: AssistantStatusPlaceholder = {
      messageId,
      status: text,
      ...(runId ? { runId } : {}),
    };
    if (
      current &&
      current.messageId === next.messageId &&
      current.status === next.status &&
      current.runId === next.runId
    ) {
      return prev;
    }
    return { ...prev, [ownerId]: next };
  }

  if (event.type === 'assistant_message' && event.hasVisibleReply) {
    return clearIfCurrentRun();
  }

  if (event.type === 'done' || event.type === 'error') {
    if (event.type === 'done' && event.aborted) return prev;
    return clearIfCurrentRun();
  }

  return prev;
}
