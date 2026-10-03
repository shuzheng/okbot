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

const mode = fs.statSync(path.join(root, 'settings.json')).mode & 0o777;
assert.equal(mode, 0o600);

fs.rmSync(root, { recursive: true, force: true });
console.log('deleteOwner.test.ts OK');
