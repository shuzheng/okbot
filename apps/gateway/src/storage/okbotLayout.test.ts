import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './FileStorage';
import {
  looksLikeServerLock,
  migrateOkbotLayout,
  resetOkbotLayoutMigrationForTests,
  RUNTIME_LOCK_NAME,
  SERVER_SETTINGS_NAME,
} from './okbotLayout';

assert.equal(
  looksLikeServerLock({ pid: 1, port: 9, owner: 'serve' }),
  true,
);
assert.equal(
  looksLikeServerLock({ pid: 1, port: 9, owner: 'serve', model: { providers: [] } }),
  false,
);
assert.equal(looksLikeServerLock({ timezone: 'UTC', model: {} }), false);

{
  resetOkbotLayoutMigrationForTests();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-layout-'));
  fs.writeFileSync(
    path.join(root, 'server.json'),
    JSON.stringify({ pid: 2_000_000_000, port: 18765, owner: 'electron' }),
  );
  fs.writeFileSync(
    path.join(root, 'settings.json'),
    JSON.stringify({
      timezone: 'Asia/Shanghai',
      model: { providers: [], defaultProviderId: '', defaultModelId: '' },
    }),
  );
  fs.writeFileSync(path.join(root, 'bots.json'), '[]');
  fs.writeFileSync(path.join(root, 'squads.json'), '[]');
  fs.writeFileSync(path.join(root, 'usage.json'), '{}');
  fs.writeFileSync(path.join(root, 'memory.md'), '# mem\n');
  fs.mkdirSync(path.join(root, 'logs'));
  fs.mkdirSync(path.join(root, 'bot_test_001'));
  fs.writeFileSync(path.join(root, 'bot_test_001', 'bot.json'), '{}');
  fs.writeFileSync(
    path.join(root, 'window.json'),
    JSON.stringify({ x: 1, y: 2, width: 800, height: 600 }),
  );

  migrateOkbotLayout(root);

  assert.ok(fs.existsSync(path.join(root, RUNTIME_LOCK_NAME)));
  assert.ok(fs.existsSync(path.join(root, SERVER_SETTINGS_NAME)));
  assert.equal(
    looksLikeServerLock(JSON.parse(fs.readFileSync(path.join(root, SERVER_SETTINGS_NAME), 'utf8'))),
    false,
  );
  const settings = JSON.parse(fs.readFileSync(path.join(root, SERVER_SETTINGS_NAME), 'utf8')) as {
    timezone?: string;
  };
  assert.equal(settings.timezone, 'Asia/Shanghai');
  assert.ok(fs.existsSync(path.join(root, 'data', 'bots.json')));
  assert.ok(fs.existsSync(path.join(root, 'data', 'bot_test_001', 'bot.json')));
  assert.ok(fs.existsSync(path.join(root, 'data', 'logs')));
  assert.ok(fs.existsSync(path.join(root, 'data', 'memory.md')));
  // Config leftovers stay at root.
  assert.ok(fs.existsSync(path.join(root, 'window.json')));
  assert.ok(!fs.existsSync(path.join(root, 'bots.json')));

  resetOkbotLayoutMigrationForTests();
  const storage = new FileStorage(root);
  assert.equal(storage.root, root);
  assert.equal(storage.dataRoot, path.join(root, 'data'));
  assert.equal(storage.getSettings().timezone, 'Asia/Shanghai');
  assert.ok(fs.existsSync(path.join(storage.dataRoot, 'bots.json')));

  fs.rmSync(root, { recursive: true, force: true });
}

console.log('okbotLayout.test.ts: ok');
