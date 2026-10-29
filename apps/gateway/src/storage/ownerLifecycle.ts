/**
 * Process-local owner tombstone + per-owner session.jsonl write lock.
 * Domain stores call these on every write / purge path that must not revive a deleted owner.
 */
import { markDirDeleted } from './fs';

export class OwnerLifecycle {
  /** Owners deleted in this process. A finishing run must not recreate their directory. */
  readonly deletedOwners = new Set<string>();

  /** Serialize session.jsonl RMW across parallel turns (promise chain per owner). */
  private sessionWriteChains = new Map<string, Promise<void>>();

  /**
   * Sync depth for {@link withSessionWriteLockSync} and held across
   * {@link withSessionWriteLock} await fn() so sync writers share one critical section.
   */
  private sessionSyncDepth = new Map<string, number>();

  constructor(private readonly resolveOwnerDir: (ownerId: string) => string) {}

  assertOwnerAlive(ownerId: string): void {
    if (this.deletedOwners.has(ownerId)) throw new Error(`owner_deleted:${ownerId}`);
  }

  /** Tombstone: later writes under this owner dir throw `owner_deleted` (see `fs.ts`). */
  markOwnerDeleted(ownerId: string): void {
    this.deletedOwners.add(ownerId);
    markDirDeleted(this.resolveOwnerDir(ownerId));
  }

  isOwnerDeleted(ownerId: string): boolean {
    return this.deletedOwners.has(ownerId);
  }

  private ownerKey(ownerId: string): string {
    return (ownerId || '').trim() || '_';
  }

  private enterSyncDepth(id: string): void {
    this.sessionSyncDepth.set(id, (this.sessionSyncDepth.get(id) ?? 0) + 1);
  }

  private leaveSyncDepth(id: string): void {
    const d = (this.sessionSyncDepth.get(id) ?? 1) - 1;
    if (d <= 0) this.sessionSyncDepth.delete(id);
    else this.sessionSyncDepth.set(id, d);
  }

  /**
   * Sync critical section for session.jsonl writers (append / patch / v2 rewrite).
   * Links into the same promise chain async waiters use.
   *
   * Constraint: `fn` must be synchronous. This does not await queued async
   * {@link withSessionWriteLock} work already in flight beyond the gate handshake;
   * passing an async `fn` (or one that schedules overlapping writes) reopens races.
   * Today all call sites pass sync closures — keep it that way.
   */
  withSessionWriteLockSync<T>(ownerId: string, fn: () => T): T {
    const id = this.ownerKey(ownerId);
    const nested = (this.sessionSyncDepth.get(id) ?? 0) > 0;
    this.enterSyncDepth(id);
    let release: (() => void) | null = null;
    if (!nested) {
      let res!: () => void;
      const gate = new Promise<void>((r) => {
        res = r;
      });
      release = res;
      const prev = this.sessionWriteChains.get(id) ?? Promise.resolve();
      this.sessionWriteChains.set(
        id,
        prev.then(
          () => gate,
          () => gate,
        ),
      );
    }
    try {
      return fn();
    } finally {
      this.leaveSyncDepth(id);
      release?.();
    }
  }

  async withSessionWriteLock<T>(ownerId: string, fn: () => T | Promise<T>): Promise<T> {
    const id = this.ownerKey(ownerId);
    const prev = this.sessionWriteChains.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.sessionWriteChains.set(
      id,
      prev.then(
        () => gate,
        () => gate,
      ),
    );
    await prev.catch(() => undefined);
    this.enterSyncDepth(id);
    try {
      return await fn();
    } finally {
      this.leaveSyncDepth(id);
      release();
    }
  }
}
