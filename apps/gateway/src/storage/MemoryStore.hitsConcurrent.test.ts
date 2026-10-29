import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './FileStorage';
import { DEFAULT_MAX_PARALLEL_RUNS } from '../ipc/ownerRuns';

/**
 * P2-1 review claim: parallel turns + formatMemoriesForPrompt({recordHits:true})
 * outside maintenance lock → lost hit updates via concurrent RMW.
 *
 * Verdict (FP): MemoryStore mutators are sync; scheduling DEFAULT_MAX_PARALLEL_RUNS
 * overlapping async callers still serializes each full RMW on the event loop, so
 * hits accumulate exactly (no lost updates). No write lock added.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-mem-hits-concurrent-'));
const storage = new FileStorage(root);
const bot = storage.createBot({ name: 'HitsConcurrent' });

storage.upsertMemory('global', {
  id: 'mem_shared',
  bot_id: 'global',
  memory: '用户偏好中文回复',
  expires: null,
  tier: 'durable',
  hits: 0,
  createdAt: new Date().toISOString(),
});
storage.upsertMemory('bot', {
  id: 'mem_local',
  bot_id: bot.id,
  memory: '本助手简体中文',
  expires: null,
  tier: 'durable',
  hits: 0,
  pinned: true,
  createdAt: new Date().toISOString(),
});

assert.ok(DEFAULT_MAX_PARALLEL_RUNS >= 3, 'default parallel turns still >= 3');

const parallel = DEFAULT_MAX_PARALLEL_RUNS;
const before = storage.listGlobalMemories().find((e) => e.id === 'mem_shared');
assert.equal(before?.hits ?? 0, 0);

await Promise.all(
  Array.from({ length: parallel }, async (_, i) => {
    // Yield so all tasks are scheduled before any RMW — mirrors overlapping turns.
    await Promise.resolve();
    storage.formatMemoriesForPrompt(bot.id, {
      query: '中文',
      recordHits: true,
    });
    // Extra yield after: still must not corrupt sibling RMWs already completed.
    await Promise.resolve();
    void i;
  }),
);

const afterGlobal = storage.listGlobalMemories().find((e) => e.id === 'mem_shared');
const afterLocal = storage.listBotMemories(bot.id).find((e) => e.id === 'mem_local');
assert.equal(
  afterGlobal?.hits,
  parallel,
  `global hits must be ${parallel} after ${parallel} parallel recordHits (got ${afterGlobal?.hits})`,
);
assert.equal(
  afterLocal?.hits,
  parallel,
  `bot hits must be ${parallel} after ${parallel} parallel recordHits (got ${afterLocal?.hits})`,
);

// Interleave explicit recordMemoryHits with formatMemories bumps — still exact.
const extra = 5;
await Promise.all(
  Array.from({ length: extra }, async () => {
    await Promise.resolve();
    storage.recordMemoryHits(bot.id, ['mem_shared', 'mem_local']);
  }),
);
assert.equal(storage.listGlobalMemories().find((e) => e.id === 'mem_shared')!.hits, parallel + extra);
assert.equal(storage.listBotMemories(bot.id).find((e) => e.id === 'mem_local')!.hits, parallel + extra);

fs.rmSync(root, { recursive: true, force: true });
console.log('MemoryStore.hitsConcurrent.test.ts: ok (FP — sync RMW, no lock needed)');
