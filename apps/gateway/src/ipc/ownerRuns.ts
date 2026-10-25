import { createId } from '@okbot/shared';

/**
 * Parallel turns per owner (bot/squad): a new send does NOT abort in-flight work.
 * Cap concurrent agent runs; excess wait FIFO. Stop cancels queued waits and
 * aborts every live controller for that owner.
 */

export const DEFAULT_MAX_PARALLEL_RUNS = 3;

export type AbortControllerMap = Map<string, Map<string, AbortController>>;

type Waiter = {
  runId: string;
  resolve: (proceed: boolean) => void;
};

type OwnerQueue = {
  /** Runs that hold a slot (in agent work or transferred to a waiter). */
  active: number;
  waiters: Waiter[];
};

const queues = new Map<string, OwnerQueue>();

/**
 * Soft-steer (and similar) busy holds: keep the owner in {@link listBusyOwnerIds}
 * across abort → unregister → replacement register so UI/gateway never flash idle.
 */
const busyHolds = new Map<string, number>();

/** Hold busy for an owner (refcount). Pair with {@link releaseOwnerBusyHold}. */
export function holdOwnerBusy(ownerId: string): void {
  const id = (ownerId || '').trim();
  if (!id) return;
  busyHolds.set(id, (busyHolds.get(id) ?? 0) + 1);
}

/** Drop one busy hold (no-op at zero). */
export function releaseOwnerBusyHold(ownerId: string): void {
  const id = (ownerId || '').trim();
  if (!id) return;
  const n = busyHolds.get(id) ?? 0;
  if (n <= 1) busyHolds.delete(id);
  else busyHolds.set(id, n - 1);
}

/** Clear all busy holds for an owner (Stop / abort-all). */
export function clearOwnerBusyHolds(ownerId: string): void {
  const id = (ownerId || '').trim();
  if (!id) return;
  busyHolds.delete(id);
}

export function ownerHasBusyHold(ownerId: string): boolean {
  const id = (ownerId || '').trim();
  if (!id) return false;
  return (busyHolds.get(id) ?? 0) > 0;
}

function queueFor(ownerId: string): OwnerQueue {
  let q = queues.get(ownerId);
  if (!q) {
    q = { active: 0, waiters: [] };
    queues.set(ownerId, q);
  }
  return q;
}

export type ParallelGate = {
  runId: string;
  /** False when Stop cancelled this wait before a slot opened. */
  proceed: boolean;
  release: () => void;
};

function makeRelease(ownerId: string, q: OwnerQueue): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = q.waiters.shift();
    if (next) {
      // Transfer the slot — active count unchanged.
      next.resolve(true);
    } else {
      q.active = Math.max(0, q.active - 1);
      if (q.active === 0 && q.waiters.length === 0) {
        queues.delete(ownerId);
      }
    }
  };
}

/**
 * Reserve a parallel run slot (never aborts peers). Waits FIFO when at the cap.
 * Caller registers its AbortController via {@link registerOwnerRun}.
 */
export async function acquireParallelGate(
  ownerId: string,
  opts?: { maxParallel?: number },
): Promise<ParallelGate> {
  const id = (ownerId || '').trim();
  if (!id) {
    return { runId: createId('run'), proceed: false, release: () => undefined };
  }
  const max = Math.max(1, Math.min(8, opts?.maxParallel ?? DEFAULT_MAX_PARALLEL_RUNS));
  const runId = createId('run');
  const q = queueFor(id);

  if (q.active < max) {
    q.active += 1;
    return { runId, proceed: true, release: makeRelease(id, q) };
  }

  const proceed = await new Promise<boolean>((resolve) => {
    q.waiters.push({ runId, resolve });
  });
  if (!proceed) {
    return { runId, proceed: false, release: () => undefined };
  }
  // Slot was transferred from the releaser — do not bump active again.
  return { runId, proceed: true, release: makeRelease(id, q) };
}

/**
 * Cancel every queued (not yet started) wait for this owner.
 * Live runs are untouched unless the caller also aborts controllers.
 */
export function cancelQueuedOwnerRuns(ownerId: string): void {
  const id = (ownerId || '').trim();
  if (!id) return;
  const q = queues.get(id);
  if (!q) return;
  const pending = q.waiters.splice(0, q.waiters.length);
  for (const w of pending) w.resolve(false);
  if (q.active === 0) queues.delete(id);
}

export function registerOwnerRun(
  map: AbortControllerMap,
  ownerId: string,
  runId: string,
  controller: AbortController,
): void {
  const id = (ownerId || '').trim();
  if (!id || !runId) return;
  let inner = map.get(id);
  if (!inner) {
    inner = new Map();
    map.set(id, inner);
  }
  inner.set(runId, controller);
  // Replacement turn after soft-steer: drop the abort→restart busy hold.
  releaseOwnerBusyHold(id);
}

export function unregisterOwnerRun(
  map: AbortControllerMap,
  ownerId: string,
  runId: string,
  controller?: AbortController,
): void {
  const id = (ownerId || '').trim();
  if (!id || !runId) return;
  const inner = map.get(id);
  if (!inner) return;
  const cur = inner.get(runId);
  if (controller && cur && cur !== controller) return;
  inner.delete(runId);
  if (inner.size === 0) map.delete(id);
}

/** Abort every in-flight controller for this owner and drop queued waits. */
export function abortAllOwnerRuns(map: AbortControllerMap, ownerId: string): boolean {
  const id = (ownerId || '').trim();
  if (!id) return false;
  clearOwnerBusyHolds(id);
  const q = queues.get(id);
  const hadQueued = Boolean(q && q.waiters.length > 0);
  cancelQueuedOwnerRuns(id);
  const inner = map.get(id);
  if (!inner || inner.size === 0) {
    map.delete(id);
    return hadQueued;
  }
  for (const ctrl of inner.values()) {
    try {
      ctrl.abort();
    } catch {
      /* ignore */
    }
  }
  map.delete(id);
  return true;
}

export function abortEveryOwnerRun(map: AbortControllerMap): void {
  for (const ownerId of [...map.keys()]) {
    abortAllOwnerRuns(map, ownerId);
  }
}

export function ownerHasRuns(map: AbortControllerMap, ownerId: string): boolean {
  const inner = map.get((ownerId || '').trim());
  return Boolean(inner && inner.size > 0);
}

/** In-flight run ids for an owner (Map insertion order: oldest → newest). */
export function listOwnerRunIds(map: AbortControllerMap, ownerId: string): string[] {
  const inner = map.get((ownerId || '').trim());
  if (!inner || inner.size === 0) return [];
  return [...inner.keys()];
}

/**
 * Abort one in-flight run. Leaves unregister to the run's `finally`
 * so parallel peers and the gate slot stay consistent.
 */
export function abortOwnerRun(
  map: AbortControllerMap,
  ownerId: string,
  runId: string,
): boolean {
  const id = (ownerId || '').trim();
  const rid = (runId || '').trim();
  if (!id || !rid) return false;
  const inner = map.get(id);
  const ctrl = inner?.get(rid);
  if (!ctrl) return false;
  try {
    ctrl.abort();
  } catch {
    /* ignore */
  }
  return true;
}

/** Poll until the run unregisters (or timeout). */
export async function waitOwnerRunUnregistered(
  map: AbortControllerMap,
  ownerId: string,
  runId: string,
  timeoutMs = 30_000,
): Promise<boolean> {
  const id = (ownerId || '').trim();
  const rid = (runId || '').trim();
  if (!id || !rid) return true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const inner = map.get(id);
    if (!inner || !inner.has(rid)) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

export function listBusyOwnerIds(map: AbortControllerMap): string[] {
  const ids = new Set<string>();
  for (const id of map.keys()) {
    if ((map.get(id)?.size ?? 0) > 0) ids.add(id);
  }
  for (const id of busyHolds.keys()) {
    if ((busyHolds.get(id) ?? 0) > 0) ids.add(id);
  }
  return [...ids];
}

/**
 * Cold resume / manual compress: join a per-owner chain without aborting peers.
 * Caller must still refuse if {@link ownerHasRuns} is true when exclusivity is required.
 */
const exclusiveChains = new Map<string, Promise<void>>();

export async function acquireRunSlot(ownerId: string): Promise<{ release: () => void }> {
  const id = (ownerId || '').trim() || '_';
  const prev = exclusiveChains.get(id) ?? Promise.resolve();
  let release!: () => void;
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });
  exclusiveChains.set(
    id,
    prev.then(
      () => slot,
      () => slot,
    ),
  );
  await prev.catch(() => undefined);
  return { release };
}

/**
 * Maintenance / compress lock so overlapping turns do not stomp session summary.
 */
const maintenanceChains = new Map<string, Promise<void>>();

export async function withOwnerMaintenanceLock<T>(
  ownerId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const id = (ownerId || '').trim() || '_';
  const prev = maintenanceChains.get(id) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  maintenanceChains.set(
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

/** Per-owner FIFO for session.jsonl read-modify-write (parallel turns). */
const sessionWriteChains = new Map<string, Promise<void>>();

export async function withOwnerSessionWriteLock<T>(
  ownerId: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const id = (ownerId || '').trim() || '_';
  const prev = sessionWriteChains.get(id) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  sessionWriteChains.set(
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

/** Test helper: reset in-memory queues (not abort maps). */
export function resetOwnerRunQueuesForTests(): void {
  queues.clear();
  busyHolds.clear();
  exclusiveChains.clear();
  maintenanceChains.clear();
  sessionWriteChains.clear();
}
