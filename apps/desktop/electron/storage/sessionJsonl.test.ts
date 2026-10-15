import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dedupeMeshInterimMessages,
  filterRecordsForModelSession,
  legacyMessageToRecord,
  mergeUiMessageOntoRecord,
  readJsonlPage,
  recordToUiMessage,
  writeSessionRecordsAtomic,
} from './sessionJsonl.js';
import type { SessionRecordV2 } from './types.js';

function ui(id: string, role: 'user' | 'assistant', content: string): SessionRecordV2 {
  return legacyMessageToRecord({
    id,
    role,
    content,
    createdAt: new Date().toISOString(),
  });
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-jsonl-'));
  const file = path.join(dir, 'session.jsonl');
  const records = [
    ui('m1', 'user', 'one'),
    ui('m2', 'assistant', 'two'),
    ui('m3', 'user', 'three'),
    ui('m4', 'assistant', 'four'),
    ui('m5', 'user', 'five'),
  ];
  writeSessionRecordsAtomic(file, records);

  const newest = readJsonlPage(file, 2);
  assert.deepEqual(
    newest.messages.map((m) => m.id),
    ['m4', 'm5'],
  );
  assert.equal(newest.hasMore, true);
  assert.equal(newest.nextBeforeMessageId, 'm4');

  const older = readJsonlPage(file, 2, newest.nextBeforeMessageId);
  assert.deepEqual(
    older.messages.map((m) => m.id),
    ['m2', 'm3'],
  );
  assert.equal(older.hasMore, true);
  assert.equal(older.nextBeforeMessageId, 'm2');

  const oldest = readJsonlPage(file, 2, older.nextBeforeMessageId);
  assert.deepEqual(
    oldest.messages.map((m) => m.id),
    ['m1'],
  );
  assert.equal(oldest.hasMore, false);
  assert.equal(oldest.nextBeforeMessageId, null);

  // Full-file rewrite shifts byte offsets; message-id cursor must still work.
  writeSessionRecordsAtomic(file, [
    ui('m1', 'user', 'one'),
    ui('m2', 'assistant', 'two-rewritten-longer-content'),
    ui('m3', 'user', 'three'),
    ui('m4', 'assistant', 'four'),
    ui('m5', 'user', 'five'),
    ui('m6', 'assistant', 'six-new'),
  ]);

  const afterRewrite = readJsonlPage(file, 2, 'm4');
  assert.deepEqual(
    afterRewrite.messages.map((m) => m.id),
    ['m2', 'm3'],
  );
  assert.equal(afterRewrite.nextBeforeMessageId, 'm2');

  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // Responses-style array content must survive mergeUiMessageOntoRecord.
  const prev: SessionRecordV2 = {
    v: 2,
    id: 'a1',
    createdAt: '2026-01-01T00:00:00.000Z',
    item: {
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'output_text', text: 'old' },
        { type: 'output_text', text: 'keep-me' },
      ],
    },
    meta: { uiRole: 'assistant' },
  };
  const merged = mergeUiMessageOntoRecord(prev, {
    id: 'a1',
    role: 'assistant',
    content: 'new-text',
    createdAt: '2026-01-01T00:00:01.000Z',
    usage: { input: 1, output: 2, cache: 0 },
  });
  assert.equal(merged.id, 'a1');
  assert.ok(Array.isArray(merged.item.content));
  const parts = merged.item.content as Array<Record<string, unknown>>;
  assert.equal(parts[0]?.text, 'new-text');
  assert.equal(parts[1]?.text, 'keep-me');
  assert.deepEqual(merged.meta?.usage, { input: 1, output: 2, cache: 0 });
}

{
  // Empty-orphan note: FileStorage.upsertAssistantMessage refuses empty content when
  // there is no id match (avoids rebinding/wiping the prior assistant). merge itself
  // still applies empty text onto an existing record when called directly.
  const prev = ui('x1', 'assistant', 'prior');
  const merged = mergeUiMessageOntoRecord(prev, {
    id: 'orphan-new',
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
  });
  assert.equal(merged.id, 'orphan-new');
  assert.equal(merged.item.content, '');
}


{
  const interim = '好的，再让写作助手介绍一次。';
  const a = recordToUiMessage(
    legacyMessageToRecord({
      id: 'a',
      role: 'assistant',
      content: interim,
      createdAt: '2026-01-01T00:00:00.000Z',
      meshInterim: true,
    }),
  )!;
  const status = recordToUiMessage(
    legacyMessageToRecord({
      id: 's',
      role: 'assistant',
      content: '已发消息给 写作助手',
      createdAt: '2026-01-01T00:00:01.000Z',
      meshExchange: {
        exchangeId: 'mesh_1',
        peerBotId: 'bot_x',
        peerName: '写作助手',
        callerBotId: 'bot_y',
        callerName: 'OkBot',
        ask: '介绍',
        askAt: '2026-01-01T00:00:01.000Z',
      },
    }),
  )!;
  const sdkDup = recordToUiMessage(
    legacyMessageToRecord({
      id: 'dup',
      role: 'assistant',
      content: interim,
      createdAt: '2026-01-01T00:00:02.000Z',
    }),
  )!;
  const b = recordToUiMessage(
    legacyMessageToRecord({
      id: 'b',
      role: 'assistant',
      content: interim + '它说：你好',
      createdAt: '2026-01-01T00:00:03.000Z',
    }),
  )!;
  const out = dedupeMeshInterimMessages([a, status, sdkDup, b]);
  assert.deepEqual(
    out.map((m) => m.id),
    ['a', 's', 'b'],
  );
  assert.equal(a.meshInterim, true);
  assert.equal(out[2]!.content.startsWith('它说：'), true);
  assert.equal(out[2]!.content.includes('再让写作助手介绍一次'), false);
}

{
  // Legacy pattern without meshInterim flag
  const interim = '先去问问写作助手。';
  const a = recordToUiMessage(
    legacyMessageToRecord({
      id: 'a2',
      role: 'assistant',
      content: interim,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
  )!;
  const status = recordToUiMessage(
    legacyMessageToRecord({
      id: 's2',
      role: 'assistant',
      content: '已发消息给 写作助手',
      createdAt: '2026-01-01T00:00:01.000Z',
      meshExchange: {
        exchangeId: 'mesh_2',
        peerBotId: 'bot_x',
        peerName: '写作助手',
        callerBotId: 'bot_y',
        callerName: 'OkBot',
        ask: '介绍',
        askAt: '2026-01-01T00:00:01.000Z',
      },
    }),
  )!;
  const sdkDup = recordToUiMessage(
    legacyMessageToRecord({
      id: 'dup2',
      role: 'assistant',
      content: interim,
      createdAt: '2026-01-01T00:00:02.000Z',
    }),
  )!;
  const b = recordToUiMessage(
    legacyMessageToRecord({
      id: 'b2',
      role: 'assistant',
      content: interim + '它说：ok',
      createdAt: '2026-01-01T00:00:03.000Z',
    }),
  )!;
  const out = dedupeMeshInterimMessages([a, status, sdkDup, b]);
  assert.deepEqual(
    out.map((m) => m.id),
    ['a2', 's2', 'b2'],
  );
  assert.equal(out[2]!.content, '它说：ok');
}

{
  // Model session must omit sealed meshInterim A (and mesh chips) so the next
  // turn does not few-shot 「好的…」 as a complete tool-less reply.
  const interim = '好的，再让写作助手介绍一次。';
  const user = legacyMessageToRecord({
    id: 'u',
    role: 'user',
    content: '再试一次',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  const sealedA = legacyMessageToRecord({
    id: 'a',
    role: 'assistant',
    content: interim,
    createdAt: '2026-01-01T00:00:01.000Z',
    meshInterim: true,
  });
  const chip = legacyMessageToRecord({
    id: 's',
    role: 'assistant',
    content: '已发消息给 写作助手',
    createdAt: '2026-01-01T00:00:02.000Z',
    meshExchange: {
      exchangeId: 'mesh_1',
      peerBotId: 'bot_x',
      peerName: '写作助手',
      callerBotId: 'bot_y',
      callerName: 'OkBot',
      ask: '介绍',
      askAt: '2026-01-01T00:00:02.000Z',
    },
  });
  const sdkA: SessionRecordV2 = {
    v: 2,
    id: 'evt_a',
    createdAt: '2026-01-01T00:00:03.000Z',
    item: {
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: interim }],
    },
    meta: { uiRole: 'assistant', runId: 'run_1' },
  };
  const toolCall: SessionRecordV2 = {
    v: 2,
    id: 'evt_fc',
    createdAt: '2026-01-01T00:00:03.000Z',
    item: { type: 'function_call', callId: 'c1', name: 'ask_assistant', arguments: '{}' },
    meta: { runId: 'run_1' },
  };
  const toolResult: SessionRecordV2 = {
    v: 2,
    id: 'evt_fr',
    createdAt: '2026-01-01T00:00:03.000Z',
    item: {
      type: 'function_call_result',
      name: 'ask_assistant',
      callId: 'c1',
      status: 'completed',
      output: 'peer reply',
    },
    meta: { runId: 'run_1' },
  };
  const finalB: SessionRecordV2 = {
    v: 2,
    id: 'evt_b',
    createdAt: '2026-01-01T00:00:04.000Z',
    item: {
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: interim + '它说：peer reply' }],
    },
    meta: { uiRole: 'assistant', runId: 'run_1' },
  };
  const model = filterRecordsForModelSession([
    user,
    sealedA,
    chip,
    sdkA,
    toolCall,
    toolResult,
    finalB,
  ]);
  assert.deepEqual(
    model.map((r) => r.id),
    ['u', 'evt_a', 'evt_fc', 'evt_fr', 'evt_b'],
  );
}

{
  // Legacy 42ef35d: untagged plain UI twin before SDK assistant with same text.
  const interim = '好的，再让写作助手介绍一次。';
  const orphan = legacyMessageToRecord({
    id: 'orphan',
    role: 'assistant',
    content: interim,
    createdAt: '2026-01-01T00:00:01.000Z',
  });
  const sdk: SessionRecordV2 = {
    v: 2,
    id: 'sdk',
    createdAt: '2026-01-01T00:00:02.000Z',
    item: {
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: interim }],
    },
    meta: { uiRole: 'assistant' },
  };
  const model = filterRecordsForModelSession([orphan, sdk]);
  assert.deepEqual(
    model.map((r) => r.id),
    ['sdk'],
  );
}


console.log('sessionJsonl.test.ts: ok');
