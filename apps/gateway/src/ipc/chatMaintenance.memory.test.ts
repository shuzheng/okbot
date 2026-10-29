/**
 * Memory upsert trusts model entries: no containment dedupe, no quality heuristics.
 */
import assert from 'node:assert/strict';
import type { MemoryEntry } from '@okbot/shared';
import { upsertBotMemoriesFromEntries } from './chatMaintenance';

type Row = MemoryEntry;

function fakeStorage(seed: { global?: Row[]; bot?: Row[] }) {
  const global = [...(seed.global || [])];
  const bot = [...(seed.bot || [])];
  const written: Array<{ scope: 'global' | 'bot'; entry: Row }> = [];
  return {
    storage: {
      listGlobalMemories: () => global,
      listBotMemories: () => bot,
      upsertMemory(scope: 'global' | 'bot', entry: Row) {
        written.push({ scope, entry });
        if (scope === 'global') global.push(entry);
        else bot.push(entry);
      },
      readSessionSummary: () => null,
      getSettings: () => ({ memory: { scopeInstruction: '' }, maintenance: { memoryEveryTurns: 2 } }),
    } as any,
    written,
  };
}

{
  const { storage, written } = fakeStorage({
    bot: [
      {
        id: 'mem_old',
        bot_id: 'b1',
        memory: '回复用中文并且简短一些',
        expires: null,
      },
    ],
  });
  // Containment vs existing must NOT drop model output.
  upsertBotMemoriesFromEntries(storage, 'b1', [
    { scope: 'bot', memory: '回复用中文并且简短', expires: null },
    { scope: 'bot', memory: '用户偏好晚上不打扰', expires: null },
  ]);
  assert.equal(written.length, 2);
  assert.equal(written[0]!.entry.memory, '回复用中文并且简短');
  assert.equal(written[1]!.entry.memory, '用户偏好晚上不打扰');
}

{
  const { storage, written } = fakeStorage({});
  // Short / UI-like strings persist if the model returned them; only empty skipped.
  upsertBotMemoriesFromEntries(storage, 'b1', [
    { scope: 'bot', memory: '删除', expires: null },
    { scope: 'bot', memory: '', expires: null },
    { scope: 'bot', memory: '   ', expires: null },
    { scope: 'global', memory: '用户偏好中文回复', expires: null },
  ]);
  assert.equal(written.length, 2);
  assert.equal(written[0]!.scope, 'bot');
  assert.equal(written[0]!.entry.memory, '删除');
  assert.equal(written[1]!.scope, 'global');
  assert.equal(written[1]!.entry.memory, '用户偏好中文回复');
}

console.log('chatMaintenance.memory.test.ts: ok');

{
  // Fresh upserts without preferDurable → candidate tier.
  const { storage, written } = fakeStorage({});
  upsertBotMemoriesFromEntries(storage as any, 'b1', [
    { scope: 'bot', memory: '用户喜欢早起', expires: null },
  ]);
  assert.equal(written[0]!.entry.tier, 'candidate');
  assert.equal(written[0]!.entry.hits, 0);
}

{
  const { storage, written } = fakeStorage({});
  upsertBotMemoriesFromEntries(
    storage as any,
    'b1',
    [{ scope: 'bot', memory: '请记住我叫小明', expires: null }],
    { preferDurable: true },
  );
  assert.equal(written[0]!.entry.tier, 'durable');
}

console.log('chatMaintenance.memory.test.ts: candidate/durable ok');
