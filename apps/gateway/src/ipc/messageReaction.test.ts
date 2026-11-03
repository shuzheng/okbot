import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createId, normalizeMessageReaction } from '@okbot/shared';
import { FileStorage } from '../storage/FileStorage.js';
import {
  applyAssistantSendMessage,
  applyEmojiOnlyFinalGuard,
  isEmojiOnlyText,
  planEmojiOnlyAssistantFinal,
  setMessageReaction,
  stripEmojiOnlyAfterReaction,
} from './messageReaction.js';
import type { IpcContext } from './context.js';

{
  assert.equal(normalizeMessageReaction(null), undefined);
  assert.equal(normalizeMessageReaction({ emoji: '👍', from: 'user' })?.emoji, '👍');
  assert.equal(normalizeMessageReaction({ emoji: '', from: 'user' }), undefined);
  assert.equal(normalizeMessageReaction({ emoji: 'x', from: 'nope' }), undefined);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-react-'));
const storage = new FileStorage(dir);
const bot = storage.createBot({ name: 'R' });
const userMsg = {
  id: createId('msg'),
  role: 'user' as const,
  content: 'hello',
  createdAt: new Date().toISOString(),
};
const asstMsg = {
  id: createId('msg'),
  role: 'assistant' as const,
  content: 'hi there',
  createdAt: new Date().toISOString(),
};
storage.appendMessage(bot.id, userMsg);
storage.appendMessage(bot.id, asstMsg);

const events: Array<{ type: string; message?: { reaction?: { emoji: string } } }> = [];
const wakes: Array<{ botId: string; text: string; quoteMessageId: string }> = [];
const ctx = {
  storage,
  sendRuntimeEvent: (e: { type: string }) => {
    events.push(e);
  },
  abortControllers: new Map(),
} as unknown as IpcContext;

const deps = {
  startWake: async (
    _ctx: IpcContext,
    args: { botId: string; text: string; quoteMessageId: string },
  ) => {
    wakes.push(args);
  },
};

const setAsst = await setMessageReaction(
  ctx,
  { botId: bot.id, messageId: userMsg.id, emoji: '❤️', from: 'assistant' },
  deps,
);
assert.equal(setAsst.ok, true);
if (setAsst.ok) {
  assert.equal(setAsst.message.reaction?.emoji, '❤️');
  assert.equal(setAsst.message.reaction?.from, 'assistant');
  assert.equal(setAsst.woke, false);
  assert.equal(setAsst.cleared, false);
}
assert.ok(events.some((e) => e.type === 'message_updated'));
assert.equal(wakes.length, 0);

// Assistant re-assert same emoji → idempotent keep (not user-toggle clear)
const reAsst = await setMessageReaction(
  ctx,
  { botId: bot.id, messageId: userMsg.id, emoji: '❤️', from: 'assistant' },
  deps,
);
assert.equal(reAsst.ok, true);
if (reAsst.ok) {
  assert.equal(reAsst.cleared, false);
  assert.equal(reAsst.message.reaction?.emoji, '❤️');
}

// Assistant explicit empty emoji → clear
const clearAsst = await setMessageReaction(
  ctx,
  { botId: bot.id, messageId: userMsg.id, emoji: '', from: 'assistant' },
  deps,
);
assert.equal(clearAsst.ok, true);
if (clearAsst.ok) {
  assert.equal(clearAsst.cleared, true);
  assert.equal(clearAsst.message.reaction, undefined);
}

const badRole = await setMessageReaction(
  ctx,
  { botId: bot.id, messageId: userMsg.id, emoji: '👍', from: 'user' },
  deps,
);
assert.equal(badRole.ok, false);

const setUser = await setMessageReaction(
  ctx,
  { botId: bot.id, messageId: asstMsg.id, emoji: '👍', from: 'user' },
  deps,
);
assert.equal(setUser.ok, true);
if (setUser.ok) {
  assert.equal(setUser.message.reaction?.emoji, '👍');
  assert.equal(setUser.message.reaction?.from, 'user');
  assert.equal(setUser.woke, true);
  assert.equal(setUser.cleared, false);
}
assert.equal(wakes.length, 1);
assert.equal(wakes[0]!.text, '👍');
assert.equal(wakes[0]!.quoteMessageId, asstMsg.id);

// Change emoji → wake again
const changeUser = await setMessageReaction(
  ctx,
  { botId: bot.id, messageId: asstMsg.id, emoji: '😂', from: 'user' },
  deps,
);
assert.equal(changeUser.ok, true);
if (changeUser.ok) {
  assert.equal(changeUser.woke, true);
  assert.equal(changeUser.message.reaction?.emoji, '😂');
}
assert.equal(wakes.length, 2);

// Same emoji again → clear, no wake
const clearUser = await setMessageReaction(
  ctx,
  { botId: bot.id, messageId: asstMsg.id, emoji: '😂', from: 'user' },
  deps,
);
assert.equal(clearUser.ok, true);
if (clearUser.ok) {
  assert.equal(clearUser.cleared, true);
  assert.equal(clearUser.woke, false);
  assert.equal(clearUser.message.reaction, undefined);
}
assert.equal(wakes.length, 2);

const reloaded = storage.getMessageById(bot.id, asstMsg.id);
assert.equal(reloaded?.reaction, undefined);


assert.equal(isEmojiOnlyText('✅'), true);
assert.equal(isEmojiOnlyText('🤩'), true);
assert.equal(isEmojiOnlyText('好的'), false);
assert.equal(isEmojiOnlyText('✅ 收到'), false);
assert.equal(stripEmojiOnlyAfterReaction('✅', ['✅']), '');
assert.equal(stripEmojiOnlyAfterReaction('🎋', ['✅']), '');
assert.equal(stripEmojiOnlyAfterReaction('继续推进任务', ['✅']), '继续推进任务');
assert.equal(stripEmojiOnlyAfterReaction('✅', undefined), '✅');

{
  const emitted: string[] = [];
  await applyAssistantSendMessage(
    ctx,
    bot.id,
    { reactToMessageId: userMsg.id, emoji: '✅' },
    async (c) => {
      emitted.push(c);
    },
  );
  assert.equal(emitted.length, 0);
  assert.equal(storage.getMessageById(bot.id, userMsg.id)?.reaction?.emoji, '✅');
}

{
  const emitted: string[] = [];
  await applyAssistantSendMessage(
    ctx,
    bot.id,
    { reactToMessageId: userMsg.id, emoji: '✅', content: '✅' },
    async (c) => {
      emitted.push(c);
    },
  );
  assert.equal(emitted.length, 0, 'same-emoji content must not create a bubble');
}

{
  const emitted: string[] = [];
  await applyAssistantSendMessage(
    ctx,
    bot.id,
    { reactToMessageId: userMsg.id, emoji: '✅', content: '收到，下一步开始调研。' },
    async (c) => {
      emitted.push(c);
    },
  );
  assert.deepEqual(emitted, ['收到，下一步开始调研。']);
}

{
  let threw = false;
  try {
    await applyAssistantSendMessage(
      ctx,
      bot.id,
      { reactToMessageId: userMsg.id },
      async () => {},
    );
  } catch (err) {
    threw = true;
    assert.match(String(err), /emoji_required_for_reaction/);
  }
  assert.equal(threw, true, 'omitting emoji must not clear');
  assert.equal(storage.getMessageById(bot.id, userMsg.id)?.reaction?.emoji, '✅');
}

{
  await applyAssistantSendMessage(
    ctx,
    bot.id,
    { reactToMessageId: userMsg.id, emoji: '' },
    async () => {},
  );
  assert.equal(storage.getMessageById(bot.id, userMsg.id)?.reaction, undefined);
}


// --- next-turn / emoji-only final hardening ---
{
  // Same-turn strip still works via plan
  const plan = planEmojiOnlyAssistantFinal('😎', {
    reactedEmojisThisTurn: ['😎'],
    targetUserMessageId: userMsg.id,
  });
  assert.equal(plan.content, '');
  assert.equal(plan.convertToReaction, undefined);
}

{
  // Duplicate of existing reaction on target → drop (no convert)
  const u2 = {
    id: createId('msg'),
    role: 'user' as const,
    content: '帅',
    createdAt: new Date().toISOString(),
    reaction: { emoji: '😎', from: 'assistant' as const, updatedAt: new Date().toISOString() },
  };
  storage.appendMessage(bot.id, u2);
  const plan = planEmojiOnlyAssistantFinal('😎', {
    targetUserMessageId: u2.id,
    targetReactionEmoji: '😎',
  });
  assert.equal(plan.content, '');
  assert.equal(plan.convertToReaction, undefined);
}

{
  // Next-turn echo of a prior reaction emoji → drop (do not stamp onto new user msg)
  const plan = planEmojiOnlyAssistantFinal('🐶', {
    targetUserMessageId: createId('msg'),
    targetReactionEmoji: null,
    recentReactionEmojis: ['🐶', '🥰'],
  });
  assert.equal(plan.content, '');
  assert.equal(plan.convertToReaction, undefined);
}

{
  // Bare emoji-only with no prior reaction → convert onto target
  const u3 = {
    id: createId('msg'),
    role: 'user' as const,
    content: 'hello emoji',
    createdAt: new Date().toISOString(),
  };
  storage.appendMessage(bot.id, u3);
  const plan = planEmojiOnlyAssistantFinal('🎉', {
    targetUserMessageId: u3.id,
    targetReactionEmoji: null,
    recentReactionEmojis: [],
  });
  assert.equal(plan.content, '');
  assert.deepEqual(plan.convertToReaction, { messageId: u3.id, emoji: '🎉' });
}

{
  // Prose with leading emoji passes through
  const plan = planEmojiOnlyAssistantFinal('🕐 2026年10月31日', {
    reactedEmojisThisTurn: ['😎'],
    recentReactionEmojis: ['😎'],
  });
  assert.equal(plan.content, '🕐 2026年10月31日');
}

{
  // applyEmojiOnlyFinalGuard: next-turn echo drops and does not change new user bubble
  const prior = {
    id: createId('msg'),
    role: 'user' as const,
    content: '听话哦',
    createdAt: new Date().toISOString(),
    reaction: { emoji: '🐶', from: 'assistant' as const, updatedAt: new Date().toISOString() },
  };
  const nextUser = {
    id: createId('msg'),
    role: 'user' as const,
    content: '你是谁',
    createdAt: new Date().toISOString(),
  };
  storage.appendMessage(bot.id, prior);
  storage.appendMessage(bot.id, nextUser);
  const out = await applyEmojiOnlyFinalGuard(ctx, bot.id, '🐶', {
    targetUserMessageId: nextUser.id,
  });
  assert.equal(out, '');
  assert.equal(storage.getMessageById(bot.id, nextUser.id)?.reaction, undefined);
  assert.equal(storage.getMessageById(bot.id, prior.id)?.reaction?.emoji, '🐶');
}

{
  // applyEmojiOnlyFinalGuard: convert bare emoji onto target
  const u4 = {
    id: createId('msg'),
    role: 'user' as const,
    content: 'ack me',
    createdAt: new Date().toISOString(),
  };
  storage.appendMessage(bot.id, u4);
  const out = await applyEmojiOnlyFinalGuard(ctx, bot.id, '👍', {
    targetUserMessageId: u4.id,
  });
  assert.equal(out, '');
  assert.equal(storage.getMessageById(bot.id, u4.id)?.reaction?.emoji, '👍');
  assert.equal(storage.getMessageById(bot.id, u4.id)?.reaction?.from, 'assistant');
}


console.log('messageReaction.test.ts: ok');
