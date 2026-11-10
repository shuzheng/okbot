import assert from 'node:assert/strict';
import { resolveFinalContent, type AgentRunStreamResult } from './hitl.js';

function resultWithHistory(texts: string[]): AgentRunStreamResult {
  return {
    history: texts.map((content) => ({ role: 'assistant', content })),
    finalOutput: texts[texts.length - 1] ?? '',
    state: {
      approve() {},
      reject() {},
      toString: () => '',
    },
    toTextStream: () => (async function* () {})(),
    completed: Promise.resolve(),
    error: undefined,
  } as unknown as AgentRunStreamResult;
}

{
  // Normal: streamed wins when it is a single clean segment.
  const r = resultWithHistory(['你好']);
  assert.equal(resolveFinalContent(r, '你好'), '你好');
}

{
  // Concat safety net: streamed = A + Msg2 where history has A then Msg2.
  const a = '好，那就边测边报，有问题当场说，不压到最后。';
  const msg2 = a + '\n\n最后一件小事，说完就能开工：';
  const streamed = a + msg2; // missing seal → accumulator kept A then appended Msg2
  const r = resultWithHistory([a, msg2]);
  assert.equal(resolveFinalContent(r, streamed), msg2);
}

{
  // Empty stream falls back to last history assistant.
  const r = resultWithHistory(['先说一句', '正式回答']);
  assert.equal(resolveFinalContent(r, ''), '正式回答');
}

{
  // Unrelated streamed text must not be replaced by history.
  const r = resultWithHistory(['旧段']);
  assert.equal(resolveFinalContent(r, '全新回答'), '全新回答');
}

console.log('resolveFinalContent.test.ts OK');
