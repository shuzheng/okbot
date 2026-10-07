import fs from 'node:fs';
import path from 'node:path';
import {
  createId,
  normalizeMessageTrace,
  redactSensitiveText,
  type MessageTrace,
  type MessageTraceStatus,
  type TurnSpan,
  type TurnSpanKind,
  type TurnSpanStatus,
} from '@okbot/shared';
import { ensureDir, isInDeletedDir, writeText } from './fs';

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

type BeginSpanInput = {
  kind: TurnSpanKind;
  name: string;
  parentId?: string;
  inputSummary?: string;
  at?: string;
};

/**
 * In-memory recorder that:
 * - optionally mirrors events to `last-run-trace.json`
 * - always builds a MessageTrace (spans) for the closing assistant bubble
 */
export class RunTraceRecorder {
  private readonly fileEnabled: boolean;
  private readonly filePath: string;
  private data: RunTraceFile | null = null;
  private messageTrace: MessageTrace;
  /** Open tool spans (LIFO per concurrent executes). */
  private openToolSpanIds: string[] = [];
  /** Open model spans (parallel squad members may overlap). */
  private openModelSpanIds = new Set<string>();
  /** Open approval waits (parallel members may overlap). */
  private openApprovalSpanIds = new Set<string>();
  private openSystemSpanIds = new Map<string, string>();

  constructor(ownerDir: string, fileEnabled: boolean, runId: string) {
    this.filePath = runTracePath(ownerDir);
    const startedAt = nowIso();
    this.messageTrace = {
      turnId: runId,
      startedAt,
      status: 'running',
      spans: [],
    };
    // Owner deleted before the run started: still keep in-memory spans for the live bubble,
    // but never recreate the directory / write the file.
    this.fileEnabled = fileEnabled === true && !isInDeletedDir(ownerDir);
    if (!this.fileEnabled) return;
    ensureDir(ownerDir);
    this.data = {
      runId,
      startedAt,
      status: 'running',
      events: [{ type: 'run_start', at: startedAt, runId }],
    };
    this.flush();
  }

  append(event: RunTraceEventInput): void {
    if (!this.data) return;
    let full = { ...event, at: event.at ?? nowIso() } as RunTraceEvent;
    if (full.type === 'run_error' && typeof full.message === 'string') {
      full = { ...full, message: redactSensitiveText(full.message) };
    }
    if (full.type === 'circuit_break' && typeof full.reason === 'string') {
      full = { ...full, reason: redactSensitiveText(full.reason) };
    }
    this.data.events.push(full);
    this.flush();
  }

  beginSpan(input: BeginSpanInput): string {
    const id = createId('span');
    const startedAt = input.at ?? nowIso();
    const span: TurnSpan = {
      id,
      kind: input.kind,
      name: input.name,
      startedAt,
      status: 'running',
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.inputSummary != null ? { inputSummary: input.inputSummary } : {}),
    };
    this.messageTrace.spans.push(span);
    return id;
  }

  endSpan(
    spanId: string,
    info: {
      status: Exclude<TurnSpanStatus, 'running'>;
      outputSummary?: string;
      error?: string;
      at?: string;
    },
  ): void {
    const span = this.messageTrace.spans.find((s) => s.id === spanId);
    if (!span || span.status !== 'running') return;
    span.endedAt = info.at ?? nowIso();
    span.status = info.status;
    if (info.outputSummary != null) span.outputSummary = info.outputSummary;
    if (info.error != null) span.error = redactSensitiveText(info.error);
  }

  beginModel(at?: string): string {
    // Do not auto-close a previous model span — squad members may run in parallel.
    const id = this.beginSpan({ kind: 'model', name: 'model', at });
    this.openModelSpanIds.add(id);
    return id;
  }

  endModel(
    info: { status?: Exclude<TurnSpanStatus, 'running'>; error?: string; at?: string; spanId?: string } = {},
  ): void {
    let id: string | null = null;
    if (info.spanId && this.openModelSpanIds.has(info.spanId)) {
      id = info.spanId;
    } else if (!info.spanId && this.openModelSpanIds.size) {
      // Fallback: most recently begun (Set insertion order).
      id = [...this.openModelSpanIds].pop() ?? null;
    }
    if (!id) return;
    this.openModelSpanIds.delete(id);
    this.endSpan(id, {
      status: info.status ?? (info.error ? 'error' : 'ok'),
      ...(info.error != null ? { error: info.error } : {}),
      at: info.at,
    });
  }

  beginTool(name: string, argsSummary: string, at?: string): string {
    const parentId = [...this.openModelSpanIds].pop();
    const id = this.beginSpan({
      kind: 'tool',
      name: `tool:${name}`,
      inputSummary: argsSummary,
      parentId,
      at,
    });
    this.openToolSpanIds.push(id);
    this.append({
      type: 'tool_request',
      name,
      argsSummary,
      at,
    });
    return id;
  }

  endTool(
    name: string,
    info: {
      approved: boolean;
      ok?: boolean;
      outputSummary?: string;
      at?: string;
    },
  ): void {
    let spanId: string | undefined;
    for (let i = this.openToolSpanIds.length - 1; i >= 0; i--) {
      const id = this.openToolSpanIds[i]!;
      const span = this.messageTrace.spans.find((s) => s.id === id);
      if (span && span.name === `tool:${name}` && span.status === 'running') {
        spanId = id;
        this.openToolSpanIds.splice(i, 1);
        break;
      }
    }
    // Rejection path may not have called beginTool (recordRejection emits both).
    if (!spanId && info.approved === false) {
      spanId = this.beginSpan({
        kind: 'tool',
        name: `tool:${name}`,
        inputSummary: undefined,
        at: info.at,
      });
    }
    if (spanId) {
      let status: Exclude<TurnSpanStatus, 'running'> = 'ok';
      if (!info.approved) status = 'denied';
      else if (info.ok === false) status = 'error';
      this.endSpan(spanId, {
        status,
        ...(info.outputSummary != null ? { outputSummary: info.outputSummary } : {}),
        at: info.at,
      });
    }
    this.append({
      type: 'tool_result',
      name,
      approved: info.approved,
      ...(info.ok != null ? { ok: info.ok } : {}),
      ...(info.outputSummary != null ? { outputSummary: info.outputSummary } : {}),
      at: info.at,
    });
  }

  beginApproval(toolName: string, at?: string): string {
    // Do not auto-close other open approvals/models — parallel members may overlap.
    const id = this.beginSpan({
      kind: 'wait_approval',
      name: `wait_approval:${toolName}`,
      at,
    });
    this.openApprovalSpanIds.add(id);
    return id;
  }

  endApproval(info: { approved: boolean; at?: string; spanId?: string }): void {
    let id: string | null = null;
    if (info.spanId && this.openApprovalSpanIds.has(info.spanId)) {
      id = info.spanId;
    } else if (!info.spanId && this.openApprovalSpanIds.size) {
      id = [...this.openApprovalSpanIds].pop() ?? null;
    }
    if (!id) return;
    this.openApprovalSpanIds.delete(id);
    this.endSpan(id, {
      status: info.approved ? 'ok' : 'denied',
      outputSummary: info.approved ? 'approved' : 'denied',
      at: info.at,
    });
  }

  beginSystem(name: string, inputSummary?: string, at?: string): string {
    const id = this.beginSpan({
      kind: 'system',
      name,
      ...(inputSummary != null ? { inputSummary } : {}),
      at,
    });
    this.openSystemSpanIds.set(name, id);
    return id;
  }

  endSystem(
    name: string,
    info: { status?: Exclude<TurnSpanStatus, 'running'>; outputSummary?: string; error?: string; at?: string } = {},
  ): void {
    const id = this.openSystemSpanIds.get(name);
    if (!id) return;
    this.openSystemSpanIds.delete(name);
    this.endSpan(id, {
      status: info.status ?? (info.error ? 'error' : 'ok'),
      ...(info.outputSummary != null ? { outputSummary: info.outputSummary } : {}),
      ...(info.error != null ? { error: info.error } : {}),
      at: info.at,
    });
  }

  finish(status: Exclude<RunTraceStatus, 'running'>): void {
    const endedAt = nowIso();
    // Close any still-open spans so the waterfall does not leave dangling "running".
    for (const id of [...this.openModelSpanIds]) {
      this.endModel({
        spanId: id,
        status: status === 'done' ? 'ok' : status === 'aborted' ? 'aborted' : 'error',
        at: endedAt,
      });
    }
    for (const id of [...this.openApprovalSpanIds]) {
      this.endSpan(id, {
        status: status === 'done' ? 'ok' : 'aborted',
        at: endedAt,
      });
      this.openApprovalSpanIds.delete(id);
    }
    for (const id of [...this.openToolSpanIds]) {
      this.endSpan(id, {
        status: status === 'done' ? 'ok' : status === 'aborted' ? 'aborted' : 'error',
        at: endedAt,
      });
    }
    this.openToolSpanIds = [];
    for (const [name, id] of this.openSystemSpanIds) {
      this.endSpan(id, {
        status: status === 'done' ? 'ok' : 'aborted',
        at: endedAt,
      });
      this.openSystemSpanIds.delete(name);
    }
    this.messageTrace.endedAt = endedAt;
    this.messageTrace.status = status as MessageTraceStatus;

    if (!this.data) return;
    this.data.endedAt = endedAt;
    this.data.status = status;
    this.data.events.push({ type: 'run_done', at: endedAt, status });
    this.flush();
  }

  /** Snapshot for attaching onto the assistant ChatMessage (copy). */
  getMessageTrace(): MessageTrace | null {
    const normalized = normalizeMessageTrace(this.messageTrace);
    if (!normalized) return null;
    if (normalized.spans.length === 0 && normalized.status === 'running') return null;
    return {
      ...normalized,
      spans: normalized.spans.map((s) => ({ ...s })),
    };
  }

  private flush(): void {
    if (!this.data) return;
    try {
      // Owner deleted mid-run: stop writing; the directory must not come back.
      if (isInDeletedDir(this.filePath)) return;
      ensureDir(path.dirname(this.filePath));
      writeText(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`);
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
    writeText(file, `${JSON.stringify(next, null, 2)}\n`);
    return true;
  } catch (err) {
    console.error('[okbot] markAbandonedIfRunning failed', err);
    return false;
  }
}
