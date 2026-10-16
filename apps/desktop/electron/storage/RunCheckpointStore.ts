import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, writeJson } from './fs';
import type { OwnerLifecycle } from './ownerLifecycle';
import type { BotRosterEntry, Squad } from '@okbot/shared';
import type { RunCheckpointRecord } from './types';

export type RunCheckpointStoreDeps = {
  botDir(botId: string): string;
  ensureBotLayout(botId: string): void;
  listRoster(): BotRosterEntry[];
  listSquads(): Squad[];
};

export function isRunCheckpointRecord(raw: unknown): raw is RunCheckpointRecord {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.ownerId === 'string' &&
    (o.kind === 'bot' || o.kind === 'squad') &&
    typeof o.runId === 'string' &&
    typeof o.messageId === 'string' &&
    typeof o.serializedRunState === 'string' &&
    o.serializedRunState.length > 0 &&
    typeof o.createdAt === 'string' &&
    typeof o.updatedAt === 'string'
  );
}

/**
 * One latest mid-run RunState per owner at `~/.okbot/<owner>/run-checkpoint.json`.
 * Cleared on successful turn completion, Stop, soft-steer abort, and intentional force-quit.
 * Left on disk only for crash recovery.
 */
export class RunCheckpointStore {
  constructor(
    private readonly life: OwnerLifecycle,
    private readonly deps: RunCheckpointStoreDeps,
  ) {}

  private file(ownerId: string): string {
    return path.join(this.deps.botDir(ownerId), 'run-checkpoint.json');
  }

  load(ownerId: string): RunCheckpointRecord | null {
    const file = this.file(ownerId);
    if (!fs.existsSync(file)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      return isRunCheckpointRecord(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  save(ownerId: string, data: Omit<RunCheckpointRecord, 'v' | 'ownerId' | 'updatedAt'> & { updatedAt?: string }): void {
    this.deps.ensureBotLayout(ownerId);
    this.life.assertOwnerAlive(ownerId);
    const now = new Date().toISOString();
    const record: RunCheckpointRecord = {
      v: 1,
      ownerId,
      kind: data.kind,
      runId: data.runId,
      messageId: data.messageId,
      serializedRunState: data.serializedRunState,
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
      ...(typeof data.computerId === 'string' && data.computerId.trim()
        ? { computerId: data.computerId.trim() }
        : {}),
      ...(typeof data.userText === 'string' && data.userText
        ? { userText: data.userText }
        : {}),
    };
    if (!record.serializedRunState) return;
    ensureDir(path.dirname(this.file(ownerId)));
    writeJson(this.file(ownerId), record);
  }

  clear(ownerId: string): void {
    const file = this.file(ownerId);
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }

  listAll(): RunCheckpointRecord[] {
    const out: RunCheckpointRecord[] = [];
    for (const owner of [...this.deps.listRoster(), ...this.deps.listSquads()]) {
      const rec = this.load(owner.id);
      if (rec) out.push(rec);
    }
    return out;
  }
}
