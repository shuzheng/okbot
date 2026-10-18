/** Durable multi-task queue (per-bot `tasks.jsonl`). */

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled' | 'failed';

export type TaskStep = {
  id: string;
  title: string;
  status: TaskStatus;
  note?: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt?: string;
};

/** One JSONL line = one task (DB-row style; update rewrites that line by id). */
export type TaskRecord = {
  v: 1;
  id: string;
  title?: string;
  status: TaskStatus;
  note?: string;
  steps: TaskStep[];
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
};

export const TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'in_progress',
  'done',
  'cancelled',
  'failed',
] as const;

export function isTaskStatus(raw: unknown): raw is TaskStatus {
  return typeof raw === 'string' && (TASK_STATUSES as readonly string[]).includes(raw);
}

/** Open = still in the UI queue (hidden once terminal). */
export function isOpenTaskStatus(status: TaskStatus): boolean {
  return status === 'pending' || status === 'in_progress';
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'done' || status === 'cancelled' || status === 'failed';
}

/** Crockford Base32 (ULID alphabet; no I, L, O, U). */
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Strict ULID: 26 Crockford base32 chars (time-sortable). */
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** True when `raw` is a 26-char Crockford ULID. */
export function isUlid(raw: unknown): raw is string {
  return typeof raw === 'string' && ULID_RE.test(raw);
}

/**
 * Generate a ULID (Crockford base32, sortable by time).
 * Used for new `tasks.jsonl` task (and auto step) ids — no extra dependency.
 */
export function createUlid(nowMs: number = Date.now()): string {
  let time = Math.max(0, Math.floor(Number.isFinite(nowMs) ? nowMs : Date.now()));
  let out = '';
  for (let i = 0; i < 10; i++) {
    out = ULID_ALPHABET[time % 32]! + out;
    time = Math.floor(time / 32);
  }
  const rand = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(rand);
  } else {
    for (let i = 0; i < 16; i++) rand[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < 16; i++) {
    out += ULID_ALPHABET[rand[i]! & 31]!;
  }
  return out;
}


/** One file under `~/.okbot/<ownerId>/resources/` (edit 资源 tab). */
export type OwnerResourceInfo = {
  name: string;
  /** Absolute path on disk. */
  path: string;
  /** Bytes. */
  size: number;
  /** ISO mtime (sort newest→oldest). */
  createdAt: string;
  /** MIME guess from extension (image/* for preview). */
  mime: string;
  /** `<ownerId>/resources/<name>` for readGeneratedAssetDataUrl / media gateway. */
  assetRel: string;
};
