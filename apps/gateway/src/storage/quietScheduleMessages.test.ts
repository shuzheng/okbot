import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './FileStorage';
import { formatScheduledTurnText, createScheduledJob } from './schedules';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-quiet-sched-'));
const storage = new FileStorage(root);
const bot = storage.createBot({ name: 'Sched' });

const job = createScheduledJob({
  ownerId: bot.id,
  title: '晨报',
  prompt: '请汇总今日待办',
  schedule: { kind: 'daily', hour: 9, minute: 0 },
  timezone: 'Asia/Shanghai',
  once: false,
});
const triggerText = formatScheduledTurnText(job);

const quietUser = {
  id: 'msg_sched_trigger',
  role: 'user' as const,
  content: triggerText,
  createdAt: '2026-11-06T01:00:00.000Z',
  autoContinue: true,
};
const realUser = {
  id: 'msg_real_user',
  role: 'user' as const,
  content: triggerText, // same text typed by a human must still show
  createdAt: '2026-11-06T01:01:00.000Z',
};
const assistant = {
  id: 'msg_asst',
  role: 'assistant' as const,
  content: '今日待办：1) 发版 2) 巡检',
  createdAt: '2026-11-06T01:00:30.000Z',
};

storage.appendMessage(bot.id, quietUser);
storage.appendMessage(bot.id, assistant);
storage.appendMessage(bot.id, realUser);

const ui = storage.getMessages(bot.id);
assert.deepEqual(
  ui.map((m) => m.id),
  ['msg_asst', 'msg_real_user'],
  'getMessages must hide schedule trigger but keep assistant + real user',
);
assert.equal(ui.some((m) => m.autoContinue), false);

const page = storage.getMessagesPage(bot.id, { limit: 10 });
assert.deepEqual(
  page.messages.map((m) => m.id),
  ['msg_asst', 'msg_real_user'],
  'getMessagesPage must also hide schedule trigger',
);

const hits = await storage.searchMessages('汇总今日待办', { limit: 10 });
assert.deepEqual(
  hits.map((h) => h.message.id),
  ['msg_real_user'],
  'search must skip quiet schedule trigger; real user with same text still matches',
);

const ownerHits = await storage.searchMessagesForOwner(bot.id, '【定时', { limit: 10 });
assert.deepEqual(
  ownerHits.map((h) => h.message.id),
  ['msg_real_user'],
  'owner search_history must also skip quiet schedule trigger',
);

// Disk still has the quiet row for the model session.
const byId = storage.getMessageById(bot.id, 'msg_sched_trigger');
assert.ok(byId);
assert.equal(byId!.autoContinue, true);

fs.rmSync(root, { recursive: true, force: true });
console.log('quietScheduleMessages.test.ts: ok');
