/** Per-turn waterfall / MessageTrace types. */

export type TurnSpanKind = 'model' | 'tool' | 'wait_approval' | 'system';

/** Outcome of a turn span. */
export type TurnSpanStatus = 'ok' | 'error' | 'denied' | 'aborted' | 'running';

/** Overall turn status for MessageTrace. */
export type MessageTraceStatus =
  | 'running'
  | 'done'
  | 'error'
  | 'aborted'
  | 'circuit_break';

/** One waterfall row for a chat turn. */
export interface TurnSpan {
  id: string;
  /** Optional parent for nested spans (e.g. tool inside a model resume). */
  parentId?: string;
  kind: TurnSpanKind;
  /** Display name: `model`, `tool:run_shell`, `wait_approval:run_shell`, `compress`, … */
  name: string;
  startedAt: string;
  endedAt?: string;
  status: TurnSpanStatus;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
}

/** Per-assistant-message turn timeline (persisted on the message). */
export interface MessageTrace {
  turnId: string;
  startedAt: string;
  endedAt?: string;
  status: MessageTraceStatus;
  spans: TurnSpan[];
}

const TURN_SPAN_KINDS = new Set<TurnSpanKind>(['model', 'tool', 'wait_approval', 'system']);
const TURN_SPAN_STATUSES = new Set<TurnSpanStatus>([
  'ok',
  'error',
  'denied',
  'aborted',
  'running',
]);
const MESSAGE_TRACE_STATUSES = new Set<MessageTraceStatus>([
  'running',
  'done',
  'error',
  'aborted',
  'circuit_break',
]);

function coerceIsoTime(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return undefined;
  return new Date(t).toISOString();
}

/** Wall-clock duration in ms; undefined while still running / missing end. */
export function spanDurationMs(span: Pick<TurnSpan, 'startedAt' | 'endedAt'>): number | undefined {
  const start = Date.parse(span.startedAt);
  if (!Number.isFinite(start)) return undefined;
  if (!span.endedAt) return undefined;
  const end = Date.parse(span.endedAt);
  if (!Number.isFinite(end)) return undefined;
  return Math.max(0, end - start);
}

/** Human-friendly duration for UI (zh/en-agnostic digits + unit suffix from caller). */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) {
    const s = ms / 1000;
    return `${s >= 10 ? s.toFixed(0) : s.toFixed(1)} s`;
  }
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m} m ${s} s` : `${m} m`;
}

/** Compact duration for aggregated timeline totals: `250ms`, `1.5s`, `18m 04s`. */
export function formatCompactDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) {
    const s = ms / 1000;
    return `${s >= 10 ? s.toFixed(0) : s.toFixed(1)}s`;
  }
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Axis tick label: `0s`, `10m`, `35m`, `1m 30s`. */
export function formatAxisTickMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  if (s === 0) return `${m}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

const AXIS_STEP_CANDIDATES_MS = [
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000,
  1_800_000, 3_600_000,
];

export type TimelineTick = {
  offsetMs: number;
  /** 0–100 position on the shared axis. */
  pct: number;
  label: string;
};

/** Nice ticks across a turn window (~4–6 marks including ends). */
export function computeTimelineTicks(windowMs: number): TimelineTick[] {
  const w = Math.max(1, windowMs);
  let step = AXIS_STEP_CANDIDATES_MS[AXIS_STEP_CANDIDATES_MS.length - 1];
  for (const candidate of AXIS_STEP_CANDIDATES_MS) {
    if (w / candidate <= 5) {
      step = candidate;
      break;
    }
  }
  const ticks: TimelineTick[] = [{ offsetMs: 0, pct: 0, label: formatAxisTickMs(0) }];
  for (let t = step; t < w * 0.92; t += step) {
    ticks.push({ offsetMs: t, pct: (t / w) * 100, label: formatAxisTickMs(t) });
  }
  const endLabel = formatAxisTickMs(w);
  if (ticks[ticks.length - 1]?.label !== endLabel) {
    ticks.push({ offsetMs: w, pct: 100, label: endLabel });
  } else {
    ticks[ticks.length - 1] = { offsetMs: w, pct: 100, label: endLabel };
  }
  return ticks;
}

export type KindTimelineKind = 'model' | 'tool';

export type KindTimelineRow = {
  kind: KindTimelineKind;
  /** Sum of per-span durations for this kind (not wall-clock union). */
  totalMs: number;
  segments: WaterfallBar[];
};

export type KindTimeline = {
  windowMs: number;
  ticks: TimelineTick[];
  rows: KindTimelineRow[];
};

/**
 * Subtract `cutters` from `bases` on the wall-clock axis.
 * Used so the 模型 row shows idle gaps while tools / approvals run inside a
 * wrapping model span (runner.run nests auto-allow tools inside one model segment).
 */
function subtractBarIntervals(bases: WaterfallBar[], cutters: WaterfallBar[], windowMs: number): WaterfallBar[] {
  const w = Math.max(1, windowMs);
  const cuts = cutters
    .map((c) => ({ start: c.offsetMs, end: c.offsetMs + c.durationMs }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: WaterfallBar[] = [];
  for (const base of bases) {
    let pieces: Array<{ start: number; end: number }> = [
      { start: base.offsetMs, end: base.offsetMs + base.durationMs },
    ];
    for (const cut of cuts) {
      const next: Array<{ start: number; end: number }> = [];
      for (const p of pieces) {
        if (cut.end <= p.start || cut.start >= p.end) {
          next.push(p);
          continue;
        }
        if (cut.start > p.start) next.push({ start: p.start, end: cut.start });
        if (cut.end < p.end) next.push({ start: cut.end, end: p.end });
      }
      pieces = next;
    }
    for (const p of pieces) {
      const durationMs = Math.max(0, p.end - p.start);
      if (durationMs <= 0) continue;
      const offsetMs = Math.max(0, p.start);
      const leftPct = Math.min(100, Math.max(0, (offsetMs / w) * 100));
      const rawWidth = (durationMs / w) * 100;
      const widthPct = Math.min(100 - leftPct, Math.max(0.5, rawWidth));
      out.push({ span: base.span, offsetMs, durationMs, leftPct, widthPct });
    }
  }
  return out;
}

/**
 * Aggregated 模型 / 工具 header rows: same time axis as waterfall bars.
 * Only `model` and `tool` spans appear as segments; other kinds stay in the list.
 * Omit the 工具 row when tools were not used (totalMs === 0 / no tool spans).
 *
 * Model spans from the recorder wrap `runner.run()` (tools nest inside). For the
 * visual track, carve tool + wait_approval intervals out of model so idle gaps
 * show; totals remain the sum of raw per-span durations.
 */
export function computeKindTimeline(trace: MessageTrace): KindTimeline {
  const bars = computeWaterfallBars(trace);
  let windowMs = 1;
  for (const bar of bars) {
    windowMs = Math.max(windowMs, bar.offsetMs + bar.durationMs);
  }
  if (trace.endedAt) {
    const a = Date.parse(trace.startedAt);
    const b = Date.parse(trace.endedAt);
    if (Number.isFinite(a) && Number.isFinite(b)) windowMs = Math.max(windowMs, b - a);
  }
  const modelBars = bars.filter((b) => b.span.kind === 'model');
  const toolBars = bars.filter((b) => b.span.kind === 'tool');
  const cutters = bars.filter((b) => b.span.kind === 'tool' || b.span.kind === 'wait_approval');
  let modelTotal = 0;
  for (const seg of modelBars) modelTotal += seg.durationMs;
  let toolTotal = 0;
  for (const seg of toolBars) toolTotal += seg.durationMs;
  const rows: KindTimelineRow[] = [
    {
      kind: 'model',
      totalMs: modelTotal,
      segments: subtractBarIntervals(modelBars, cutters, windowMs),
    },
  ];
  // Hide empty 工具 aggregate when no tools ran (0ms / empty bar).
  if (toolTotal > 0) {
    rows.push({
      kind: 'tool',
      totalMs: toolTotal,
      segments: toolBars,
    });
  }
  return { windowMs, ticks: computeTimelineTicks(windowMs), rows };
}

export type WaterfallBar = {
  span: TurnSpan;
  offsetMs: number;
  durationMs: number;
  /** 0–100 left offset within the turn window. */
  leftPct: number;
  /** 0–100 width within the turn window (min ~0.5 so short spans stay visible). */
  widthPct: number;
};

/**
 * Layout spans as Gantt bars relative to turn start.
 * Ordering: startedAt ascending, then original index (stable).
 */
export function computeWaterfallBars(trace: MessageTrace): WaterfallBar[] {
  const turnStart = Date.parse(trace.startedAt);
  if (!Number.isFinite(turnStart)) return [];
  let turnEnd = turnStart;
  const ended = trace.endedAt ? Date.parse(trace.endedAt) : NaN;
  if (Number.isFinite(ended)) turnEnd = Math.max(turnEnd, ended);
  const indexed = trace.spans.map((span, index) => ({ span, index }));
  indexed.sort((a, b) => {
    const as = Date.parse(a.span.startedAt);
    const bs = Date.parse(b.span.startedAt);
    const aOk = Number.isFinite(as);
    const bOk = Number.isFinite(bs);
    if (aOk && bOk && as !== bs) return as - bs;
    if (aOk !== bOk) return aOk ? -1 : 1;
    return a.index - b.index;
  });
  for (const { span } of indexed) {
    const s = Date.parse(span.startedAt);
    if (Number.isFinite(s)) turnEnd = Math.max(turnEnd, s);
    const e = span.endedAt ? Date.parse(span.endedAt) : NaN;
    if (Number.isFinite(e)) turnEnd = Math.max(turnEnd, e);
  }
  const windowMs = Math.max(1, turnEnd - turnStart);
  return indexed.map(({ span }) => {
    const s = Date.parse(span.startedAt);
    const startMs = Number.isFinite(s) ? s : turnStart;
    const dur = spanDurationMs(span);
    const durationMs = dur != null ? dur : Math.max(0, turnEnd - startMs);
    const offsetMs = Math.max(0, startMs - turnStart);
    const leftPct = Math.min(100, Math.max(0, (offsetMs / windowMs) * 100));
    const rawWidth = (durationMs / windowMs) * 100;
    const widthPct = Math.min(100 - leftPct, Math.max(0.5, rawWidth));
    return { span, offsetMs, durationMs, leftPct, widthPct };
  });
}

export function normalizeTurnSpan(raw: unknown): TurnSpan | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const id = typeof src.id === 'string' && src.id.trim() ? src.id.trim() : '';
  const name = typeof src.name === 'string' && src.name.trim() ? src.name.trim() : '';
  const kind = TURN_SPAN_KINDS.has(src.kind as TurnSpanKind) ? (src.kind as TurnSpanKind) : null;
  const status = TURN_SPAN_STATUSES.has(src.status as TurnSpanStatus)
    ? (src.status as TurnSpanStatus)
    : null;
  const startedAt = coerceIsoTime(src.startedAt);
  if (!id || !name || !kind || !status || !startedAt) return undefined;
  const out: TurnSpan = { id, kind, name, startedAt, status };
  if (typeof src.parentId === 'string' && src.parentId.trim()) out.parentId = src.parentId.trim();
  const endedAt = coerceIsoTime(src.endedAt);
  if (endedAt) out.endedAt = endedAt;
  if (typeof src.inputSummary === 'string') out.inputSummary = src.inputSummary;
  if (typeof src.outputSummary === 'string') out.outputSummary = src.outputSummary;
  if (typeof src.error === 'string') out.error = src.error;
  return out;
}

export function normalizeMessageTrace(raw: unknown): MessageTrace | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const turnId = typeof src.turnId === 'string' && src.turnId.trim() ? src.turnId.trim() : '';
  const startedAt = coerceIsoTime(src.startedAt);
  if (!turnId || !startedAt) return undefined;
  const status = MESSAGE_TRACE_STATUSES.has(src.status as MessageTraceStatus)
    ? (src.status as MessageTraceStatus)
    : 'done';
  const spans: TurnSpan[] = [];
  if (Array.isArray(src.spans)) {
    for (const item of src.spans) {
      const span = normalizeTurnSpan(item);
      if (span) spans.push(span);
    }
  }
  const out: MessageTrace = { turnId, startedAt, status, spans };
  const endedAt = coerceIsoTime(src.endedAt);
  if (endedAt) out.endedAt = endedAt;
  return out;
}
