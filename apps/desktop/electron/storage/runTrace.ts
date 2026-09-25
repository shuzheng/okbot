import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from './fs';

export type RunTraceStatus =
  | 'running'
  | 'done'
  | 'error'
  | 'aborted'
  | 'circuit_break';

export type RunTraceEvent =
  | { type: 'run_start'; at: string; runId: string }
  | { type: 'tool_request'; at: string; name: string; argsSummary: string }
  | {
      type: 'tool_result';
      at: string;
      name: string;
      approved: boolean;
      ok?: boolean;
      outputSummary?: string;
    }
  | { type: 'circuit_break'; at: string; reason: string }
  | { type: 'run_error'; at: string; message: string }
  | { type: 'run_done'; at: string; status: RunTraceStatus };

export type RunTraceFile = {
  runId: string;
  startedAt: string;
  endedAt?: string;
  status: RunTraceStatus;
  events: RunTraceEvent[];
};

/** Append input: same as RunTraceEvent but `at` optional (filled on write). */
export type RunTraceEventInput = RunTraceEvent extends infer E
  ? E extends { at: string }
    ? Omit<E, 'at'> & { at?: string }
    : E
  : never;

const TRACE_FILE = 'last-run-trace.json';

export function runTracePath(ownerDir: string): string {
  return path.join(ownerDir, TRACE_FILE);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** In-memory recorder that mirrors to `last-run-trace.json` under the owner dir. */
export class RunTraceRecorder {
  private readonly enabled: boolean;
  private readonly filePath: string;
  private data: RunTraceFile | null = null;

  constructor(ownerDir: string, enabled: boolean, runId: string) {
    this.enabled = enabled;
    this.filePath = runTracePath(ownerDir);
    if (!enabled) return;
    ensureDir(ownerDir);
    const startedAt = nowIso();
    this.data = {
      runId,
      startedAt,
      status: 'running',
      events: [{ type: 'run_start', at: startedAt, runId }],
    };
    this.flush();
  }

  append(event: RunTraceEventInput): void {
    if (!this.enabled || !this.data) return;
    const full = { ...event, at: event.at ?? nowIso() } as RunTraceEvent;
    this.data.events.push(full);
    this.flush();
  }

  finish(status: Exclude<RunTraceStatus, 'running'>): void {
    if (!this.enabled || !this.data) return;
    const endedAt = nowIso();
    this.data.endedAt = endedAt;
    this.data.status = status;
    this.data.events.push({ type: 'run_done', at: endedAt, status });
    this.flush();
  }

  private flush(): void {
    if (!this.data) return;
    try {
      ensureDir(path.dirname(this.filePath));
      fs.writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    } catch (err) {
      console.error('[okbot] write run trace failed', err);
    }
  }
}

export function readLastRunTrace(ownerDir: string): RunTraceFile | null {
  const file = runTracePath(ownerDir);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const src = raw as Record<string, unknown>;
    const runId = typeof src.runId === 'string' ? src.runId : '';
    const startedAt = typeof src.startedAt === 'string' ? src.startedAt : '';
    if (!runId || !startedAt) return null;
    const events = Array.isArray(src.events) ? (src.events as RunTraceEvent[]) : [];
    const status =
      src.status === 'done' ||
      src.status === 'error' ||
      src.status === 'aborted' ||
      src.status === 'circuit_break' ||
      src.status === 'running'
        ? src.status
        : 'done';
    const out: RunTraceFile = { runId, startedAt, status, events };
    if (typeof src.endedAt === 'string') out.endedAt = src.endedAt;
    return out;
  } catch (err) {
    console.error('[okbot] read run trace failed', err);
    return null;
  }
}

/** If last-run-trace.json is still `running` after a crash/restart, mark it abandoned. */
export function markAbandonedIfRunning(ownerDir: string): boolean {
  const file = runTracePath(ownerDir);
  try {
    if (!fs.existsSync(file)) return false;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return false;
    const src = raw as Record<string, unknown>;
    if (src.status !== 'running') return false;
    const endedAt = nowIso();
    const events = Array.isArray(src.events) ? [...(src.events as RunTraceEvent[])] : [];
    events.push({ type: 'run_done', at: endedAt, status: 'aborted' });
    const next: RunTraceFile = {
      runId: typeof src.runId === 'string' ? src.runId : 'unknown',
      startedAt: typeof src.startedAt === 'string' ? src.startedAt : endedAt,
      endedAt,
      status: 'aborted',
      events,
    };
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return true;
  } catch (err) {
    console.error('[okbot] markAbandonedIfRunning failed', err);
    return false;
  }
}
