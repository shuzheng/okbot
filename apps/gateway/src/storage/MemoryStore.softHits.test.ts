import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './FileStorage';

/**
 * P2: unpinned candidates never enter injection, but keyword soft hits
 * must bump hits so Phase-2 auto-promote (hits>=2) is reachable.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-mem-soft-hits-'));
const storage = new FileStorage(root);
const bot = storage.createBot({ name: 'SoftHits' });

storage.upsertMemory('bot', {
  id: 'cand_coffee',
  bot_id: bot.id,
  memory: '用户喜欢喝美式咖啡',
  expires: null,
  tier: 'candidate',
  hits: 0,
  createdAt: new Date().toISOString(),
});
storage.upsertMemory('bot', {
  id: 'dur_office',
  bot_id: bot.id,
  memory: '办公地点在上海',
  expires: null,
  tier: 'durable',
  hits: 0,
  createdAt: new Date().toISOString(),
});

storage.formatMemoriesForPrompt(bot.id, { query: '美式咖啡', recordHits: true });
storage.formatMemoriesForPrompt(bot.id, { query: '美式咖啡', recordHits: true });

const cand = storage.listBotMemories(bot.id).find((e) => e.id === 'cand_coffee');
const dur = storage.listBotMemories(bot.id).find((e) => e.id === 'dur_office');

assert.equal(cand?.hits, 2, `candidate soft hits must reach 2 (got ${cand?.hits})`);
// After soft hits + read lifecycle, candidate with hits>=2 should promote to durable.
assert.equal(cand?.tier, 'durable', 'soft hits must make auto-promote reachable');
// Durable without keyword match / not selected when query is coffee-only may stay 0,
// or get citation if selected — either way candidate path is the claim under test.
void dur;

console.log('MemoryStore.softHits.test.ts: ok');
