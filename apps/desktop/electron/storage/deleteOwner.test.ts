import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './FileStorage';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-del-'));
const outside = path.join(root, 'outside-secret');
fs.writeFileSync(outside, 'keep');
const storage = new FileStorage(root);
const bot = storage.createBot({ name: 'A' });
const bot2 = storage.createBot({ name: 'B' });
assert.equal(fs.existsSync(path.join(root, bot.id)), true);

let escaped = false;
try {
  storage.deleteBot('../outside-secret');
} catch {
  escaped = true;
}
assert.equal(escaped, true);
assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');
assert.equal(fs.existsSync(path.join(root, bot.id)), true, 'failed delete must not remove the bot');

let unknown = false;
try {
  storage.deleteBot('bot_20990101_999');
} catch {
  unknown = true;
}
assert.equal(unknown, true);

storage.deleteBot(bot.id);
assert.equal(fs.existsSync(path.join(root, bot.id)), false);

const squad = storage.createSquad({
  name: 'S',
  members: [
    { botId: bot2.id, role: 'a' },
    { botId: storage.createBot({ name: 'C' }).id, role: 'b' },
  ],
});
assert.equal(fs.existsSync(path.join(root, squad.id)), true);
let badSquad = false;
try {
  storage.deleteSquad(`../${path.basename(outside)}`);
} catch {
  badSquad = true;
}
assert.equal(badSquad, true);
assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');
storage.deleteSquad(squad.id);
assert.equal(fs.existsSync(path.join(root, squad.id)), false);

// A run that finishes after the delete must not recreate the owner directory.
assert.throws(() =>
  storage.appendMessage(squad.id, { id: 'late', role: 'assistant', content: 'x', createdAt: new Date().toISOString() }),
);
assert.throws(() =>
  storage.appendMessage(bot.id, { id: 'late', role: 'assistant', content: 'x', createdAt: new Date().toISOString() }),
);
assert.equal(fs.existsSync(path.join(root, squad.id)), false);
assert.equal(fs.existsSync(path.join(root, bot.id)), false);

// Other late writers: run trace, usage, memory, squad purge.
const { RunTraceRecorder } = await import('./runTrace');
const lateTrace = new RunTraceRecorder(storage.ownerDir(bot.id), true, 'run_late');
lateTrace.append({ type: 'error', message: 'late' } as never);
lateTrace.finish('done');
assert.equal(fs.existsSync(path.join(root, bot.id)), false, 'run trace must not recreate a deleted owner');
storage.recordUsage(bot.id, { input: 5, output: 5, cache: 0 } as never);
const stats = storage.getUsageStats();
assert.equal(stats.byOwner[bot.id], undefined, 'no usage entry for a deleted owner');
assert.ok(stats.lifetime.input >= 5, 'tokens still count in totals');
assert.throws(() => storage.upsertMemory('bot', { id: 'm1', bot_id: bot.id, memory: 'x', expires: null }));
assert.equal(fs.existsSync(path.join(root, bot.id)), false);

// A squad removed because a member was deleted is tombstoned too.
const p1 = storage.createBot({ name: 'P1' });
const p2 = storage.createBot({ name: 'P2' });
const sq2 = storage.createSquad({ name: 'S2', members: [{ botId: p1.id, role: 'a' }, { botId: p2.id, role: 'b' }] });
storage.recordUsage(sq2.id, { input: 3, output: 3, cache: 0 } as never);
assert.ok(storage.getUsageStats().byOwner[sq2.id]);
storage.deleteBot(p1.id);
assert.equal(storage.getUsageStats().byOwner[sq2.id], undefined, 'cascade-deleted squad usage is cleared');
assert.equal(fs.existsSync(path.join(root, sq2.id)), false);
assert.throws(() =>
  storage.appendMessage(sq2.id, { id: 'late2', role: 'assistant', content: 'x', createdAt: new Date().toISOString() }),
);
assert.equal(fs.existsSync(path.join(root, sq2.id)), false);

const mode = fs.statSync(path.join(root, 'settings.json')).mode & 0o777;
assert.equal(mode, 0o600);
assert.equal(fs.statSync(root).mode & 0o777, 0o700);

const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-mode-'));
fs.chmodSync(legacy, 0o755);
fs.writeFileSync(path.join(legacy, 'settings.json'), '{}\n', { mode: 0o644 });
new FileStorage(legacy);
assert.equal(fs.statSync(legacy).mode & 0o777, 0o700);
assert.equal(fs.statSync(path.join(legacy, 'settings.json')).mode & 0o777, 0o600);

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(legacy, { recursive: true, force: true });
console.log('deleteOwner.test.ts OK');
