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

  async withSessionWriteLock<T>(ownerId: string, fn: () => T | Promise<T>): Promise<T> {
    const id = (ownerId || '').trim() || '_';
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
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
