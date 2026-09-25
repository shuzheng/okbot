import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  legacyMessageToRecord,
  mergeUiMessageOntoRecord,
  readJsonlPage,
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

console.log('sessionJsonl.test.ts: ok');
