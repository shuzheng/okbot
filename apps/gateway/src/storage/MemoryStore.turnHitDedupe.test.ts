import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './FileStorage';
import {
  buildMeshPeerSpecs,
  buildSquadMemberSpecs,
} from '../ipc/chatTurnHelpers';

/**
 * P1/P2: squad/mesh must not bump hits for every seat at roster build;
 * global + bot-local ids must bump at most once per turn (same-seat
 * re-resolve / HITL rebuild must not double-bump soft hits); query enables soft hits.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-mem-turn-dedupe-'));
const storage = new FileStorage(root);
const a = storage.createBot({ name: 'Alice' });
const b = storage.createBot({ name: 'Bob' });
const squad = storage.createSquad({
  name: 'S',
  members: [{ botId: a.id }, { botId: b.id }],
});

storage.upsertMemory('global', {
  id: 'g_shared',
  bot_id: 'global',
  memory: '用户偏好中文回复',
  expires: null,
  tier: 'durable',
  hits: 0,
  pinned: true,
  createdAt: new Date().toISOString(),
});
storage.upsertMemory('bot', {
  id: 'cand_coffee',
  bot_id: a.id,
  memory: '用户喜欢喝美式咖啡',
  expires: null,
  tier: 'candidate',
  hits: 0,
  createdAt: new Date().toISOString(),
});

const recorded = new Set<string>();
const members = buildSquadMemberSpecs(storage, squad, {
  query: '美式咖啡',
  recordedGlobalHitIds: recorded,
});
assert.equal(members.length, 2);
assert.equal(
  storage.listGlobalMemories().find((e) => e.id === 'g_shared')?.hits ?? 0,
  0,
  'roster build must not bump hits',
);

// Only Alice is asked → resolve once
const textA = members[0]!.resolveMemoriesText?.();
assert.ok(textA && textA.includes('g_shared'));
assert.equal(storage.listGlobalMemories().find((e) => e.id === 'g_shared')!.hits, 1);
assert.ok(recorded.has('g_shared'));
const cand = storage.listBotMemories(a.id).find((e) => e.id === 'cand_coffee');
assert.equal(cand?.hits, 1, 'query must soft-hit candidate');

// Bob asked same turn → global must not double-bump
members[1]!.resolveMemoriesText?.();
assert.equal(
  storage.listGlobalMemories().find((e) => e.id === 'g_shared')!.hits,
  1,
  'same-turn global hit must dedupe',
);

// Alice asked again same turn (re-resolve / HITL rebuild) → local soft hit stays 1
members[0]!.resolveMemoriesText?.();
assert.equal(
  storage.listBotMemories(a.id).find((e) => e.id === 'cand_coffee')?.hits,
  1,
  'same-turn local soft hit must not double-bump',
);
assert.equal(
  storage.listGlobalMemories().find((e) => e.id === 'g_shared')!.hits,
  1,
  'same-turn global still 1 after Alice re-resolve',
);

// Mesh: no hits at build; ask-time query selects
const meshRecorded = new Set<string>();
const peers = buildMeshPeerSpecs(storage, a.id, { recordedGlobalHitIds: meshRecorded });
assert.ok(peers.some((p) => p.id === b.id));
const beforeHits = storage.listGlobalMemories().find((e) => e.id === 'g_shared')!.hits ?? 0;
const peerB = peers.find((p) => p.id === b.id)!;
peerB.resolveMemoriesText?.('中文回复');
assert.equal(
  storage.listGlobalMemories().find((e) => e.id === 'g_shared')!.hits,
  beforeHits + 1,
  'mesh ask must record once with task query',
);
// Same peer re-resolve same turn → no second global bump
peerB.resolveMemoriesText?.('中文回复');
assert.equal(
  storage.listGlobalMemories().find((e) => e.id === 'g_shared')!.hits,
  beforeHits + 1,
  'mesh same-turn peer re-resolve must not double-bump global',
);

console.log('MemoryStore.turnHitDedupe.test.ts: ok');
