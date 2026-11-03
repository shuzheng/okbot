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


{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-usage-dbo-'));
  const file = path.join(dir, 'usage.json');
  const botA = 'bot_a';
  const botB = 'bot_b';
  recordTokenUsage(file, botA, { input: 3, output: 1, cache: 0 });
  recordTokenUsage(file, botB, { input: 7, output: 2, cache: 1 });
  const stats = loadUsageStats(file);
  const day = Object.keys(stats.daily)[0];
  assert.ok(day);
  assert.equal(stats.dailyByOwner[botA]?.[day!]?.input, 3);
  assert.equal(stats.dailyByOwner[botB]?.[day!]?.input, 7);
  assert.equal(stats.daily[day!]?.input, 10);
  fs.rmSync(dir, { recursive: true, force: true });
}



{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-usage-model-'));
  const file = path.join(dir, 'usage.json');
  const botId = 'bot_model';
  recordTokenUsage(file, botId, { input: 5, output: 2, cache: 0 }, { modelId: 'gpt-test' });
  recordTokenUsage(file, botId, { input: 1, output: 1, cache: 0 }, { modelId: 'gpt-test' });
  recordTokenUsage(file, botId, { input: 4, output: 0, cache: 0 }, { modelId: 'claude-test' });
  recordTokenUsage(file, botId, { input: 9, output: 0, cache: 0 }); // no modelId → byModel unchanged
  const stats = loadUsageStats(file);
  assert.equal(stats.byModel['gpt-test']?.input, 6);
  assert.equal(stats.byModel['gpt-test']?.output, 3);
  assert.equal(stats.byModel['claude-test']?.input, 4);
  assert.equal(Object.keys(stats.byModel).sort().join(','), 'claude-test,gpt-test');
  assert.equal(stats.lifetime.input, 19);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('usageStore.test.ts: ok');
