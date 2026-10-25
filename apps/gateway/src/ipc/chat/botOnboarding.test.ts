import assert from 'node:assert/strict';
import type { Bot } from '@okbot/shared';
import {
  applyOnboardingProfile,
  isOnboardingActive,
  onboardingRunExtras,
  resetOnboardingStateForTests,
} from './botOnboarding';
import type { FileStorage } from '../../storage/FileStorage';

const bot = { id: 'bot-1', name: '小码', description: '', onboardingComplete: false } as Bot;
const souls: string[] = [];
const patches: Array<Partial<Bot>> = [];
const storage = {
  listBots: () => [bot],
  getSettings: () => ({ language: 'zh' }),
  writeSoulMd: (_id: string, soul: string) => {
    souls.push(soul);
  },
  updateBot: (_id: string, patch: Partial<Bot>) => {
    patches.push(patch);
    Object.assign(bot, patch);
    return bot;
  },
} as unknown as FileStorage;

resetOnboardingStateForTests();

// Active onboarding: guide + both tools registered.
const extras = onboardingRunExtras(storage, bot, () => {});
assert.ok(extras.onboardingGuide && extras.onboardingGuide.length > 0);
assert.equal(extras.tools.length, 2);

// Description is clamped to 200 chars; SOUL is written as-is.
const msg = applyOnboardingProfile(storage, bot.id, { description: '写'.repeat(300), soul: '# SOUL\n\n角色' });
assert.match(msg, /已保存/);
assert.equal(souls.length, 1);
assert.equal(patches.length, 1);
assert.ok((bot.description || '').length <= 200);

// Unchanged description is not rewritten.
applyOnboardingProfile(storage, bot.id, { description: bot.description });
assert.equal(patches.length, 1);

// done=true closes the guide for the next turn (completion waits for evolution).
applyOnboardingProfile(storage, bot.id, { done: true });
assert.equal(isOnboardingActive(bot), false);
assert.equal(onboardingRunExtras(storage, bot, () => {}).tools.length, 0);
assert.match(applyOnboardingProfile(storage, bot.id, { soul: 'x' }), /已结束/);
assert.equal(souls.length, 1);

resetOnboardingStateForTests();
assert.equal(isOnboardingActive(bot), true);

console.log('botOnboarding.test.ts: ok');
