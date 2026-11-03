import type { RunCheckpointRecord } from '../../storage/types';

type CheckpointStorage = {
  loadRunCheckpoint(ownerId: string): RunCheckpointRecord | null;
  saveRunCheckpoint(
    ownerId: string,
    data: Omit<RunCheckpointRecord, 'v' | 'ownerId' | 'updatedAt'> & { updatedAt?: string },
  ): void;
};

/**
 * Consume-once clear already dropped disk at cold/Watchdog resume entry. If a
 * transient failure keeps the checkpoint but onRunCheckpoint never rewrote
 * (first segment failed), write the original disk back so Watchdog can
 * silent-resume again. Prefer any newer rewrite already on disk.
 */
export function ensureColdResumeCheckpointKeptForTransient(
  storage: CheckpointStorage,
  ownerId: string,
  disk: RunCheckpointRecord,
): void {
  if (storage.loadRunCheckpoint(ownerId)) return;
  storage.saveRunCheckpoint(ownerId, {
    kind: disk.kind,
    runId: disk.runId,
    messageId: disk.messageId,
    serializedRunState: disk.serializedRunState,
    createdAt: disk.createdAt,
    ...(typeof disk.computerId === 'string' && disk.computerId.trim()
      ? { computerId: disk.computerId.trim() }
      : {}),
    ...(typeof disk.userText === 'string' && disk.userText
      ? { userText: disk.userText }
      : {}),
    ...(disk.autoResumeEligible === false ? { autoResumeEligible: false } : {}),
  });
}
