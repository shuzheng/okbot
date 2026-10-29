import {
  messagesAfterCoverage,
  normalizeContextCompression,
  uncoveredOlderMessages,
  type ChatMessage,
  type ContextCompressionSettings,
  type ResolvedModelConfig,
  type SessionSummary,
} from '@okbot/shared';
import {
  compressSessionHistory,
  detectTopicChange,
  ContextWindowExceededError,
  estimatePackedSessionTokens,
  omitOldestToolResultsUntilFit,
  rowsForPriorBudget,
  type BudgetSessionRow,
  type SessionHistoryCompressResult,
} from '@okbot/agent';

export type SessionSummaryStore = {
  readSessionSummary(ownerId: string): SessionSummary | null;
  writeSessionSummary(ownerId: string, entry: SessionSummary): void;
};

export type SessionCompressForceMode = 'compress' | 'newTopic';

type CompressImpl = (input: {
  model: ResolvedModelConfig;
  previousSummary?: string | null;
  deltaMessages: ChatMessage[];
  signal?: AbortSignal;
  summaryMaxChars?: number;
  sessionRows?: Array<{ id: string; item: Record<string, unknown> }>;
}) => Promise<SessionHistoryCompressResult>;

type TopicDetectImpl = (input: {
  model: ResolvedModelConfig;
  sessionSummary?: string | null;
  recentMessages: ChatMessage[];
  newUserText: string;
  signal?: AbortSignal;
}) => Promise<boolean>;

/**
 * On send: optionally classify topic change.
 * A new topic forces `newTopic` (keep=0: summary + new message only).
 * Same topic returns undefined so the ratio path keeps the recent buffer.
 * Classify failure → undefined (fail open).
 */
export async function resolveTopicCompressForce(input: {
  model: ResolvedModelConfig;
  contextCompression: ContextCompressionSettings | unknown;
  prior: ChatMessage[];
  sessionSummary: string | null | undefined;
  coveredThroughId: string | null | undefined;
  newUserText: string;
  signal?: AbortSignal;
  /** Test seam. Defaults to detectTopicChange. */
  detect?: TopicDetectImpl;
}): Promise<SessionCompressForceMode | undefined> {
  const cc = normalizeContextCompression(input.contextCompression);
  if (!cc.autoTopicCompress) return undefined;
  const liveBuffer = messagesAfterCoverage(input.prior, input.coveredThroughId);
  // Nothing useful to fold → skip the classify call (same as force compress noop).
  if (liveBuffer.length <= cc.keepRecentMin) return undefined;
  const detect = input.detect ?? detectTopicChange;
  const isNew = await detect({
    model: input.model,
    sessionSummary: input.sessionSummary,
    recentMessages: liveBuffer,
    newUserText: input.newUserText,
    signal: input.signal,
  });
  return isNew ? 'newTopic' : undefined;
}

/**
 * When the resolved model for this turn differs from the last recorded key,
 * force one Summary+Buffer compress (keep recent buffer). First observation
 * (no last key) returns undefined — caller should seed lastEffectiveModel
 * without compressing so we do not spam on cold sessions.
 */
export function resolveModelChangeCompressForce(input: {
  lastEffectiveModel: string | null | undefined;
  nextEffectiveModel: string;
}): SessionCompressForceMode | undefined {
  const next = (input.nextEffectiveModel || '').trim();
  if (!next) return undefined;
  const last = (input.lastEffectiveModel || '').trim();
  if (!last) return undefined;
  return last === next ? undefined : 'compress';
}

/**
 * Combine topic + model-change force modes. `newTopic` wins (keep=0).
 */
export function mergeCompressForce(
  ...modes: Array<SessionCompressForceMode | undefined>
): SessionCompressForceMode | undefined {
  if (modes.some((m) => m === 'newTopic')) return 'newTopic';
  if (modes.some((m) => m === 'compress')) return 'compress';
  return undefined;
}

function rowsFromPrior(prior: ChatMessage[]): BudgetSessionRow[] {
  return prior.map((m) => ({
    id: m.id,
    item: { type: 'message', role: m.role, content: m.content || '' },
  }));
}

/**
 * Summary+Buffer for any chat owner (bot or squad). Advances coveredThroughId
 * only through items the summarizer actually read. Does not trim session.jsonl.
 *
 * `force`:
 * - compress — one pass now, bypass ratio; keep recent buffer per settings
 * - newTopic — one pass covering all prior into summary (keep=0) so the next
 *   model turn sees summary + new user text only; UI transcript unchanged
 *
 * Auto send path: token estimate uses the live tail that will be sent, including
 * tool arguments and tool results. If still over budget after one compress, keep
 * shrinks down to 0 (not floored at keepRecentMin). Oldest tool results in the
 * remaining tail are dropped next. `enforceBudget` then fails the turn instead
 * of sending an over-long request.
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
  /**
   * Full session rows (message + tool). When omitted, prior message bodies are used
   * and tool payloads are not visible to the estimate.
   */
  sessionRows?: BudgetSessionRow[];
  signal?: AbortSignal;
  force?: SessionCompressForceMode;
  /** When true (send path), refuse to return if the packed prompt is still over budget. */
  enforceBudget?: boolean;
  /**
   * After a successful compress that advanced coverage: run LLM memory extraction on the
   * delta that left the live window (before it exists only as summary prose).
   * No programmatic scraping of 约定/决定 — model owns write + dedup via refreshMemories.
   */
  onHistoryFolded?: (info: {
    deltaMessages: ChatMessage[];
    summary: string;
  }) => void | Promise<void>;
  /** Test seam. Defaults to compressSessionHistory. */
  compress?: CompressImpl;
}): Promise<{
  sessionSummary: string;
  summaryState: SessionSummary | null;
  didCompress: boolean;
  /** Tool-result record ids to hide from the model-facing session tail. */
  omitRecordIds: string[];
}> {
  const cc = normalizeContextCompression(input.contextCompression);
  const threshold = Math.floor(input.model.contextWindow * cc.ratio);
  const safetyFactor = cc.estimateSafetyFactor;
  const compressFn = input.compress ?? compressSessionHistory;
  const allRows = input.sessionRows?.length ? input.sessionRows : rowsFromPrior(input.prior);

  let summaryState = input.storage.readSessionSummary(input.ownerId);
  let sessionSummary = summaryState?.summary?.trim() || '';
  let didCompress = false;

  const budgetRows = () =>
    rowsForPriorBudget(allRows, input.prior, summaryState?.coveredThroughId);
  const packedEstimate = () =>
    estimatePackedSessionTokens(input.staticText, sessionSummary, budgetRows());
  /** Local heuristic scaled to better match provider billed usage before threshold checks. */
  const effectiveEstimate = (raw: number) => Math.floor(raw * safetyFactor);

  // Model-facing tail only (matches createSessionStore afterMessageId filter).
  const liveBuffer = messagesAfterCoverage(input.prior, summaryState?.coveredThroughId);
  let estimated = packedEstimate();

  const autoTrigger =
    !input.force && effectiveEstimate(estimated) >= threshold && liveBuffer.length > 0;
  const forceTrigger =
    input.force === 'newTopic'
      ? input.prior.length >= 1
      : input.force === 'compress'
        ? liveBuffer.length > cc.keepRecentMin
        : false;

  /** Deltas folded this pass (for memory extraction at compress time). */
  const foldedDeltas: ChatMessage[] = [];

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

    const advanceCovered = (readId: string | null, summary: string) => {
      if (!readId || !summary) return;
      const prevId = summaryState?.coveredThroughId;
      const prevIdx = prevId ? input.prior.findIndex((m) => m.id === prevId) : -1;
      const tipIdx = input.prior.findIndex((m) => m.id === readId);
      if (tipIdx < 0) return;
      // Monotonic in `prior` order: never move coveredThroughId earlier,
      // and never past the last item the summarizer actually read.
      const nextCoveredId = prevIdx >= 0 && prevIdx > tipIdx ? prevId! : readId;
      summaryState = {
        summary,
        coveredThroughId: nextCoveredId,
        updatedAt: new Date().toISOString(),
      };
      input.storage.writeSessionSummary(input.ownerId, summaryState);
    };

    for (;;) {
      const older = keep === 0 ? workset.slice() : workset.slice(0, -keep);
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
            const deltaMessages = delta.length ? delta : older;
            const compressed = await compressFn({
              model: input.model,
              previousSummary: summaryState?.summary,
              deltaMessages,
              signal: input.signal,
              summaryMaxChars: cc.summaryMaxChars,
              sessionRows: input.sessionRows,
            });
            sessionSummary = compressed.summary;
            if (compressed.consumedThroughId) {
              didCompress = true;
              // Only messages the summarizer actually consumed — a partial
              // prefix must not be handed to compress-time memory extract
              // (those rows remain uncovered for the next pass).
              const tip = compressed.consumedThroughId;
              const tipIdx = deltaMessages.findIndex((m) => m.id === tip);
              foldedDeltas.push(
                ...(tipIdx >= 0 ? deltaMessages.slice(0, tipIdx + 1) : deltaMessages),
              );
            }
            advanceCovered(compressed.consumedThroughId, sessionSummary);
          }
        } catch (err) {
          console.error('[okbot] session compress failed', err);
          sessionSummary = summaryState?.summary?.trim() || '';
          if (input.force) throw err;
        }
      }

      // Forced manual pass: one shot (no ratio-driven keep shrinking).
      if (input.force) break;

      estimated = packedEstimate();
      if (effectiveEstimate(estimated) < threshold || keep <= 0) break;

      // Still over budget: do not stop at keepRecentMin. Halve, then 0.
      const nextKeep = Math.floor(keep / 2);
      if (nextKeep >= keep) break;
      keep = nextKeep;
    }
  }

  let omitRecordIds: string[] = [];
  if (input.enforceBudget) {
    estimated = packedEstimate();
    // omitOldestToolResultsUntilFit compares raw estimate to threshold; pass a
    // lowered target so calibrated (raw × factor) fits the real threshold.
    const omitTarget = Math.max(1, Math.floor(threshold / safetyFactor));
    if (effectiveEstimate(estimated) >= threshold) {
      const dropped = omitOldestToolResultsUntilFit({
        staticText: input.staticText,
        summary: sessionSummary,
        rows: budgetRows(),
        threshold: omitTarget,
      });
      omitRecordIds = dropped.omitRecordIds;
      estimated = estimatePackedSessionTokens(input.staticText, sessionSummary, dropped.rows);
    }
    if (effectiveEstimate(estimated) >= threshold) throw new ContextWindowExceededError();
  }

  if (didCompress && input.onHistoryFolded && sessionSummary.trim()) {
    try {
      await input.onHistoryFolded({
        deltaMessages: foldedDeltas,
        summary: sessionSummary,
      });
    } catch (err) {
      console.error('[okbot] compress-time memory extract failed', err);
    }
  }

  return { sessionSummary, summaryState, didCompress, omitRecordIds };
}
