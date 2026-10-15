import assert from 'node:assert/strict';
import {
  botIdFromMentionHref,
  isBotMentionHref,
  linkifyBotMentions,
  mentionHrefForBotId,
  splitBotMentions,
  type MentionBotRef,
} from './botMentions';

const translator: MentionBotRef = {
  id: 'bot-tr',
  name: '翻译助手',
  emoji: '🌐',
  color: '#3366ff',
  avatarKind: 'bot-avatar',
  botAvatarType: 'circle',
};
const shorty: MentionBotRef = {
  id: 'bot-short',
  name: '翻译',
  emoji: '📝',
  color: '',
  avatarKind: 'emoji',
};
const alice: MentionBotRef = {
  id: 'bot-alice',
  name: 'Alice',
  emoji: 'A',
  color: '#111111',
};

assert.equal(isBotMentionHref(mentionHrefForBotId('bot-tr')), true);
assert.equal(botIdFromMentionHref(mentionHrefForBotId('bot-tr')), 'bot-tr');
assert.equal(isBotMentionHref('https://example.com'), false);

{
  const segs = splitBotMentions('请找 @翻译助手 帮忙', [translator, shorty]);
  assert.equal(segs.length, 3);
  assert.equal(segs[0]?.kind, 'text');
  assert.equal(segs[0]?.kind === 'text' && segs[0].text, '请找 ');
  assert.equal(segs[1]?.kind, 'mention');
  assert.equal(segs[1]?.kind === 'mention' && segs[1].bot.id, 'bot-tr');
  assert.equal(segs[1]?.kind === 'mention' && segs[1].raw, '@翻译助手');
  assert.equal(segs[2]?.kind === 'text' && segs[2].text, ' 帮忙');
}

{
  // Longest name wins over shorter prefix.
  const segs = splitBotMentions('@翻译助手', [shorty, translator]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0]?.kind === 'mention' && segs[0].bot.id, 'bot-tr');
}

{
  const segs = splitBotMentions('ping @bot-alice please', [alice]);
  assert.equal(segs.some((s) => s.kind === 'mention' && s.bot.id === 'bot-alice'), true);
}

{
  // Do not false-positive on emails.
  const segs = splitBotMentions('联系 user@Alice.com 或 me@bot-alice', [alice]);
  assert.equal(segs.every((s) => s.kind === 'text'), true);
}

{
  const segs = splitBotMentions('no bots here @nobody', [alice]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0]?.kind, 'text');
}

{
  const out = linkifyBotMentions('向 @翻译助手 求助：\n翻这段', [translator]);
  assert.match(out, /\[@翻译助手\]\(okbot-mention:bot-tr\)/);
  assert.match(out, /翻这段/);
}

{
  const md = 'code `@翻译助手` and\n```\n@翻译助手\n```\nok @翻译助手';
  const out = linkifyBotMentions(md, [translator]);
  assert.match(out, /`@翻译助手`/);
  assert.match(out, /```\n@翻译助手\n```/);
  assert.match(out, /ok \[@翻译助手\]\(okbot-mention:bot-tr\)/);
}



{
  // Fullwidth ＠
  const segs = splitBotMentions('请找＠翻译助手帮忙', [translator]);
  assert.equal(segs.some((s) => s.kind === 'mention' && s.bot.id === 'bot-tr'), true);
}

{
  // Chinese book-title quotes around roster name
  const segs = splitBotMentions('已请「翻译助手」处理', [translator, shorty]);
  assert.equal(segs.length, 3);
  assert.equal(segs[0]?.kind === 'text' && segs[0].text, '已请');
  assert.equal(segs[1]?.kind === 'mention' && segs[1].bot.id, 'bot-tr');
  assert.equal(segs[1]?.kind === 'mention' && segs[1].raw, '「翻译助手」');
  assert.equal(segs[2]?.kind === 'text' && segs[2].text, '处理');
}

{
  // 「」 must be exact roster key — do not chip arbitrary quotes
  const segs = splitBotMentions('他说「你好」', [translator]);
  assert.equal(segs.every((s) => s.kind === 'text'), true);
}

{
  const out = linkifyBotMentions('请「翻译助手」看一下', [translator]);
  assert.match(out, /\[@翻译助手\]\(okbot-mention:bot-tr\)/);
}

console.log('botMentions.test.ts: ok');
