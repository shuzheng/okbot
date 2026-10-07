import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './FileStorage';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-skill-norm-'));
const storage = new FileStorage(root);
const bot = storage.createBot({ name: 'SkillNorm' });
const skillsRoot = path.join(root, bot.id, 'skills');

// --- bare dir exists → writeSkill migrates into okbot-* and updates in place (no duplicate) ---
const bareDir = path.join(skillsRoot, 'demo-pack');
fs.mkdirSync(bareDir, { recursive: true });
fs.writeFileSync(
  path.join(bareDir, 'SKILL.md'),
  '---\nname: "old"\ndescription: "old desc"\n---\n\nold body\n',
  'utf8',
);

storage.writeSkill(bot.id, {
  slug: 'demo-pack',
  name: 'demo-pack',
  description: 'new desc',
  body: '## When\nnew body',
});

assert.equal(fs.existsSync(bareDir), false, 'bare sibling must be migrated away');
const prefixedDir = path.join(skillsRoot, 'okbot-demo-pack');
assert.equal(fs.existsSync(prefixedDir), true, 'canonical okbot- dir must exist');
const listed = storage.listSkills(bot.id);
assert.equal(listed.length, 1, 'must not create bare + prefixed duplicate');
assert.equal(listed[0]!.slug, 'okbot-demo-pack');
assert.match(listed[0]!.body, /new body/);
assert.match(fs.readFileSync(path.join(prefixedDir, 'SKILL.md'), 'utf8'), /new desc/);

// --- already prefixed → update in place ---
storage.writeSkill(bot.id, {
  slug: 'okbot-demo-pack',
  name: 'okbot-demo-pack',
  description: 'updated again',
  body: '## Steps\nsecond update',
});
assert.equal(storage.listSkills(bot.id).length, 1);
assert.equal(fs.existsSync(bareDir), false);
assert.match(storage.listSkills(bot.id)[0]!.body, /second update/);
assert.match(
  fs.readFileSync(path.join(prefixedDir, 'SKILL.md'), 'utf8'),
  /updated again/,
);

// --- resolveEnabledSkill finds via bare or prefixed lookup key ---
const byBare = storage.resolveEnabledSkill(bot.id, 'demo-pack');
const byPrefixed = storage.resolveEnabledSkill(bot.id, 'okbot-demo-pack');
assert.ok(byBare);
assert.ok(byPrefixed);
assert.equal(byBare!.slug, 'okbot-demo-pack');
assert.equal(byPrefixed!.slug, 'okbot-demo-pack');

console.log('writeSkill.normalize.test.ts: ok');
