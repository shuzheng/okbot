import assert from 'node:assert/strict';
import {
  OKBOT_ASSISTANT_PACKAGE_FORMAT,
  assistantPackageBotJson,
  assistantPackageToFileMap,
  buildAssistantPackage,
  parseAssistantPackage,
} from './assistantPackage.ts';

const base = buildAssistantPackage({
  name: '头像助手',
  description: '带完整头像字段',
  avatar: {
    avatarKind: 'bot-avatar',
    emoji: '🤖',
    color: '#112233',
    botAvatarType: 'clover',
  },
  soulMd: '# 人设\n你好。',
  skills: [],
});

const files = assistantPackageToFileMap(base);
assert.equal('manifest.json' in files, false, 'export must not emit manifest.json');
assert.ok(files['bot.json']);
assert.ok(files['SOUL.md']);

const botJson = assistantPackageBotJson(base);
assert.equal(botJson.name, '头像助手');
assert.equal(botJson.description, '带完整头像字段');
assert.equal(botJson.avatarKind, 'bot-avatar');
assert.equal(botJson.emoji, '🤖');
assert.equal(botJson.color, '#112233');
assert.equal(botJson.botAvatarType, 'clover');
assert.deepEqual(JSON.parse(files['bot.json']!), botJson);

const fromBotOnly = parseAssistantPackage({
  botJson,
  soulMd: files['SOUL.md'],
});
assert.equal(fromBotOnly.manifest.format, OKBOT_ASSISTANT_PACKAGE_FORMAT);
assert.equal(fromBotOnly.manifest.name, '头像助手');
assert.equal(fromBotOnly.manifest.avatar.avatarKind, 'bot-avatar');
assert.equal(fromBotOnly.manifest.avatar.emoji, '🤖');
assert.equal(fromBotOnly.manifest.avatar.color, '#112233');
assert.equal(fromBotOnly.manifest.avatar.botAvatarType, 'clover');
assert.match(fromBotOnly.soulMd, /你好/);

assert.throws(() => parseAssistantPackage({ botJson: null as unknown }), /缺少 bot\.json/);
assert.throws(() => parseAssistantPackage({ botJson: undefined as unknown }), /缺少 bot\.json/);
assert.throws(
  () => parseAssistantPackage({ botJson: { description: 'no name', emoji: 'x' } }),
  /缺少 name/,
);
assert.throws(
  () =>
    parseAssistantPackage({
      botJson: { format: 'nope', name: 'x', description: '', emoji: '🤖' },
    }),
  /无效的助手包格式/,
);

console.log('assistantPackage.test.ts: ok');
