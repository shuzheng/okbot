import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionsChangedReason } from '@okbot/shared';
import { FileStorage } from './FileStorage';
import { runtimeEventChannel } from '../sessionEvents';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-sessions-'));
const storage = new FileStorage(root);
const events: Array<{ id: string; reason: SessionsChangedReason }> = [];
storage.setSessionsChangedListener((id, reason) => {
  events.push({ id, reason });
});

const bot = storage.createBot({ name: 'A' });
assert.deepEqual(events.at(-1), { id: bot.id, reason: 'created' });

storage.updateBot(bot.id, { name: 'Renamed' });
assert.equal(storage.listBots().find((b) => b.id === bot.id)?.name, 'Renamed');
assert.deepEqual(events.at(-1), { id: bot.id, reason: 'updated' });

const now = new Date().toISOString();
storage.appendMessage(bot.id, { id: 'u1', role: 'user', content: 'hi', createdAt: now });
assert.deepEqual(events.at(-1), { id: bot.id, reason: 'message' });

const beforeEmpty = events.length;
await storage.upsertAssistantMessage(bot.id, {
  id: 'empty',
  role: 'assistant',
  content: '   ',
  createdAt: now,
});
assert.equal(events.length, beforeEmpty, 'empty orphan upsert must not notify');

await storage.upsertAssistantMessage(bot.id, {
  id: 'a1',
  role: 'assistant',
  content: 'hello',
  createdAt: now,
});
assert.deepEqual(events.at(-1), { id: bot.id, reason: 'message' });

const bot2 = storage.createBot({ name: 'B' });
const squad = storage.createSquad({
  name: 'Crew',
  members: [
    { botId: bot.id, role: 'a' },
    { botId: bot2.id, role: 'b' },
  ],
});
assert.deepEqual(events.at(-1), { id: squad.id, reason: 'created' });
storage.updateSquad(squad.id, { name: 'Crew 2' });
assert.deepEqual(events.at(-1), { id: squad.id, reason: 'updated' });
storage.deleteSquad(squad.id);
assert.deepEqual(events.at(-1), { id: squad.id, reason: 'deleted' });

storage.deleteBot(bot.id);
assert.deepEqual(events.at(-1), { id: bot.id, reason: 'deleted' });

assert.equal(
  runtimeEventChannel({ type: 'sessions_changed', botId: bot.id, reason: 'message' }),
  'sessions',
);
assert.equal(
  runtimeEventChannel({ type: 'delta', botId: bot.id, messageId: 'm', delta: 'x' }),
  'turn',
);

fs.rmSync(root, { recursive: true, force: true });
console.log('sessionsChanged.test.ts: ok');
