import type { IpcContext } from './context';

/**
 * Mid-run steering (abort + restart): one in-flight agent run per ownerId.
 * Newer chatStart bumps generation, aborts the current run, waits for the
 * previous handler slot to finish, then proceeds only if still the latest.
 * Stop (chatAbort) also bumps generation so a waiting steer is superseded.
 */

const steerGenerations = new Map<string, number>();
const runChains = new Map<string, Promise<void>>();

export function bumpSteerGeneration(ownerId: string): number {
  const next = (steerGenerations.get(ownerId) ?? 0) + 1;
  steerGenerations.set(ownerId, next);
  return next;
}

export function currentSteerGeneration(ownerId: string): number {
  return steerGenerations.get(ownerId) ?? 0;
}

export type SteerGate = {
  generation: number;
  /** False when a newer send/stop superseded this attempt while waiting. */
  proceed: boolean;
  release: () => void;
};

/**
 * Abort any live run + HITL for ownerId, join the per-owner chain, then
 * report whether this generation should still start a new run.
 */
export async function acquireSteerGate(
  ctx: IpcContext,
  ownerId: string,
): Promise<SteerGate> {
  const generation = bumpSteerGeneration(ownerId);

  const existing = ctx.abortControllers.get(ownerId);
  if (existing) {
    existing.abort();
    // Resolves live HITL waiters; also clears disk pending for this owner.
    ctx.rejectPendingApprovalsForBot(ownerId, '已取消');
  } else {
    try {
      ctx.storage.clearPendingHitl(ownerId);
    } catch (err) {
      console.error('[okbot] clear pending hitl on steer failed', err);
    }
  }

  const prev = runChains.get(ownerId) ?? Promise.resolve();
  let release!: () => void;
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });
  runChains.set(
    ownerId,
    prev.then(
      () => slot,
      () => slot,
    ),
  );

  await prev.catch(() => undefined);

  return {
    generation,
    proceed: currentSteerGeneration(ownerId) === generation,
    release,
  };
}

/**
 * Join the per-owner chain without aborting (HITL cold resume).
 * Caller must still refuse if abortControllers already has ownerId.
 */
export async function acquireRunSlot(ownerId: string): Promise<{ release: () => void }> {
  const prev = runChains.get(ownerId) ?? Promise.resolve();
  let release!: () => void;
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });
  runChains.set(
    ownerId,
    prev.then(
      () => slot,
      () => slot,
    ),
  );
  await prev.catch(() => undefined);
  return { release };
}
