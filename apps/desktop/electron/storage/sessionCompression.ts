import {
  estimateTokensFromText,
  messagesAfterCoverage,
  normalizeContextCompression,
  uncoveredOlderMessages,
  type ChatMessage,
  type ContextCompressionSettings,
  type ResolvedModelConfig,
  type SessionSummary,
} from '@okbot/shared';
import { compressSessionHistory, detectTopicChange } from '@okbot/agent';

export type SessionSummaryStore = {
  readSessionSummary(ownerId: string): SessionSummary | null;
  writeSessionSummary(ownerId: string, entry: SessionSummary): void;
};

export type SessionCompressForceMode = 'compress' | 'newTopic';

/**
 * On send: optionally classify topic change and return force:'compress'.
 * Same noop gate as manual compress (liveBuffer longer than keepRecentMin).
 * Classify failure → undefined (fail open). Never returns newTopic.
 */
export async function resolveTopicCompressForce(input: {
  model: ResolvedModelConfig;
  contextCompression: ContextCompressionSettings | unknown;
  prior: ChatMessage[];
  sessionSummary: string | null | undefined;
  coveredThroughId: string | null | undefined;
  newUserText: string;
  signal?: AbortSignal;
}): Promise<SessionCompressForceMode | undefined> {
  const cc = normalizeContextCompression(input.contextCompression);
  if (!cc.autoTopicCompress) return undefined;
  const liveBuffer = messagesAfterCoverage(input.prior, input.coveredThroughId);
  // Nothing useful to fold → skip the classify call (same as force compress noop).
  if (liveBuffer.length <= cc.keepRecentMin) return undefined;
  const isNew = await detectTopicChange({
    model: input.model,
    sessionSummary: input.sessionSummary,
    recentMessages: liveBuffer,
    newUserText: input.newUserText,
    signal: input.signal,
  });
  return isNew ? 'compress' : undefined;
}

/**
 * Summary+Buffer for any chat owner (bot or squad). Advances coveredThroughId;
 * does not trim session.jsonl.
 *
 * `force`:
 * - compress — one pass now, bypass ratio; keep recent buffer per settings
 * - newTopic — one pass covering all prior into summary (keep=0) so the next
 *   model turn sees summary + new user text only; UI transcript unchanged
 *
 * Token estimate and auto/compress worksets use the *live* buffer (messages after
 * the current coveredThroughId), not the full UI transcript — otherwise a manual
 * newTopic/compress can look like a no-op on the next send when auto-compress
 * rewrites coveredThroughId backwards into an earlier tip.
 */
export async function ensureSessionCompressed(input: {
  storage: SessionSummaryStore;
  ownerId: string;
  model: ResolvedModelConfig;
  contextCompression: ContextCompressionSettings | unknown;
  /** Non-history material (agents, roster, current user text, …). */
  staticText: string;
  /** Prior UI messages excluding the just-appended user turn. */
  prior: ChatMessage[];
  signal?: AbortSignal;
  force?: SessionCompressForceMode;
}): Promise<{
  sessionSummary: string;
  summaryState: SessionSummary | null;
  didCompress: boolean;
}> {
  const cc = normalizeContextCompression(input.contextCompression);
  const threshold = Math.floor(input.model.contextWindow * cc.ratio);
  const packedEstimate = (summary: string, history: ChatMessage[]) =>
    estimateTokensFromText(
      input.staticText + (summary || '') + history.map((m) => m.content || '').join('\n'),
    );

  let summaryState = input.storage.readSessionSummary(input.ownerId);
  let sessionSummary = summaryState?.summary?.trim() || '';
  let didCompress = false;

  // Model-facing tail only (matches createSessionStore afterMessageId filter).
  const liveBuffer = messagesAfterCoverage(input.prior, summaryState?.coveredThroughId);
  let estimated = packedEstimate(sessionSummary, liveBuffer);

  const autoTrigger =
    !input.force && estimated >= threshold && liveBuffer.length > cc.keepRecentMin;
  const forceTrigger =
    input.force === 'newTopic'
      ? input.prior.length >= 1
      : input.force === 'compress'
        ? liveBuffer.length > cc.keepRecentMin
        : false;

  if (autoTrigger || forceTrigger) {
    let keep: number;
    /** Messages we may fold into the summary this pass. */
    let workset: ChatMessage[];
    if (input.force === 'newTopic') {
      // Slim model buffer: roll *all* prior into the summary (keep=0).
      keep = 0;
      workset = input.prior.slice();
    } else {
      // Auto / manual compress: only the yet-uncovered live buffer.
      workset = liveBuffer.slice();
      keep = Math.min(cc.keepRecentMax, Math.max(0, workset.length - 1));
      keep = Math.max(cc.keepRecentMin, keep);
      if (keep >= workset.length) keep = Math.max(0, workset.length - 1);
    }

    for (;;) {
      const older = keep === 0 ? workset.slice() : workset.slice(0, -keep);
      const recent = keep === 0 ? [] : workset.slice(-keep);
      const tipId = older[older.length - 1]?.id || '';

      if (!older.length) {
        sessionSummary = summaryState?.summary?.trim() || '';
      } else if (tipId && summaryState?.coveredThroughId === tipId && summaryState.summary.trim()) {
        sessionSummary = summaryState.summary.trim();
      } else {
        const delta = uncoveredOlderMessages(older, summaryState?.coveredThroughId);
        try {
          if (!delta.length && summaryState?.summary?.trim()) {
            sessionSummary = summaryState.summary.trim();
          } else {
            sessionSummary = await compressSessionHistory({
              model: input.model,
              previousSummary: summaryState?.summary,
              deltaMessages: delta.length ? delta : older,
              signal: input.signal,
              summaryMaxChars: cc.summaryMaxChars,
            });
            didCompress = true;
          }
          if (tipId && sessionSummary) {
            // Monotonic in `prior` order: never move coveredThroughId earlier.
            const prevId = summaryState?.coveredThroughId;
            const prevIdx = prevId ? input.prior.findIndex((m) => m.id === prevId) : -1;
            const tipIdx = input.prior.findIndex((m) => m.id === tipId);
            const nextCoveredId =
              prevIdx >= 0 && tipIdx >= 0 && prevIdx > tipIdx ? prevId! : tipId;
            summaryState = {
              summary: sessionSummary,
              coveredThroughId: nextCoveredId,
              updatedAt: new Date().toISOString(),
            };
            input.storage.writeSessionSummary(input.ownerId, summaryState);
          }
        } catch (err) {
          console.error('[okbot] session compress failed', err);
          sessionSummary = summaryState?.summary?.trim() || '';
          if (input.force) throw err;
        }
      }

      // Forced manual pass: one shot (no ratio-driven keep shrinking).
      if (input.force) break;

      estimated = packedEstimate(sessionSummary, recent);
      if (estimated < threshold || keep <= cc.keepRecentMin) break;

      const nextKeep = Math.max(cc.keepRecentMin, Math.floor(keep / 2));
      if (nextKeep >= keep) break;
      keep = nextKeep;
    }
  }

  return { sessionSummary, summaryState, didCompress };
}
