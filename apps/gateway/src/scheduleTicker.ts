/**
 * Poll due scheduled jobs and start a normal chat turn for each.
 * Runs only in the process that owns the gateway (Electron or `okbot serve`).
 * Missed fires while the process is down: one catch-up per job when next due is already past.
 *
 * Product choice: scheduled turns use the same tool approval + budget as interactive
 * turns (no separate "schedule-fire" policy). Harden creation instead — `manage_schedule`
 * defaults to ask, and create/delete always require HITL.
 */
import { isSquadOwnerId } from './storage/ids';
import type { FileStorage } from './storage';
import type { ScheduledJob } from './storage/schedules';
import { formatScheduledTurnText } from './storage/schedules';
import { startChatTurn } from './ipc/registerChat';
import type { IpcContext } from './ipc/context';
import { ownerHasRuns } from './ipc/ownerRuns';

const DEFAULT_INTERVAL_MS = 20_000;

export type ScheduleTickerDeps = {
  storage: FileStorage;
  ctx: IpcContext;
  intervalMs?: number;
};

export function startScheduleTicker(deps: ScheduleTickerDeps): () => void {
  const intervalMs = Math.max(5_000, deps.intervalMs ?? DEFAULT_INTERVAL_MS);
  const inflight = new Set<string>();
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  const tick = async () => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      let due: ScheduledJob[] = [];
      try {
        due = deps.storage
          .listAllEnabledScheduledJobs()
          .filter((j) => j.nextRunAt && Date.parse(j.nextRunAt) <= now);
      } catch (err) {
        console.error('[okbot] schedule list failed', err);
        return;
      }
      // Stable order: earliest nextRun first
      due.sort((a, b) => (a.nextRunAt || '').localeCompare(b.nextRunAt || ''));
      for (const job of due) {
        if (stopped) break;
        const key = `${job.ownerId}:${job.id}`;
        if (inflight.has(key)) continue;
        inflight.add(key);
        void fireScheduledJob(deps, job, inflight, key);
      }
    } finally {
      ticking = false;
    }
  };

  void tick();
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
}

/**
 * Fire one due job. Exported for tests (once+busy must not claim/disable).
 * All ownerHasRuns checks run *before* claim so once jobs are never left
 * enabled=false / nextRunAt=null after a busy skip.
 */
export async function fireScheduledJob(
  deps: ScheduleTickerDeps,
  job: ScheduledJob,
  inflight: Set<string>,
  key: string,
): Promise<void> {
  const text = formatScheduledTurnText(job);
  const ownerId = job.ownerId;
  const payload = isSquadOwnerId(ownerId)
    ? { squadId: ownerId, text, origin: 'schedule' as const }
    : { botId: ownerId, text, origin: 'schedule' as const };
  let claimed = false;
  try {
    // Never claim while busy — once jobs disable on claim and must not be lost.
    if (ownerHasRuns(deps.ctx.abortControllers, ownerId)) return;
    const claim = deps.storage.claimScheduledJobDue(ownerId, job.id);
    if (!claim) return;
    claimed = true;
    // Hold inflight until finally so the same due nextRunAt cannot stack while
    // the turn runs (claim no longer advances nextRunAt).
    // First turn only — AC continues in background (do not hold lastRunAt across AC).
    const result = await startChatTurn(deps.ctx, payload, { awaitAutoContinue: false });
    if (result?.aborted || result?.superseded) {
      deps.storage.markScheduledJobFired(ownerId, job.id, {
        ok: false,
        error: result.aborted ? 'aborted' : 'superseded',
      });
    } else {
      deps.storage.markScheduledJobFired(ownerId, job.id, { ok: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[okbot] schedule fire failed', job.id, err);
    if (claimed) {
      try {
        deps.storage.markScheduledJobFired(ownerId, job.id, { ok: false, error: message });
      } catch (persistErr) {
        console.error('[okbot] schedule mark failed', persistErr);
      }
    }
  } finally {
    inflight.delete(key);
  }
}
