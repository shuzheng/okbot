import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAssistantPackage, parseAssistantPackage } from '@okbot/agent';
import {
  readAssistantPackageArchive,
  readAssistantPackageDir,
  writeAssistantPackageDir,
  zipAssistantPackage,
} from './assistantPackageIo.js';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-pkg-io-'));

try {
  const pkg = buildAssistantPackage({
    name: 'IO助手',
    description: '读写往返',
    avatar: {
      avatarKind: 'bot-avatar',
      emoji: '🧭',
      color: '#445566',
      botAvatarType: 'hexagon',
    },
    soulMd: '# soul\n',
  });

  const dir = path.join(tmpRoot, 'new-format');
  writeAssistantPackageDir(dir, pkg);
  assert.equal(fs.existsSync(path.join(dir, 'manifest.json')), false);
  assert.ok(fs.existsSync(path.join(dir, 'bot.json')));
  const botOnDisk = JSON.parse(fs.readFileSync(path.join(dir, 'bot.json'), 'utf8')) as {
    emoji: string;
    botAvatarType?: string;
  };
  assert.equal(botOnDisk.emoji, '🧭');
  assert.equal(botOnDisk.botAvatarType, 'hexagon');

  const loaded = readAssistantPackageDir(dir);
  assert.equal(loaded.manifest.name, 'IO助手');
  assert.equal(loaded.manifest.avatar.botAvatarType, 'hexagon');
  assert.equal(loaded.manifest.avatar.color, '#445566');

  const archive = path.join(tmpRoot, 'pack.okbot');
  zipAssistantPackage(dir, archive);
  const fromZip = readAssistantPackageArchive(archive);
  assert.equal(fromZip.manifest.avatar.emoji, '🧭');
  assert.equal(fromZip.manifest.avatar.botAvatarType, 'hexagon');

  // Junk leftover file next to a valid bot.json is ignored.
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ format: 'okbot-assistant', name: '应被忽略', avatar: { emoji: '❌' } }),
  );
  const ignoreJunk = readAssistantPackageDir(dir);
  assert.equal(ignoreJunk.manifest.name, 'IO助手');
  assert.equal(ignoreJunk.manifest.avatar.emoji, '🧭');

  // Pack with only manifest.json (no bot.json) fails.
  const onlyManifest = path.join(tmpRoot, 'only-manifest');
  fs.mkdirSync(onlyManifest, { recursive: true });
  fs.writeFileSync(
    path.join(onlyManifest, 'manifest.json'),
    JSON.stringify({
      format: 'okbot-assistant',
      name: '旧格式',
      description: 'manifest only',
      avatar: { avatarKind: 'emoji', emoji: '📼', color: '#999999' },
    }),
  );
  assert.throws(() => readAssistantPackageDir(onlyManifest), /缺少 bot\.json/);

  const parsed = parseAssistantPackage({
    botJson: botOnDisk,
    soulMd: '# soul\n',
  });
  assert.equal(parsed.manifest.avatar.emoji, '🧭');

  console.log('assistantPackageIo.test.ts: ok');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
