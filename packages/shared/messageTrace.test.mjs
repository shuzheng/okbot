import assert from 'node:assert/strict';
import {
  computeKindTimeline,
  computeWaterfallBars,
  formatAxisTickMs,
  formatCompactDurationMs,
  formatDurationMs,
  normalizeMessageTrace,
  spanDurationMs,
} from './dist/index.js';

const base = '2026-10-07T01:00:00.000Z';
const trace = normalizeMessageTrace({
  turnId: 'run_1',
  startedAt: base,
  endedAt: '2026-10-07T01:00:05.000Z',
  status: 'done',
  spans: [
    {
      id: 's2',
      kind: 'tool',
      name: 'tool:run_shell',
      startedAt: '2026-10-07T01:00:02.000Z',
      endedAt: '2026-10-07T01:00:03.500Z',
      status: 'ok',
      inputSummary: '{"cmd":"ls"}',
      outputSummary: 'ok',
    },
    {
      id: 's1',
      kind: 'model',
      name: 'model',
      startedAt: '2026-10-07T01:00:00.000Z',
      endedAt: '2026-10-07T01:00:02.000Z',
      status: 'ok',
    },
    {
      id: 's3',
      kind: 'wait_approval',
      name: 'wait_approval:run_shell',
      startedAt: '2026-10-07T01:00:01.500Z',
      endedAt: '2026-10-07T01:00:02.000Z',
      status: 'ok',
    },
  ],
});
assert.ok(trace);
assert.equal(spanDurationMs(trace.spans[0]), 1500);
assert.equal(formatDurationMs(1500), '1.5 s');
assert.equal(formatDurationMs(250), '250 ms');

const bars = computeWaterfallBars(trace);
assert.equal(bars.length, 3);
// Ordered by startedAt: model, approval, tool
assert.deepEqual(
  bars.map((b) => b.span.id),
  ['s1', 's3', 's2'],
);
assert.equal(bars[0].offsetMs, 0);
assert.equal(bars[0].durationMs, 2000);
assert.equal(bars[1].offsetMs, 1500);
assert.equal(bars[2].offsetMs, 2000);
assert.ok(bars[0].widthPct > bars[1].widthPct);
assert.ok(bars[0].leftPct === 0);
assert.ok(bars[2].leftPct > bars[1].leftPct);


assert.equal(formatCompactDurationMs(1500), '1.5s');
assert.equal(formatCompactDurationMs(250), '250ms');
assert.equal(formatCompactDurationMs(18 * 60_000 + 4_000), '18m 04s');
assert.equal(formatAxisTickMs(0), '0s');
assert.equal(formatAxisTickMs(600_000), '10m');

const kindTl = computeKindTimeline(trace);
assert.equal(kindTl.rows.length, 2);
assert.equal(kindTl.rows[0].kind, 'model');
assert.equal(kindTl.rows[1].kind, 'tool');
assert.equal(kindTl.rows[0].segments.length, 1);
assert.equal(kindTl.rows[1].segments.length, 1);
assert.equal(kindTl.rows[0].totalMs, 2000);
assert.equal(kindTl.rows[1].totalMs, 1500);
// wait_approval [1.5s,2s) carves the tail of model [0,2s)
assert.equal(kindTl.rows[0].segments[0].offsetMs, 0);
assert.equal(kindTl.rows[0].segments[0].durationMs, 1500);
assert.ok(kindTl.ticks.length >= 2);
assert.equal(kindTl.ticks[0].pct, 0);
assert.equal(kindTl.ticks[kindTl.ticks.length - 1].pct, 100);

assert.equal(normalizeMessageTrace({ turnId: 'x' }), undefined);
assert.equal(normalizeMessageTrace(null), undefined);


// Discrete model → tool → model: model row must keep two segments with a gap.
const interleaved = normalizeMessageTrace({
  turnId: 'run_interleaved',
  startedAt: base,
  endedAt: '2026-10-07T01:00:10.000Z',
  status: 'done',
  spans: [
    {
      id: 'm1',
      kind: 'model',
      name: 'model',
      startedAt: '2026-10-07T01:00:00.000Z',
      endedAt: '2026-10-07T01:00:02.000Z',
      status: 'ok',
    },
    {
      id: 't1',
      kind: 'tool',
      name: 'tool:run_shell',
      startedAt: '2026-10-07T01:00:02.000Z',
      endedAt: '2026-10-07T01:00:05.000Z',
      status: 'ok',
    },
    {
      id: 'm2',
      kind: 'model',
      name: 'model',
      startedAt: '2026-10-07T01:00:05.000Z',
      endedAt: '2026-10-07T01:00:08.000Z',
      status: 'ok',
    },
  ],
});
assert.ok(interleaved);
const interleavedTl = computeKindTimeline(interleaved);
assert.equal(interleavedTl.rows[0].kind, 'model');
assert.equal(interleavedTl.rows[0].segments.length, 2);
assert.equal(interleavedTl.rows[0].totalMs, 5000);
assert.equal(interleavedTl.rows[0].segments[0].offsetMs, 0);
assert.equal(interleavedTl.rows[0].segments[0].durationMs, 2000);
assert.equal(interleavedTl.rows[0].segments[1].offsetMs, 5000);
assert.equal(interleavedTl.rows[0].segments[1].durationMs, 3000);
assert.ok(
  interleavedTl.rows[0].segments[0].offsetMs + interleavedTl.rows[0].segments[0].durationMs <
    interleavedTl.rows[0].segments[1].offsetMs,
  'model segments must leave a gap while the tool runs',
);
assert.equal(interleavedTl.rows[1].segments.length, 1);
assert.equal(interleavedTl.rows[1].segments[0].offsetMs, 2000);
assert.equal(interleavedTl.rows[1].totalMs, 3000);

// Wrapping model span with nested tools: carve gaps so the model track is not a solid blob.
const wrapped = normalizeMessageTrace({
  turnId: 'run_wrapped',
  startedAt: base,
  endedAt: '2026-10-07T01:00:10.000Z',
  status: 'done',
  spans: [
    {
      id: 'mw',
      kind: 'model',
      name: 'model',
      startedAt: '2026-10-07T01:00:00.000Z',
      endedAt: '2026-10-07T01:00:10.000Z',
      status: 'ok',
    },
    {
      id: 'tw1',
      kind: 'tool',
      name: 'tool:run_shell',
      startedAt: '2026-10-07T01:00:02.000Z',
      endedAt: '2026-10-07T01:00:04.000Z',
      status: 'ok',
    },
    {
      id: 'tw2',
      kind: 'tool',
      name: 'tool:read_file',
      startedAt: '2026-10-07T01:00:06.000Z',
      endedAt: '2026-10-07T01:00:07.000Z',
      status: 'ok',
    },
  ],
});
assert.ok(wrapped);
const wrappedTl = computeKindTimeline(wrapped);
assert.equal(wrappedTl.rows[0].totalMs, 10_000, 'totals stay raw model duration');
assert.equal(wrappedTl.rows[0].segments.length, 3);
assert.deepEqual(
  wrappedTl.rows[0].segments.map((s) => [s.offsetMs, s.durationMs]),
  [
    [0, 2000],
    [4000, 2000],
    [7000, 3000],
  ],
);
assert.equal(wrappedTl.rows[1].segments.length, 2);
assert.equal(wrappedTl.rows[1].totalMs, 3000);



// No tools used: omit the empty 工具 aggregate row (0ms).
const noTools = normalizeMessageTrace({
  turnId: 'run_no_tools',
  startedAt: base,
  endedAt: '2026-10-07T01:00:04.600Z',
  status: 'done',
  spans: [
    {
      id: 'sys1',
      kind: 'system',
      name: 'compress',
      startedAt: '2026-10-07T01:00:00.000Z',
      endedAt: '2026-10-07T01:00:00.014Z',
      status: 'ok',
    },
    {
      id: 'm_only',
      kind: 'model',
      name: 'model',
      startedAt: '2026-10-07T01:00:00.014Z',
      endedAt: '2026-10-07T01:00:04.600Z',
      status: 'ok',
    },
  ],
});
assert.ok(noTools);
const noToolsTl = computeKindTimeline(noTools);
assert.equal(noToolsTl.rows.length, 1);
assert.equal(noToolsTl.rows[0].kind, 'model');
assert.ok(noToolsTl.rows[0].totalMs > 0);
assert.equal(
  noToolsTl.rows.find((r) => r.kind === 'tool'),
  undefined,
  'empty 工具 row must not appear when tools were not used',
);


console.log('messageTrace.test.mjs: ok');
