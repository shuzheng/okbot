/** Durable multi-task queue (per-bot `tasks.jsonl`). */

/** Task-level status (4). `backlog` only via explicit set — never derived. */
export type TaskStatus = 'backlog' | 'pending' | 'in_progress' | 'done';

/**
 * Step-level status (6). No backlog.
 * In-progress phase: pending | in_progress | blocked
 * Terminal: succeeded | failed | cancelled
 */
export type StepStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type TaskStep = {
  id: string;
  title: string;
  status: StepStatus;
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
  'backlog',
  'pending',
  'in_progress',
  'done',
] as const;

export const STEP_STATUSES: readonly StepStatus[] = [
  'pending',
  'in_progress',
  'blocked',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export function isTaskStatus(raw: unknown): raw is TaskStatus {
  return typeof raw === 'string' && (TASK_STATUSES as readonly string[]).includes(raw);
}

export function isStepStatus(raw: unknown): raw is StepStatus {
  return typeof raw === 'string' && (STEP_STATUSES as readonly string[]).includes(raw);
}

/**
 * Migrate legacy task status from disk/tool input.
 * Old task `cancelled` / `failed` → `done`.
 */
export function coerceTaskStatus(raw: unknown): TaskStatus | undefined {
  if (raw === 'cancelled' || raw === 'failed') return 'done';
  if (isTaskStatus(raw)) return raw;
  return undefined;
}

/**
 * Migrate legacy step status from disk/tool input.
 * Old step `done` → `succeeded`. Unknown / backlog → undefined (caller defaults).
 */
export function coerceStepStatus(raw: unknown): StepStatus | undefined {
  if (raw === 'done') return 'succeeded';
  if (isStepStatus(raw)) return raw;
  return undefined;
}

/** Chat 「进行中的任务」: only actively running tasks. */
export function isOpenTaskStatus(status: TaskStatus): boolean {
  return status === 'in_progress';
}

/** Non-terminal task (pool / ready / running). */
export function isNonTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'backlog' || status === 'pending' || status === 'in_progress';
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'done';
}

/** In-progress phase steps (not yet terminal). */
export function isActiveStepStatus(status: StepStatus): boolean {
  return status === 'pending' || status === 'in_progress' || status === 'blocked';
}

export function isTerminalStepStatus(status: StepStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
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

