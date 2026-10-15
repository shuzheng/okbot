/**
 * Soft-steer gate for the 1:1 orchestrator: abort one in-flight run and
 * serialize rapid supplements. Kept free of startBotTurn so Stop / chatControl
 * tests do not load the full agent stack.
 */
import {
  abortOwnerRun,
  listOwnerRunIds,
  waitOwnerRunUnregistered,
  type AbortControllerMap,
} from './ownerRuns';

/** Bumped on Stop so a waiting soft-steer does not start after abort. */
const softSteerEpoch = new Map<string, number>();

/** Serialize soft-steers per owner (rapid supplements). */
const softSteerChains = new Map<string, Promise<void>>();

export function cancelSoftSteers(ownerId: string): void {
  const id = (ownerId || '').trim();
  if (!id) return;
  softSteerEpoch.set(id, (softSteerEpoch.get(id) ?? 0) + 1);
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

/**
 * Soft-steer: abort the newest in-flight run for this owner, wait for cleanup,
 * then let the caller start a fresh turn that includes the new user message.
 */
export async function softSteerNewestRun(
  ctx: { abortControllers: AbortControllerMap },
  ownerId: string,
): Promise<{ steered: boolean; superseded: boolean }> {
  const id = (ownerId || '').trim();
  if (!id) return { steered: false, superseded: false };

  return withSoftSteerLock(id, async () => {
    const epoch = bumpSoftSteerEpoch(id);
    const ids = listOwnerRunIds(ctx.abortControllers, id);
    if (ids.length === 0) {
      return {
        steered: false,
        superseded: currentSoftSteerEpoch(id) !== epoch,
      };
    }
    // Newest = last insertion (user is usually following up the latest task).
    const target = ids[ids.length - 1]!;
    abortOwnerRun(ctx.abortControllers, id, target);
    await waitOwnerRunUnregistered(ctx.abortControllers, id, target);
    if (currentSoftSteerEpoch(id) !== epoch) {
      return { steered: true, superseded: true };
    }
    return { steered: true, superseded: false };
  });
}
