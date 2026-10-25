import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './FileStorage';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-mem-expiry-'));
const storage = new FileStorage(root);
const memFile = path.join(storage.dataRoot, 'memory.md');

const past = new Date(Date.now() - 60_000).toISOString();
const future = new Date(Date.now() + 86_400_000).toISOString();

fs.mkdirSync(path.dirname(memFile), { recursive: true });
fs.writeFileSync(
  memFile,
  [
    '# OkBot Memory',
    '# 每行一条 JSON：id / bot_id / memory / expires（ISO 或 null）',
    '',
    JSON.stringify({
      id: 'mem_dead',
      bot_id: 'global',
      memory: '临时：昨晚计划已过期应被清理',
      expires: past,
    }),
    JSON.stringify({
      id: 'mem_live',
      bot_id: 'global',
      memory: '用户偏好中文回复',
      expires: null,
    }),
    JSON.stringify({
      id: 'mem_soon',
      bot_id: 'global',
      memory: '下周出差提醒仍有效',
      expires: future,
    }),
    JSON.stringify({
      id: 'mem_legacy',
      bot_id: 'global',
      memory: '旧条目无 expires 字段视为永久',
    }),
    '',
  ].join('\n'),
  'utf8',
);

const listed = storage.listGlobalMemories();
const ids = listed.map((e) => e.id).sort();
assert.deepEqual(ids, ['mem_legacy', 'mem_live', 'mem_soon']);
assert.equal(listed.find((e) => e.id === 'mem_live')!.expires, null);
assert.equal(listed.find((e) => e.id === 'mem_legacy')!.expires, null);
assert.equal(listed.find((e) => e.id === 'mem_soon')!.expires, future);

// Lazy purge: expired row removed from disk on load.
const disk = fs.readFileSync(memFile, 'utf8');
assert.ok(!disk.includes('mem_dead'), 'expired row purged from memory.md');
assert.ok(disk.includes('mem_live'));
assert.ok(disk.includes('mem_soon'));
assert.ok(disk.includes('mem_legacy'));

// Second load is stable (no further rewrite needed for content).
const listed2 = storage.listGlobalMemories();
assert.deepEqual(
  listed2.map((e) => e.id).sort(),
  ['mem_legacy', 'mem_live', 'mem_soon'],
);

fs.rmSync(root, { recursive: true, force: true });
console.log('MemoryStore.expiry.test.ts: ok');
