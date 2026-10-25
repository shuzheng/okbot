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

/** Turn outcome used when sealing MessageTrace (same union as MessageTraceStatus). */
export type RunTraceStatus = MessageTraceStatus;

type BeginSpanInput = {
  kind: TurnSpanKind;
  name: string;
  parentId?: string;
  inputSummary?: string;
  at?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * In-memory recorder that builds a MessageTrace (spans) for the closing assistant bubble.
 * Does not write any on-disk trajectory file.
 */
export class RunTraceRecorder {
  private messageTrace: MessageTrace;
  /** Open tool spans (LIFO per concurrent executes). */
  private openToolSpanIds: string[] = [];
  /** Open model spans (parallel squad members may overlap). */
  private openModelSpanIds = new Set<string>();
  /** Open approval waits (parallel members may overlap). */
  private openApprovalSpanIds = new Set<string>();
  private openSystemSpanIds = new Map<string, string>();

  constructor(runId: string) {
    const startedAt = nowIso();
    this.messageTrace = {
      turnId: runId,
      startedAt,
      status: 'running',
      spans: [],
    };
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
    this.messageTrace.status = status;
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
}
