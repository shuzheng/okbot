import assert from 'node:assert/strict';
import { createMeshExchangeHandler } from './chatTurnHelpers.js';
import type { ChatMessage } from '@okbot/shared';

const stores = new Map<string, ChatMessage[]>();
const emitted: Array<{ botId: string; message: ChatMessage }> = [];

function session(id: string): ChatMessage[] {
  let list = stores.get(id);
  if (!list) {
    list = [];
    stores.set(id, list);
  }
  return list;
}

const storage = {
  appendMessage: (id: string, m: ChatMessage) => {
    session(id).push(m);
  },
  patchMessage: (id: string, messageId: string, patch: Partial<ChatMessage>) => {
    const list = session(id);
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx < 0) return null;
    list[idx] = { ...list[idx]!, ...patch };
    return list[idx]!;
  },
  getMessages: (id: string) => [...session(id)],
};

const handler = createMeshExchangeHandler({
  storage,
  emit: (event) => {
    emitted.push({ botId: event.botId, message: event.message });
  },
});

await handler({
  kind: 'ask',
  exchangeId: 'mesh_1',
  peerBotId: 'bot_b',
  peerName: '翻译助手',
  callerBotId: 'bot_a',
  callerName: '主助手',
  content: '请翻译 hello',
});

const aAsk = session('bot_a');
const bAsk = session('bot_b');
assert.equal(aAsk.length, 1);
assert.ok(aAsk[0]!.meshExchange);
assert.equal(aAsk[0]!.meshExchange!.exchangeId, 'mesh_1');
assert.equal(aAsk[0]!.meshExchange!.direction, 'sent');
assert.match(aAsk[0]!.content, /已发消息给/);
assert.equal(aAsk[0]!.speakerBotId, undefined);

assert.equal(bAsk.length, 1);
assert.equal(bAsk[0]!.meshExchange!.direction, 'received');
assert.match(bAsk[0]!.content, /消息来自/);
assert.equal(bAsk[0]!.meshExchange!.callerBotId, 'bot_a');
assert.equal(emitted.length, 2);
assert.equal(emitted[0]!.botId, 'bot_a');
assert.equal(emitted[1]!.botId, 'bot_b');

await handler({
  kind: 'reply',
  exchangeId: 'mesh_1',
  peerBotId: 'bot_b',
  peerName: '翻译助手',
  callerBotId: 'bot_a',
  callerName: '主助手',
  content: '<think>planning</think>\n你好',
});

const aAfter = session('bot_a');
const bAfter = session('bot_b');
assert.equal(aAfter.length, 2); // sent + received-from-peer
assert.equal(aAfter[0]!.meshExchange!.reply, '你好');
assert.ok(aAfter[0]!.meshExchange!.replyAt);
assert.equal(aAfter[0]!.meshExchange!.direction, 'sent');
assert.equal(aAfter[1]!.meshExchange!.direction, 'received');
assert.match(aAfter[1]!.content, /消息来自/);
assert.equal(aAfter[1]!.meshExchange!.reply, '你好');

assert.equal(bAfter.length, 1);
assert.equal(bAfter[0]!.meshExchange!.reply, '你好');
assert.equal(bAfter[0]!.meshExchange!.direction, 'received');

// Nested hop: B asks C — chips must land on B/C only, never bubble into A.
const aBeforeNested = session('bot_a').length;
emitted.length = 0;

await handler({
  kind: 'ask',
  exchangeId: 'mesh_2',
  peerBotId: 'bot_c',
  peerName: '电脑小帮手',
  callerBotId: 'bot_b',
  callerName: '编程助手',
  content: '现在几点？',
});

assert.equal(session('bot_a').length, aBeforeNested, 'ancestor must not get nested ask chip');
const bNestedAsk = session('bot_b');
const cAsk = session('bot_c');
assert.equal(bNestedAsk.length, 2); // prior inbound from A + sent to C
assert.match(bNestedAsk[1]!.content, /已发消息给/);
assert.equal(bNestedAsk[1]!.meshExchange!.peerBotId, 'bot_c');
assert.equal(bNestedAsk[1]!.meshExchange!.direction, 'sent');
assert.equal(cAsk.length, 1);
assert.match(cAsk[0]!.content, /消息来自/);
assert.equal(cAsk[0]!.meshExchange!.callerBotId, 'bot_b');
assert.equal(emitted.map((e) => e.botId).join(','), 'bot_b,bot_c');

await handler({
  kind: 'reply',
  exchangeId: 'mesh_2',
  peerBotId: 'bot_c',
  peerName: '电脑小帮手',
  callerBotId: 'bot_b',
  callerName: '编程助手',
  content: '现在是下午三点',
});

assert.equal(session('bot_a').length, aBeforeNested, 'ancestor must not get nested reply chip');
const bNestedAfter = session('bot_b');
assert.equal(bNestedAfter.length, 3); // inbound A + sent C + received C
assert.equal(bNestedAfter[1]!.meshExchange!.reply, '现在是下午三点');
assert.match(bNestedAfter[2]!.content, /消息来自/);
assert.equal(bNestedAfter[2]!.meshExchange!.peerBotId, 'bot_c');
assert.equal(session('bot_c')[0]!.meshExchange!.reply, '现在是下午三点');

console.log('meshExchangeHandler.test.ts: ok');
