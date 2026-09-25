import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadUsageStats, recordTokenUsage } from './usageStore.js';

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-usage-'));
  const file = path.join(dir, 'usage.json');
  const squadId = 'squad_20260101_001';
  const memberId = 'bot_20260101_001';

  const stats = recordTokenUsage(file, squadId, { input: 10, output: 20, cache: 1 });
  assert.equal(stats.lifetime.input, 10);
  assert.equal(stats.lifetime.output, 20);
  assert.equal(stats.byOwner[squadId]?.input, 10);
  // Squad aggregate only — members are not required in byOwner for squad turns.
  assert.equal(stats.byOwner[memberId], undefined);

  const again = loadUsageStats(file);
  assert.equal(again.byOwner[squadId]?.output, 20);
  assert.equal(Object.keys(again.byOwner).join(','), squadId);

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('usageStore.test.ts: ok');
