import assert from 'node:assert/strict';
import {
  MEMORY_DECAY_ZERO_HIT_MS,
  MEMORY_PROMOTE_MIN_HITS,
  type MemoryEntry,
} from '@okbot/shared';
import { consolidateMemoryFile } from './memoryConsolidate';

const old = new Date(Date.now() - MEMORY_DECAY_ZERO_HIT_MS - 60_000).toISOString();

{
  const input: MemoryEntry[] = [
    {
      id: 'c1',
      bot_id: 'b1',
      memory: '候选应提升',
      expires: null,
      tier: 'candidate',
      hits: MEMORY_PROMOTE_MIN_HITS,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'd1',
      bot_id: 'b1',
      memory: '零命中应降级',
      expires: null,
      tier: 'durable',
      hits: 0,
      createdAt: old,
    },
    {
      id: 'p1',
      bot_id: 'b1',
      memory: '置顶不降级',
      expires: null,
      tier: 'durable',
      hits: 0,
      pinned: true,
      createdAt: old,
    },
  ];
  const { entries, changed } = consolidateMemoryFile(input);
  assert.equal(changed, true);
  assert.equal(entries.find((e) => e.id === 'c1')!.tier, 'durable');
  assert.equal(entries.find((e) => e.id === 'd1')!.tier, 'candidate');
  assert.equal(entries.find((e) => e.id === 'p1')!.tier, 'durable');
  assert.equal(entries.find((e) => e.id === 'p1')!.pinned, true);
}

console.log('memoryConsolidate.test.ts: ok');
