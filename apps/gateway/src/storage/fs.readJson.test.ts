import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readJson,
  readJsonResult,
  writeJson,
  isCorruptJson,
  clearCorruptJson,
  resetCorruptJsonFile,
  noteCorruptJson,
  assertJsonWritable,
} from './fs.js';
import { loadUsageStats, recordTokenUsage } from './usageStore.js';
import { FileStorage } from './FileStorage.js';

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-readjson-'));
  const file = path.join(dir, 'broken.json');
  fs.writeFileSync(file, '{not-json', 'utf8');

  const result = readJsonResult<{ x: number }>(file, { x: 0 });
  assert.equal(result.status, 'invalid');
  assert.equal(result.data.x, 0);
  assert.ok(result.status === 'invalid' && result.error);

  // Legacy helper still returns fallback data.
  assert.deepEqual(readJson(file, { x: 1 }), { x: 1 });

  // Original file untouched.
  assert.equal(fs.readFileSync(file, 'utf8'), '{not-json');

  clearCorruptJson(file);
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-corrupt-usage-'));
  const file = path.join(dir, 'usage.json');
  fs.writeFileSync(file, '{"lifetime": BROKEN', 'utf8');
  const before = fs.readFileSync(file, 'utf8');

  const loaded = loadUsageStats(file);
  assert.equal(loaded.lifetime.input, 0);
  assert.equal(isCorruptJson(file), true);
  assert.ok(
    fs.readdirSync(dir).some((n) => n.startsWith('usage.json.corrupt.')),
    'corrupt backup created',
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'original not overwritten by load');

  assert.throws(
    () => recordTokenUsage(file, 'bot_x', { input: 1, output: 2, cache: 0 }),
    /json_corrupt/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'write refused');

  clearCorruptJson(file);
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-corrupt-bots-'));
  const storage = new FileStorage(dir);
  const botsPath = path.join(storage.dataRoot, 'bots.json');
  // Seed a valid bot via API first, then corrupt the roster file.
  const bot = storage.createBot({ name: 'KeepMe' });
  assert.ok(fs.existsSync(botsPath));
  fs.writeFileSync(botsPath, '[not-valid-json', 'utf8');
  const before = fs.readFileSync(botsPath, 'utf8');

  assert.deepEqual(storage.listBots(), []);
  assert.equal(isCorruptJson(botsPath), true);
  assert.throws(() => storage.createBot({ name: 'NewOne' }), /json_corrupt/);
  assert.equal(fs.readFileSync(botsPath, 'utf8'), before);
  // bot dir from first create still exists; roster file not wiped to single entry.
  assert.ok(bot.id);

  clearCorruptJson(botsPath);
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-readjson-ok-'));
  const file = path.join(dir, 'ok.json');
  writeJson(file, { a: 1 });
  const r = readJsonResult<{ a: number }>(file, { a: 0 });
  assert.equal(r.status, 'ok');
  assert.equal(r.data.a, 1);
  const missing = readJsonResult<{ a: number }>(path.join(dir, 'nope.json'), { a: 9 });
  assert.equal(missing.status, 'missing');
  assert.equal(missing.data.a, 9);
  fs.rmSync(dir, { recursive: true, force: true });
}


{
  // Self-heal: fixed on-disk JSON clears corrupt lock without process restart.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-corrupt-heal-'));
  const file = path.join(dir, 'usage.json');
  fs.writeFileSync(file, '{broken', 'utf8');
  noteCorruptJson(file);
  assert.equal(isCorruptJson(file), true);
  assert.throws(() => assertJsonWritable(file), /json_corrupt/);
  fs.writeFileSync(file, JSON.stringify({ lifetime: { input: 0, output: 0, cache: 0 }, daily: {}, byOwner: {}, dailyByOwner: {} }), 'utf8');
  assertJsonWritable(file); // self-heal
  assert.equal(isCorruptJson(file), false);
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // resetCorruptJsonFile restores from *.corrupt.* backup.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-corrupt-reset-'));
  const file = path.join(dir, 'bots.json');
  const good = JSON.stringify([{ id: 'b1', name: 'Keep' }], null, 2);
  fs.writeFileSync(file, good, 'utf8');
  const backup = `${file}.corrupt.2020-01-01T00-00-00-000Z`;
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, '[not-json', 'utf8');
  noteCorruptJson(file);
  const r = resetCorruptJsonFile(file, []);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.restored, 'backup');
    assert.equal(r.backupPath, backup);
  }
  assert.equal(isCorruptJson(file), false);
  assert.equal(fs.readFileSync(file, 'utf8'), good);
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // resetCorruptJsonFile writes fallback when no backup.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-corrupt-fallback-'));
  const file = path.join(dir, 'bots.json');
  fs.writeFileSync(file, '{nope', 'utf8');
  noteCorruptJson(file);
  const r = resetCorruptJsonFile(file, []);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.restored, 'fallback');
  assert.equal(isCorruptJson(file), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), []);
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // resetCorruptJsonFile refuses valid JSON unless force.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-corrupt-refuse-'));
  const file = path.join(dir, 'server.json');
  const good = JSON.stringify({ timezone: 'Asia/Shanghai' }, null, 2);
  fs.writeFileSync(file, good, 'utf8');
  const r = resetCorruptJsonFile(file, {});
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'not_corrupt');
  assert.equal(fs.readFileSync(file, 'utf8'), good);
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // --force on valid JSON: backupAside then write fallback when no .corrupt backup.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-corrupt-force-'));
  const file = path.join(dir, 'server.json');
  const good = JSON.stringify({ timezone: 'Asia/Shanghai' }, null, 2);
  fs.writeFileSync(file, good, 'utf8');
  const r = resetCorruptJsonFile(file, {}, { force: true });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.restored, 'fallback');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {});
  assert.ok(
    fs.readdirSync(dir).some((n) => n.startsWith('server.json.reset-force.')),
    'force backup created',
  );
  fs.rmSync(dir, { recursive: true, force: true });
}


console.log('fs.readJson.test.ts: ok');
