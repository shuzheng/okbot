import assert from 'node:assert/strict';
import type { ChatMessage } from '@okbot/shared';
import {
  formatToolRowDigest,
  nextSummarySlice,
  selectDeltaForSummary,
} from './compression.js';

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

{
  const digest = formatToolRowDigest({
    type: 'function_call',
    name: 'run_shell',
    arguments: JSON.stringify({ command: 'ls -la' }),
  });
  assert.ok(digest);
  assert.match(digest!, /工具调用/);
  assert.match(digest!, /run_shell/);
  assert.match(digest!, /ls -la/);
}

{
  const selected = selectDeltaForSummary(
    [msg('u1', '请列出目录'), msg('a1', '好的')],
    {
      maxIn: 10_000,
      perItem: 200,
      sessionRows: [
        { id: 'u1', item: { type: 'message', role: 'user', content: '请列出目录' } },
        {
          id: 't1',
          item: {
            type: 'function_call',
            name: 'run_shell',
            arguments: '{"command":"ls"}',
          },
        },
        {
          id: 't2',
          item: { type: 'function_call_result', name: 'run_shell', output: 'a.txt\nb.txt' },
        },
        { id: 'a1', item: { type: 'message', role: 'assistant', content: '好的' } },
      ],
    },
  );
  assert.ok(selected.dialogue.includes('工具调用'));
  assert.ok(selected.dialogue.includes('工具结果'));
  // Tool row ids must not pollute consumedIds (message-only coverage).
  assert.deepEqual(selected.consumedIds, ['u1', 'a1']);
  assert.ok(!selected.consumedIds.includes('t1'));
  assert.ok(!selected.consumedIds.includes('t2'));
}

{
  // Truncate while a tool digest would exceed the cap: prior messages stay consumed,
  // rest starts at the next message (tool ids never become coveredThroughId).
  const delta = [msg('u1', '请执行'), msg('a1', '完成'), msg('u2', '下一步')];
  const sessionRows = [
    { id: 'u1', item: { type: 'message', role: 'user', content: '请执行' } },
    {
      id: 't_big',
      item: {
        type: 'function_call',
        name: 'run_shell',
        arguments: JSON.stringify({ command: 'x'.repeat(200) }),
      },
    },
    { id: 'a1', item: { type: 'message', role: 'assistant', content: '完成' } },
    { id: 'u2', item: { type: 'message', role: 'user', content: '下一步' } },
  ];
  const selected = selectDeltaForSummary(delta, {
    maxIn: 80,
    perItem: 40,
    sessionRows,
  });
  assert.deepEqual(selected.consumedIds, ['u1']);
  assert.ok(selected.dialogue.includes('请执行'));
  assert.ok(selected.dialogue.includes('已截断'));
  const slice = nextSummarySlice(delta, { maxIn: 80, perItem: 40, sessionRows });
  assert.equal(slice.kind, 'batch');
  if (slice.kind === 'batch') {
    assert.deepEqual(slice.consumedIds, ['u1']);
    assert.deepEqual(
      slice.rest.map((m) => m.id),
      ['a1', 'u2'],
    );
  }
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

{
  const slice = nextSummarySlice([msg('empty', '   ')], { maxIn: 100, perItem: 10 });
  // Empty bodies are consumed with no dialogue (coverage can still advance).
  assert.equal(slice.kind, 'batch');
  if (slice.kind === 'batch') assert.deepEqual(slice.consumedIds, ['empty']);
}

console.log('compression.select.test.ts: nextSummarySlice ok');
