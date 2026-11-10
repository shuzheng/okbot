import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAssistantPackage } from '@okbot/agent';
import { FileStorage } from './FileStorage.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-bot-name-'));
const storage = new FileStorage(root);

try {
  const a = storage.createBot({ name: 'Alpha' });
  assert.equal(a.name, 'Alpha');

  // Create duplicate rejected.
  assert.throws(() => storage.createBot({ name: ' Alpha ' }), /已存在同名助手/);
  assert.throws(() => storage.createBot({ name: 'Alpha' }), /已存在同名助手「Alpha」/);

  const b = storage.createBot({ name: 'Beta' });

  // Update to another's name rejected.
  assert.throws(() => storage.updateBot(b.id, { name: 'Alpha' }), /已存在同名助手「Alpha」/);

  // Update keeping own name OK.
  const same = storage.updateBot(a.id, { name: 'Alpha', description: 'still me' });
  assert.equal(same.name, 'Alpha');
  assert.equal(same.description, 'still me');

  // Rename to free name OK.
  const renamed = storage.updateBot(b.id, { name: 'Beta2' });
  assert.equal(renamed.name, 'Beta2');

  const pkg = buildAssistantPackage({
    name: 'Alpha',
    description: 'from package',
    avatar: { avatarKind: 'emoji', emoji: '📦', color: '#112233' },
    soulMd: '# soul\n',
  });

  // Import collision → -2
  const imported = storage.installAssistantPackage(pkg);
  assert.equal(imported.name, 'Alpha-2');

  // Import again when -2 taken → -3
  const imported2 = storage.installAssistantPackage(pkg);
  assert.equal(imported2.name, 'Alpha-3');

  // Import with free name unchanged.
  const freePkg = buildAssistantPackage({
    name: 'Gamma',
    description: 'free',
    avatar: { avatarKind: 'emoji', emoji: '✨', color: '' },
    soulMd: '',
  });
  const free = storage.installAssistantPackage(freePkg);
  assert.equal(free.name, 'Gamma');

  // Local folder import uses the same install path.
  const dir = path.join(root, 'pack-dir');
  fs.mkdirSync(dir, { recursive: true });
  storage.exportAssistantPackage(a.id, dir);
  // Exported as Alpha; clash → Alpha-4 (Alpha, Alpha-2, Alpha-3 taken)
  const fromDir = storage.importAssistantPackage(dir);
  assert.equal(fromDir.name, 'Alpha-4');

  console.log('botNameUnique.test.ts: ok');
} finally {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
