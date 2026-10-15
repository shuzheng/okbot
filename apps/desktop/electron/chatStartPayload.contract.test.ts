/**
 * Contract: chatStart body/payload field sets must stay aligned across
 * preload IPC, HTTP bridge, gateway boot JS, and shared CHAT_START_* keys.
 * Fails if any bridge omits a required field the others send.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHAT_START_BODY_KEYS,
  CHAT_START_PAYLOAD_KEYS,
  buildChatStartBody,
  buildChatStartPayload,
  pickChatStartFields,
} from '@okbot/shared';
import { gatewayBootJs } from './gatewayLoginPage';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const REQUIRED_BODY = ['text', 'quoteMessageId', 'attachments', 'computerId', 'clientTurnId'] as const;
const REQUIRED_IPC = ['botId', 'squadId', ...REQUIRED_BODY] as const;

assert.deepEqual([...CHAT_START_BODY_KEYS], [...REQUIRED_BODY]);
assert.deepEqual([...CHAT_START_PAYLOAD_KEYS], [...REQUIRED_IPC]);

const opts = {
  quoteMessageId: 'm1',
  attachments: [{ kind: 'file' as const, path: '/tmp/a', name: 'a' }],
  computerId: 'local',
  clientTurnId: 'turn_1',
};

const body = buildChatStartBody('hi', opts);
for (const key of CHAT_START_BODY_KEYS) {
  assert.ok(key in body, `buildChatStartBody missing ${key}`);
}
assert.equal(body.text, 'hi');
assert.equal(body.clientTurnId, 'turn_1');

const ipcBot = buildChatStartPayload({ botId: 'b1' }, 'hi', opts);
const ipcSquad = buildChatStartPayload({ squadId: 's1' }, 'hi', opts);
for (const key of ['text', 'quoteMessageId', 'attachments', 'computerId', 'clientTurnId'] as const) {
  assert.ok(key in ipcBot, `IPC bot payload missing ${key}`);
  assert.ok(key in ipcSquad, `IPC squad payload missing ${key}`);
}
assert.equal(ipcBot.botId, 'b1');
assert.equal(ipcSquad.squadId, 's1');
assert.deepEqual(pickChatStartFields(opts).clientTurnId, 'turn_1');

// preload must call buildChatStartPayload (single source for IPC keys).
const preload = readFileSync(join(root, 'electron/preload.ts'), 'utf8');
assert.match(preload, /buildChatStartPayload/);
assert.match(preload, /chatStart:\s*\([^)]*\)\s*=>\s*[\s\S]*buildChatStartPayload\(\{\s*botId/);
assert.match(preload, /chatStartSquad:\s*\([^)]*\)\s*=>\s*[\s\S]*buildChatStartPayload\(\{\s*squadId/);

// HTTP bridge must call buildChatStartBody.
const httpBridge = readFileSync(join(root, 'src/bridge/httpOkbot.ts'), 'utf8');
assert.match(httpBridge, /buildChatStartBody\(text,\s*opts\)/);
assert.equal(
  (httpBridge.match(/buildChatStartBody\(text,\s*opts\)/g) || []).length,
  2,
  'httpOkbot must use buildChatStartBody for bot and squad',
);

// Gateway boot JS embeds CHAT_START_BODY_KEYS and uses buildChatStartBody.
const boot = gatewayBootJs();
for (const key of CHAT_START_BODY_KEYS) {
  assert.ok(
    boot.includes(`"${key}"`) || boot.includes(`'${key}'`),
    `gateway boot JS missing body key ${key}`,
  );
}
assert.match(boot, /function buildChatStartBody\s*\(/);
assert.match(boot, /chatStart:function\(botId,\s*text,\s*opts\)\{\s*return postChat\([^,]+,\s*buildChatStartBody\(text,\s*opts\)\)/);
assert.match(boot, /chatStartSquad:function\(squadId,\s*text,\s*opts\)\{\s*return postChat\([^,]+,\s*buildChatStartBody\(text,\s*opts\)\)/);

// localHttpApi must parse via normalizeChatStartPayload.
const localApi = readFileSync(join(root, 'electron/localHttpApi.ts'), 'utf8');
assert.match(localApi, /normalizeChatStartPayload\(parsed\)/);

console.log('chatStartPayload.contract.test.ts: ok');
