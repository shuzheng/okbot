import assert from 'node:assert/strict';
import type { ChatMessage } from '@okbot/shared';
import { nextSummarySlice, selectDeltaForSummary } from './compression.js';

function msg(id: string, content: string, role: 'user' | 'assistant' = 'user'): ChatMessage {
  return { id, role, content, createdAt: '2026-01-01T00:00:00.000Z' };
}

{
  const selected = selectDeltaForSummary(
    [msg('a', 'x'.repeat(100)), msg('b', 'y'.repeat(100)), msg('c', 'z'.repeat(100))],
    { maxIn: 150, perItem: 80 },
  );
  assert.deepEqual(selected.consumedIds, ['a']);
  assert.ok(selected.dialogue.includes('x'.repeat(80)));
  assert.ok(!selected.dialogue.includes('y'.repeat(20)));
  assert.ok(selected.dialogue.includes('已截断'));
}

{
  const selected = selectDeltaForSummary(
    [msg('e', '   '), msg('a', 'hello'), msg('b', 'world')],
    { maxIn: 10_000, perItem: 100 },
  );
  assert.deepEqual(selected.consumedIds, ['e', 'a', 'b']);
  assert.ok(selected.dialogue.includes('hello'));
  assert.ok(selected.dialogue.includes('world'));
}

{
  const huge = msg('big', 'q'.repeat(500));
  const selected = selectDeltaForSummary([huge], { maxIn: 20, perItem: 400 });
  assert.deepEqual(selected.consumedIds, []);
  assert.equal(selected.dialogue, '');
}

{
  const selected = selectDeltaForSummary([msg('long', 'q'.repeat(50))], { maxIn: 400, perItem: 20 });
  assert.deepEqual(selected.consumedIds, ['long']);
  assert.equal(selected.dialogue.replace(/[^q]/g, '').length, 50);
}

{
  const selected = selectDeltaForSummary([msg('long', 'q'.repeat(80))], { maxIn: 30, perItem: 20 });
  assert.deepEqual(selected.consumedIds, []);
  assert.equal(selected.dialogue, '');
}

console.log('compression.select.test.ts: ok');

{
  let rest = [msg('big', 'q'.repeat(100))];
  let sawPartial = false;
  let consumed = false;
  for (let i = 0; i < 20; i++) {
    const slice = nextSummarySlice(rest, { maxIn: 36, perItem: 10 });
    if (slice.kind === 'partial') {
      sawPartial = true;
      assert.equal(slice.messageId, 'big');
      assert.ok(slice.dialogue.length <= 36);
      assert.ok(slice.rest[0]?.content.length < rest[0]!.content.length);
      rest = slice.rest;
      continue;
    }
    assert.equal(slice.kind, 'batch');
    if (slice.kind === 'batch') {
      assert.deepEqual(slice.consumedIds, ['big']);
      assert.equal(slice.rest.length, 0);
      consumed = true;
    }
    break;
  }
  assert.equal(sawPartial, true);
  assert.equal(consumed, true);
}

{
  const slice = nextSummarySlice([msg('a', 'hello'), msg('b', 'world')], { maxIn: 10_000, perItem: 100 });
  assert.equal(slice.kind, 'batch');
  if (slice.kind === 'batch') assert.deepEqual(slice.consumedIds, ['a', 'b']);
}

console.log('compression.select.test.ts: ok');

{
  const slice = nextSummarySlice([msg('big', 'q'.repeat(80))], { maxIn: 36, perItem: 0 });
  assert.notEqual(slice.kind, 'stuck');
  const selected = selectDeltaForSummary([msg('a', 'hello')], { maxIn: 100, perItem: -5 });
  assert.deepEqual(selected.consumedIds, ['a']);
}

console.log('compression.select.test.ts: perItem guard ok');

