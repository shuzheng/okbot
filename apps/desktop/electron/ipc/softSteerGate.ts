/**
 * Soft-steer gate for the 1:1 orchestrator: cancel auto-continue, abort all
 * in-flight owner runs, and serialize rapid composer appends while busy.
 * Kept free of startBotTurn so Stop / chatControl tests do not load the full
 * agent stack.
 */
import { cancelAutoContinues } from './autoContinueGate';
import {
  abortOwnerRun,
  clearOwnerBusyHolds,
  holdOwnerBusy,
  listBusyOwnerIds,
  listOwnerRunIds,
  releaseOwnerBusyHold,
  waitOwnerRunUnregistered,
  type AbortControllerMap,
} from './ownerRuns';

/** Bumped on Stop so a waiting soft-steer does not start after abort. */
const softSteerEpoch = new Map<string, number>();

/** Serialize soft-steers per owner (rapid composer appends while busy). */
const softSteerChains = new Map<string, Promise<void>>();

export function cancelSoftSteers(ownerId: string): void {
  const id = (ownerId || '').trim();
  if (!id) return;
  softSteerEpoch.set(id, (softSteerEpoch.get(id) ?? 0) + 1);
  // Stop during soft-steer: drop abort→restart hold so busy does not stick.
  clearOwnerBusyHolds(id);
}

export function resetSoftSteerStateForTests(): void {
  softSteerEpoch.clear();
  softSteerChains.clear();
}

async function withSoftSteerLock<T>(ownerId: string, fn: () => Promise<T>): Promise<T> {
  const id = (ownerId || '').trim() || '_';
  const prev = softSteerChains.get(id) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  softSteerChains.set(
    id,
    prev.then(
      () => gate,
      () => gate,
    ),
  );
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

function bumpSoftSteerEpoch(ownerId: string): number {
  const next = (softSteerEpoch.get(ownerId) ?? 0) + 1;
  softSteerEpoch.set(ownerId, next);
  return next;
}

function currentSoftSteerEpoch(ownerId: string): number {
  return softSteerEpoch.get(ownerId) ?? 0;
}

/** Current soft-steer epoch for owner (0 if never bumped). Used to detect Stop during classify. */
export function getSoftSteerEpoch(ownerId: string): number {
  const id = (ownerId || '').trim();
  if (!id) return 0;
  return currentSoftSteerEpoch(id);
}

/**
 * Soft-steer: cancel host auto-continue chains, abort every in-flight run for
 * this owner (newest and older peers, including auto_continue), wait for
 * cleanup, then let the caller start a fresh turn that includes the new user
 * message. Only one replacement turn should remain.
 *
 * Busy hold: from before abort until {@link registerOwnerRun} on the replacement
 * (or Stop / empty / superseded). Prevents listBusyOwnerIds flashing idle in the
 * unregister → re-register gap.
 */
export async function softSteerNewestRun(
  ctx: { abortControllers: AbortControllerMap },
  ownerId: string,
): Promise<{ steered: boolean; superseded: boolean }> {
  const id = (ownerId || '').trim();
  if (!id) return { steered: false, superseded: false };

  return withSoftSteerLock(id, async () => {
    const epoch = bumpSoftSteerEpoch(id);
    // Stop pending/next auto-continue kicks; in-flight AC is aborted below.
    cancelAutoContinues(id);
    const ids = listOwnerRunIds(ctx.abortControllers, id);
    if (ids.length === 0) {
      return {
        steered: false,
        superseded: currentSoftSteerEpoch(id) !== epoch,
      };
    }
    // Hold busy across abort → unregister → replacement register.
    holdOwnerBusy(id);
    try {
      // Abort all owner runs so an in-flight auto_continue cannot race a
      // parallel composer turn (two 「收到」 bubbles). Newest-first for
      // deterministic teardown order.
      for (let i = ids.length - 1; i >= 0; i--) {
        abortOwnerRun(ctx.abortControllers, id, ids[i]!);
      }
      for (const runId of ids) {
        await waitOwnerRunUnregistered(ctx.abortControllers, id, runId);
      }
      if (currentSoftSteerEpoch(id) !== epoch) {
        releaseOwnerBusyHold(id);
        return { steered: true, superseded: true };
      }
      // Keep hold until registerOwnerRun on the replacement turn.
      return { steered: true, superseded: false };
    } catch (err) {
      releaseOwnerBusyHold(id);
      throw err;
    }
  });
}

/** Test helper: busy ids including soft-steer holds (same as production snapshot). */
export function listSoftSteerAwareBusyOwnerIds(map: AbortControllerMap): string[] {
  return listBusyOwnerIds(map);
}
