import assert from 'node:assert/strict';
import { DEFAULT_CONTEXT_COMPRESSION, type ChatMessage, type ResolvedModelConfig, type SessionSummary } from '@okbot/shared';
import { ContextWindowExceededError } from '@okbot/agent';
import { ensureSessionCompressed, resolveTopicCompressForce } from './sessionCompression';

const model: ResolvedModelConfig = {
  baseURL: 'http://example.invalid/v1',
  apiKey: 'test',
  apiFormat: 'chat_completions',
  model: 'test',
  contextWindow: 1000,
  maxTokens: null,
  showThinking: false,
};

function msg(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, createdAt: '2026-01-01T00:00:00.000Z' };
}

function store() {
  let saved: SessionSummary | null = null;
  const writes: string[] = [];
  return {
    writes,
    readSessionSummary: () => saved,
    writeSessionSummary: (_id: string, entry: SessionSummary) => {
      saved = entry;
      writes.push(entry.coveredThroughId);
    },
  };
}

{
  const prior = Array.from({ length: 8 }, (_, i) => msg(`m${i}`, 'a'.repeat(4000)));
  const mem = store();
  const calls: string[][] = [];
  const result = await ensureSessionCompressed({
    storage: mem,
    ownerId: 'bot',
    model,
    contextCompression: DEFAULT_CONTEXT_COMPRESSION,
    staticText: 'hi',
    prior,
    compress: async (input) => {
      calls.push(input.deltaMessages.map((m) => m.id));
      return {
        summary: '目标：\n继续\n',
        consumedThroughId: input.deltaMessages[input.deltaMessages.length - 1]?.id ?? null,
      };
    },
  });
  assert.equal(result.summaryState?.coveredThroughId, 'm7');
  assert.ok(calls.length > 1, 'keep shrinks below the default of 5');
  assert.ok(calls.some((ids) => ids.length > 1));
}

{
  const prior = Array.from({ length: 8 }, (_, i) => msg(`m${i}`, 'a'.repeat(4000)));
  const mem = store();
  await ensureSessionCompressed({
    storage: mem,
    ownerId: 'bot',
    model,
    contextCompression: DEFAULT_CONTEXT_COMPRESSION,
    staticText: 'hi',
    prior,
    compress: async (input) => ({
      summary: '约定：\n- 用中文回复\n',
      consumedThroughId: input.deltaMessages[0]?.id ?? null,
    }),
  });
  assert.equal(mem.writes[0], 'm0');
  assert.notEqual(mem.writes[0], 'm2');
}

{
  const prior = [msg('m0', 'hi'), msg('m1', 'yo')];
  const mem = store();
  const tool = 'z'.repeat(5000);
  const result = await ensureSessionCompressed({
    storage: mem,
    ownerId: 'bot',
    model: { ...model, contextWindow: 400 },
    contextCompression: DEFAULT_CONTEXT_COMPRESSION,
    staticText: 'hi',
    prior,
    enforceBudget: true,
    sessionRows: [
      { id: 'm0', item: { type: 'message', role: 'user', content: 'hi' } },
      { id: 't1', item: { type: 'function_call_output', output: tool } },
      { id: 'm1', item: { type: 'message', role: 'user', content: 'yo' } },
    ],
    compress: async () => ({ summary: '目标：\n无\n', consumedThroughId: null }),
  });
  assert.ok(result.omitRecordIds.includes('t1'));
  assert.equal(result.summaryState, null);
}

{
  const prior = [msg('m0', 'hi')];
  const mem = store();
  await assert.rejects(
    () =>
      ensureSessionCompressed({
        storage: mem,
        ownerId: 'bot',
        model: { ...model, contextWindow: 200 },
        contextCompression: DEFAULT_CONTEXT_COMPRESSION,
        staticText: 'q'.repeat(4000),
        prior,
        enforceBudget: true,
        compress: async (input) => ({
          summary: '目标：\n无\n',
          consumedThroughId: input.deltaMessages[0]?.id ?? null,
        }),
      }),
    (err: unknown) => err instanceof ContextWindowExceededError,
  );
}

{
  const prior = Array.from({ length: 10 }, (_, i) => msg(`m${i}`, 'same topic'));
  const base = {
    model,
    contextCompression: DEFAULT_CONTEXT_COMPRESSION,
    prior,
    sessionSummary: '',
    coveredThroughId: null,
    newUserText: '换个话题',
  };
  assert.equal(
    await resolveTopicCompressForce({ ...base, detect: async () => true }),
    'newTopic',
  );
  assert.equal(
    await resolveTopicCompressForce({ ...base, detect: async () => false }),
    undefined,
  );
  let called = false;
  assert.equal(
    await resolveTopicCompressForce({
      ...base,
      contextCompression: { ...DEFAULT_CONTEXT_COMPRESSION, autoTopicCompress: false },
      detect: async () => {
        called = true;
        return true;
      },
    }),
    undefined,
  );
  assert.equal(called, false);
}

{
  const prior = [msg('m0', 'a'), msg('m1', 'b'), msg('m2', 'c'), msg('m3', 'd')];
  const mem = store();
  const facts: string[][] = [];
  let calls = 0;
  await ensureSessionCompressed({
    storage: mem,
    ownerId: 'bot',
    model,
    contextCompression: DEFAULT_CONTEXT_COMPRESSION,
    staticText: '',
    prior,
    force: 'newTopic',
    rememberFacts: (next) => facts.push(next),
    compress: async (input) => {
      calls += 1;
      assert.equal(input.deltaMessages.length, 4);
      return {
        summary: '约定：\n- 保持中文\n决定：\n- 不发公开仓库\n',
        consumedThroughId: input.deltaMessages[input.deltaMessages.length - 1]!.id,
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(mem.readSessionSummary()?.coveredThroughId, 'm3');
  assert.deepEqual(facts, [['保持中文', '不发公开仓库']]);
}

console.log('sessionCompression.test.ts: ok');
