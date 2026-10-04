import assert from 'node:assert/strict';
import {
  estimatePackedSessionTokens,
  omitOldestToolResultsUntilFit,
  rowsForPriorBudget,
  sessionItemBudgetText,
} from './contextBudget.js';

{
  const text = sessionItemBudgetText({
    type: 'function_call',
    name: 'run_shell',
    arguments: 'a'.repeat(80),
  });
  assert.ok(text.includes('a'.repeat(80)));
  const result = sessionItemBudgetText({
    type: 'function_call_output',
    name: 'run_shell',
    output: 'b'.repeat(120),
    content: 'should-not-double',
  });
  assert.ok(result.includes('b'.repeat(120)));
  assert.ok(!result.includes('should-not-double'));
}

{
  const rows = [
    { id: 't-old', item: { type: 'function_call_output', output: 'z'.repeat(400) } },
    { id: 'm1', item: { type: 'message', role: 'user', content: 'hi' } },
    { id: 't-new', item: { type: 'tool_result', output: 'y'.repeat(400) } },
  ];
  const before = estimatePackedSessionTokens('static', '', rows);
  const dropped = omitOldestToolResultsUntilFit({
    staticText: 'static',
    summary: '',
    rows,
    threshold: Math.floor(before / 2),
  });
  assert.ok(dropped.omitRecordIds.includes('t-old'));
  assert.ok(dropped.rows.some((row) => row.id === 'm1'));
}

{
  const rows = [
    { id: 'c1', item: { type: 'function_call', call_id: 'call_1', arguments: '{}' } },
    { id: 'r1', item: { type: 'function_call_output', call_id: 'call_1', output: 'z'.repeat(400) } },
    { id: 'm1', item: { type: 'message', role: 'user', content: 'hi' } },
  ];
  const before = estimatePackedSessionTokens('', '', rows);
  const dropped = omitOldestToolResultsUntilFit({
    staticText: '',
    summary: '',
    rows,
    threshold: Math.floor(before / 2),
  });
  assert.ok(dropped.omitRecordIds.includes('r1'));
  assert.ok(dropped.omitRecordIds.includes('c1'));
  assert.ok(!dropped.rows.some((row) => row.id === 'c1' || row.id === 'r1'));
  assert.ok(dropped.rows.some((row) => row.id === 'm1'));
}

{
  const think = sessionItemBudgetText({
    type: 'message',
    role: 'assistant',
    content: '<think>secret reasoning</think>\n\nvisible answer',
  });
  assert.ok(think.includes('visible answer'));
  assert.ok(!think.includes('secret reasoning'));
}

{
  const rows = [
    { id: 'm1', item: { type: 'message', role: 'assistant', content: 'done' } },
    { id: 'c-tail', item: { type: 'function_call', call_id: 'late', arguments: '{}' } },
    { id: 'r-tail', item: { type: 'function_call_output', call_id: 'late', output: 'still sent' } },
    { id: 'u-new', item: { type: 'message', role: 'user', content: 'new text' } },
  ];
  const budget = rowsForPriorBudget(rows, [{ id: 'm1' }], null);
  assert.deepEqual(budget.map((row) => row.id), ['m1', 'c-tail', 'r-tail']);
}

{
  const plain = estimatePackedSessionTokens('', '', [
    { id: 'm', item: { type: 'message', role: 'user', content: 'hi' } },
  ]);
  const withImage = estimatePackedSessionTokens('', '', [
    {
      id: 'm',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_image', image_url: 'data:image/png;base64,xx' }, { type: 'text', text: 'hi' }],
      },
    },
  ]);
  assert.ok(withImage > plain);
}

console.log('contextBudget.test.ts: ok');
