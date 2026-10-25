import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './FileStorage';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-session-sort-'));
const storage = new FileStorage(root);

const botA = storage.createBot({ name: 'A' });
const botB = storage.createBot({ name: 'B' });
// Touch A so it sorts above B by last chat time.
storage.touchBot(botA.id);
const aAfterTouch = storage.listBots().find((b) => b.id === botA.id)!;
const bBaseline = storage.listBots().find((b) => b.id === botB.id)!;
assert.ok(aAfterTouch.updatedAt >= bBaseline.updatedAt);

const aUpdatedAt = aAfterTouch.updatedAt;
const bUpdatedAt = bBaseline.updatedAt;

storage.updateBot(botB.id, { name: 'B-renamed', description: 'profile edit' });
const bAfterProfile = storage.listBots().find((b) => b.id === botB.id)!;
assert.equal(bAfterProfile.name, 'B-renamed');
assert.equal(
  bAfterProfile.updatedAt,
  bUpdatedAt,
  'updateBot must not bump updatedAt (session list sort key)',
);

storage.updateBot(botA.id, { emoji: '🤖', color: '#112233' });
const aAfterProfile = storage.listBots().find((b) => b.id === botA.id)!;
assert.equal(
  aAfterProfile.updatedAt,
  aUpdatedAt,
  'bot profile edit must not reorder session list',
);

const squad = storage.createSquad({
  name: 'Crew',
  members: [
    { botId: botA.id },
    { botId: botB.id },
  ],
});
const squadUpdatedAt = storage.listSquads().find((s) => s.id === squad.id)!.updatedAt;
storage.updateSquad(squad.id, { name: 'Crew 2', description: 'edited' });
const squadAfter = storage.listSquads().find((s) => s.id === squad.id)!;
assert.equal(squadAfter.name, 'Crew 2');
assert.equal(
  squadAfter.updatedAt,
  squadUpdatedAt,
  'updateSquad must not bump updatedAt (session list sort key)',
);

storage.touchSquad(squad.id);
const squadTouched = storage.listSquads().find((s) => s.id === squad.id)!;
assert.ok(squadTouched.updatedAt > squadUpdatedAt, 'touchSquad must bump updatedAt');

storage.touchBot(botB.id);
const bTouched = storage.listBots().find((b) => b.id === botB.id)!;
assert.ok(bTouched.updatedAt > bUpdatedAt, 'touchBot must bump updatedAt');

fs.rmSync(root, { recursive: true, force: true });
console.log('sessionSortUpdatedAt.test.ts: ok');
