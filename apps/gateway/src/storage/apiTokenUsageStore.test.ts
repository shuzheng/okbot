import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  apiTokenQuotaSnapshot,
  loadApiTokenUsageStats,
  recordApiTokenUsage,
  removeApiTokenUsage,
} from './apiTokenUsageStore.js';
import { checkGatewayApiTokenQuota } from '@okbot/shared';

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-api-token-usage-'));
  const file = path.join(dir, 'api-token-usage.json');
  const tokenId = 'gat_test1';
  const botId = 'bot_a';
  const squadId = 'squad_b';

  recordApiTokenUsage(file, tokenId, botId, {
    messages: 1,
    tokens: { input: 10, output: 20, cache: 0 },
  });
  recordApiTokenUsage(file, tokenId, squadId, {
    messages: 2,
    tokens: { input: 5, output: 5, cache: 1 },
  });

  const stats = loadApiTokenUsageStats(file);
  const bucket = stats.byTokenId[tokenId]!;
  assert.equal(bucket.lifetime.messages, 3);
  assert.equal(bucket.lifetime.tokens.input, 15);
  assert.equal(bucket.byOwner[botId]?.messages, 1);
  assert.equal(bucket.byOwner[squadId]?.messages, 2);

  const snap = apiTokenQuotaSnapshot(bucket);
  assert.equal(snap.lifetimeMessages, 3);
  assert.equal(snap.lifetimeTokens, 15 + 25 + 1); // 41? 15 input + 25 output + 1 cache = 41
  assert.equal(snap.lifetimeTokens, 41);

  const gate = checkGatewayApiTokenQuota({
    limits: { dailyMessages: 3, totalMessages: 0, dailyTokens: 0, totalTokens: 0 },
    ...snap,
    pendingMessages: 1,
  });
  assert.equal(gate.ok, false);

  removeApiTokenUsage(file, tokenId);
  assert.equal(loadApiTokenUsageStats(file).byTokenId[tokenId], undefined);

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('apiTokenUsageStore.test.ts: ok');
