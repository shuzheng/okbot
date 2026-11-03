/**
 * manage_memory host binders: 1:1 bot (global+bot) vs squad (global only).
 */
import assert from 'node:assert/strict';
import type { MemoryEntry } from '@okbot/shared';
import { memoryManageForBot, memoryManageForSquad } from './memoryTool';

type Row = MemoryEntry;

function fakeStorage(seed: { global?: Row[]; bots?: Record<string, Row[]> }) {
  const global = [...(seed.global || [])];
  const bots: Record<string, Row[]> = Object.fromEntries(
    Object.entries(seed.bots || {}).map(([k, v]) => [k, [...v]]),
  );
  const knownBots = new Set(Object.keys(bots));
  const deleted: Array<{ scope: 'global' | 'bot'; botId: string; id: string }> = [];

  const storage = {
    listGlobalMemories: () => global,
    listBotMemories(botId: string) {
      if (!knownBots.has(botId)) throw new Error(`unknown bot: ${botId}`);
      return bots[botId] || [];
    },
    setMemoryPinned(scope: 'global' | 'bot', botId: string, memoryId: string, pinned: boolean) {
      const list = scope === 'global' ? global : bots[botId] || [];
      const row = list.find((e) => e.id === memoryId);
      if (!row) return null;
      row.pinned = pinned;
      if (pinned) row.tier = 'durable';
      return { ...row };
    },
    promoteMemory(scope: 'global' | 'bot', botId: string, memoryId: string) {
      const list = scope === 'global' ? global : bots[botId] || [];
      const row = list.find((e) => e.id === memoryId);
      if (!row) return null;
      row.tier = 'durable';
      return { ...row };
    },
    deleteMemory(scope: 'global' | 'bot', botId: string, memoryId: string) {
      deleted.push({ scope, botId, id: memoryId });
      if (scope === 'global') {
        const i = global.findIndex((e) => e.id === memoryId);
        if (i >= 0) global.splice(i, 1);
      } else {
        const list = bots[botId] || [];
        const i = list.findIndex((e) => e.id === memoryId);
        if (i >= 0) list.splice(i, 1);
      }
    },
  };

  return { storage: storage as any, global, bots, deleted };
}

const globalRow: Row = {
  id: 'mem_g1',
  bot_id: 'global',
  memory: '用户偏好中文回复',
  expires: null,
  tier: 'durable',
  hits: 1,
};

const botRow: Row = {
  id: 'mem_b1',
  bot_id: 'bot_a',
  memory: '喜欢简短回答',
  expires: null,
  tier: 'candidate',
  hits: 0,
};

{
  const { storage } = fakeStorage({ global: [globalRow], bots: { bot_a: [botRow] } });
  const manage = memoryManageForBot(storage, 'bot_a');
  const listed = await manage({ action: 'list', scope: 'bot', include_candidates: true });
  assert.match(listed, /本助手记忆/);
  assert.match(listed, /mem_b1/);
  const pinned = await manage({ action: 'pin', memory_id: 'mem_g1', scope: 'global' });
  assert.match(pinned, /已置顶/);
  assert.match(pinned, /mem_g1/);
}

{
  const { storage, deleted } = fakeStorage({ global: [globalRow], bots: { bot_a: [botRow] } });
  const manage = memoryManageForSquad(storage);

  // Explicit bot scope rejected (squad id must not hit assertKnownBotId).
  const rejectBot = await manage({ action: 'list', scope: 'bot' });
  assert.match(rejectBot, /小队会话不支持助手级记忆/);
  assert.match(rejectBot, /scope=global/);

  // Omitted scope defaults to global.
  const listed = await manage({ action: 'list' });
  assert.match(listed, /全局记忆/);
  assert.match(listed, /mem_g1/);
  assert.doesNotMatch(listed, /mem_b1/);

  const pinned = await manage({ action: 'pin', memory_id: 'mem_g1', scope: 'global' });
  assert.match(pinned, /已置顶/);

  const promoted = await manage({ action: 'promote', memory_id: 'mem_g1' });
  assert.match(promoted, /已提升为耐久/);

  const forgot = await manage({ action: 'forget', memory_id: 'mem_g1', scope: 'global' });
  assert.match(forgot, /已遗忘/);
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0]!.scope, 'global');
  assert.equal(deleted[0]!.id, 'mem_g1');

  // Bot-scope mutate rejected without touching bot store.
  const rejectPin = await manage({ action: 'pin', memory_id: 'mem_b1', scope: 'bot' });
  assert.match(rejectPin, /小队会话不支持助手级记忆/);
}

console.log('memoryTool.test.ts: ok');
