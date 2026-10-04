import assert from 'node:assert/strict';
import type { ChatMessage } from '@okbot/shared';
import { selectDeltaForSummary } from './compression.js';

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
