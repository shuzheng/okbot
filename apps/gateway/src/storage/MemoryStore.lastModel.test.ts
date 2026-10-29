import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionSummary } from '@okbot/shared';
import { FileStorage } from './FileStorage';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-last-model-'));
const storage = new FileStorage(root);
const bot = storage.createBot({ name: 'ModelSwitch' });

assert.equal(storage.readLastEffectiveModel(bot.id), null);
assert.equal(storage.readSessionSummary(bot.id), null);

storage.writeLastEffectiveModel(bot.id, 'http://example/v1\nmodel-a');
assert.equal(storage.readLastEffectiveModel(bot.id), 'http://example/v1\nmodel-a');
// No real summary yet → compress path still sees null.
assert.equal(storage.readSessionSummary(bot.id), null);

const entry: SessionSummary = {
  summary: '目标：\n继续\n',
  coveredThroughId: 'm0',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
storage.writeSessionSummary(bot.id, entry);
// writeSessionSummary preserves previously seeded lastEffectiveModel.
assert.equal(storage.readLastEffectiveModel(bot.id), 'http://example/v1\nmodel-a');
assert.equal(storage.readSessionSummary(bot.id)?.lastEffectiveModel, 'http://example/v1\nmodel-a');

storage.writeLastEffectiveModel(bot.id, 'http://example/v1\nmodel-b');
assert.equal(storage.readLastEffectiveModel(bot.id), 'http://example/v1\nmodel-b');
const after = storage.readSessionSummary(bot.id);
assert.ok(after?.summary.trim().startsWith('目标'));
assert.equal(after?.coveredThroughId, 'm0');
assert.equal(after?.lastEffectiveModel, 'http://example/v1\nmodel-b');

// Blank key is a no-op.
storage.writeLastEffectiveModel(bot.id, '   ');
assert.equal(storage.readLastEffectiveModel(bot.id), 'http://example/v1\nmodel-b');

fs.rmSync(root, { recursive: true, force: true });
console.log('MemoryStore.lastModel.test.ts: ok');
