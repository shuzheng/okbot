import assert from 'node:assert/strict';
import {
  computeWaterfallBars,
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

assert.equal(normalizeMessageTrace({ turnId: 'x' }), undefined);
assert.equal(normalizeMessageTrace(null), undefined);

console.log('messageTrace.test.mjs: ok');
