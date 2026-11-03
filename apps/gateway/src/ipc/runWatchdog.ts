/**
 * Global run Watchdog: poll busy / checkpointed owners and silently resume
 * safe mid-run checkpoints when a run is gone or heartbeat-timed-out.
 *
 * Hard gates (never silent-resume):
 * - manual Stop leftovers (autoResumeEligible === false)
 * - soft-steer handoff in flight
 * - pending HITL cards
 * - any still-alive run with fresh heartbeat (no double-start)
 */
import {
  DEFAULT_WATCHDOG_SETTINGS,
  normalizeWatchdogSettings,
} from '@okbot/shared';
import type { TurnContext } from './chat/turnContext';
import {
  abortOwnerRun,
  getOwnerRunLastHeartbeatMs,
  listBusyOwnerIds,
  listOwnerRunIds,
  ownerHasBusyHold,
  ownerHasRuns,
  waitOwnerRunUnregistered,
} from './ownerRuns';
import { hasSoftSteerCheckpointHandoff } from './softSteerGate';
import {
  resumeAllSafeCheckpoints,
  resumeOwnerFromCheckpoint,
} from './chat/coldRestoreCheckpoint';

export type RunWatchdogHandle = {
  stop: () => void;
  /** Test / diagnostics: run one tick immediately. */
  tick: () => Promise<void>;
};

function heartbeatTimeoutMs(intervalMs: number): number {
  // Allow long tool waits: at least 3 poll intervals, floor 90s.
  return Math.max(90_000, intervalMs * 3);
}

/**
 * Whether a disk checkpoint is eligible for silent Watchdog / cold auto-resume.
 * Composer「继续」and soft-steer consume paths ignore this and still load the file.
 */
export function isCheckpointSilentResumeSafe(
  ctx: TurnContext,
  ownerId: string,
): { ok: true } | { ok: false; reason: string } {
  const id = (ownerId || '').trim();
  if (!id) return { ok: false, reason: 'empty_owner' };
  if (hasSoftSteerCheckpointHandoff(id)) {
    return { ok: false, reason: 'soft_steer_handoff' };
  }
  if (ownerHasBusyHold(id)) {
    return { ok: false, reason: 'busy_hold' };
  }
  try {
    if (ctx.storage.listPendingHitl(id).length > 0) {
      return { ok: false, reason: 'pending_hitl' };
    }
  } catch (err) {
    console.error('[okbot] watchdog listPendingHitl failed', id, err);
    return { ok: false, reason: 'pending_hitl_error' };
  }
  let disk;
  try {
    disk = ctx.storage.loadRunCheckpoint(id);
  } catch (err) {
    console.error('[okbot] watchdog loadRunCheckpoint failed', id, err);
    return { ok: false, reason: 'load_error' };
  }
  if (!disk?.serializedRunState) {
    return { ok: false, reason: 'no_checkpoint' };
  }
  if (disk.autoResumeEligible === false) {
    return { ok: false, reason: 'stop_suppress_auto_resume' };
  }
  return { ok: true };
}

async function reapHeartbeatZombies(
  ctx: TurnContext,
  ownerId: string,
  timeoutMs: number,
): Promise<boolean> {
  const ids = listOwnerRunIds(ctx.abortControllers, ownerId);
  if (ids.length === 0) return false;
  const now = Date.now();
  let reaped = false;
  for (const runId of ids) {
    const last = getOwnerRunLastHeartbeatMs(ownerId, runId);
    if (last != null && now - last < timeoutMs) continue;
    console.warn(
      '[okbot] watchdog heartbeat timeout; aborting stale run',
      ownerId,
      runId,
      last == null ? 'no_heartbeat' : `${now - last}ms`,
    );
    abortOwnerRun(ctx.abortControllers, ownerId, runId);
    await waitOwnerRunUnregistered(ctx.abortControllers, ownerId, runId, 15_000);
    reaped = true;
  }
  return reaped;
}

async function watchdogTick(ctx: TurnContext): Promise<void> {
  const settings = normalizeWatchdogSettings(ctx.storage.getSettings().watchdog);
  if (!settings.enabled) return;

  const timeoutMs = heartbeatTimeoutMs(settings.intervalMs);
  const owners = new Set<string>([
    ...listBusyOwnerIds(ctx.abortControllers),
    ...ctx.storage.listAllRunCheckpoints().map((c) => c.ownerId),
  ]);

  for (const ownerId of owners) {
    try {
      if (ownerHasRuns(ctx.abortControllers, ownerId)) {
        await reapHeartbeatZombies(ctx, ownerId, timeoutMs);
      }
      // Still alive after reap → do not double-start.
      if (ownerHasRuns(ctx.abortControllers, ownerId) || ownerHasBusyHold(ownerId)) {
        continue;
      }
      const gate = isCheckpointSilentResumeSafe(ctx, ownerId);
      if (!gate.ok) continue;
      const disk = ctx.storage.loadRunCheckpoint(ownerId);
      if (!disk) continue;
      console.info('[okbot] watchdog silent resume', ownerId, disk.kind, disk.runId);
      const result = await resumeOwnerFromCheckpoint(ctx, disk);
      if (result.skipped) {
        console.info('[okbot] watchdog skip', ownerId, result.skipped);
      } else if (!result.ok) {
        console.error('[okbot] watchdog resume failed', ownerId, result.error);
      }
    } catch (err) {
      console.error('[okbot] watchdog tick owner failed', ownerId, err);
    }
  }
}

/**
 * Start the global Watchdog. Interval is read from settings each tick
 * (default 30s). Returns a stop handle.
 */
export function startRunWatchdog(ctx: TurnContext): RunWatchdogHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const schedule = () => {
    if (stopped) return;
    const settings = normalizeWatchdogSettings(ctx.storage.getSettings().watchdog);
    const ms = settings.enabled
      ? settings.intervalMs
      : DEFAULT_WATCHDOG_SETTINGS.intervalMs;
    timer = setTimeout(() => {
      void (async () => {
        if (stopped) return;
        if (!inFlight) {
          inFlight = watchdogTick(ctx).finally(() => {
            inFlight = null;
          });
          try {
            await inFlight;
          } catch (err) {
            console.error('[okbot] watchdog tick threw', err);
          }
        }
        schedule();
      })();
    }, ms);
    timer.unref?.();
  };

  schedule();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    tick: async () => {
      await watchdogTick(ctx);
    },
  };
}

/** Startup helper: cold resume once, then start Watchdog. */
export function startCheckpointRecovery(ctx: TurnContext): RunWatchdogHandle {
  void resumeAllSafeCheckpoints(ctx).catch((err) => {
    console.error('[okbot] resume checkpoints on start failed', err);
  });
  return startRunWatchdog(ctx);
}
