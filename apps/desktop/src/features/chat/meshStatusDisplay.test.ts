import assert from 'node:assert/strict';
import type { ChatMessage } from '@okbot/shared';
import { MESSAGE_TIME_DIVIDER_GAP_MS } from '../../utils/formatSessionUpdatedAt.js';
import {
  buildMeshReceivedCollapse,
  isMeshReceived,
  meshStatusChipRef,
} from './meshStatusDisplay.js';

function msg(
  id: string,
  direction: 'sent' | 'received',
  peerBotId: string,
  callerBotId: string,
  createdAt?: string,
): ChatMessage {
  const at = createdAt ?? new Date().toISOString();
  return {
    id,
    role: 'assistant',
    content: direction === 'sent' ? `已发消息给 ${peerBotId}` : `消息来自 ${peerBotId}`,
    createdAt: at,
    meshExchange: {
      exchangeId: `ex_${id}`,
      peerBotId,
      peerName: peerBotId,
      callerBotId,
      callerName: callerBotId,
      ask: 'task',
      askAt: at,
      direction,
    },
  };
}

{
  const received = msg('r1', 'received', 'bot_b', 'bot_a');
  assert.equal(isMeshReceived(received.meshExchange), true);
  // Caller session: chip = peer
  assert.equal(meshStatusChipRef(received.meshExchange!, 'bot_a').id, 'bot_b');
  // Callee session: chip = caller
  assert.equal(meshStatusChipRef(received.meshExchange!, 'bot_b').id, 'bot_a');
}

{
  const t0 = '2026-10-14T12:00:00.000Z';
  const messages = [
    msg('s1', 'sent', 'bot_b', 'bot_a', t0),
    msg('r1', 'received', 'bot_b', 'bot_a', t0),
    msg('r2', 'received', 'bot_b', 'bot_a', t0),
    msg('r3', 'received', 'bot_b', 'bot_a', t0),
    msg('r4', 'received', 'bot_c', 'bot_a', t0),
  ];
  const { skipIds, groups } = buildMeshReceivedCollapse(messages, 'bot_a');
  assert.equal(groups.get('r1')?.count, 3);
  assert.equal(groups.get('r1')?.openMessage.id, 'r3');
  assert.ok(skipIds.has('r2'));
  assert.ok(skipIds.has('r3'));
  assert.equal(skipIds.has('r1'), false);
  assert.equal(skipIds.has('r4'), false);
  assert.equal(groups.has('r4'), false);
}

// Within ≤5 min gap: still merge (exact 5 min is not a divider)
{
  const t0 = Date.parse('2026-10-14T12:00:00.000Z');
  const messages = [
    msg('r1', 'received', 'bot_b', 'bot_a', new Date(t0).toISOString()),
    msg(
      'r2',
      'received',
      'bot_b',
      'bot_a',
      new Date(t0 + MESSAGE_TIME_DIVIDER_GAP_MS - 1).toISOString(),
    ),
    msg(
      'r3',
      'received',
      'bot_b',
      'bot_a',
      new Date(t0 + MESSAGE_TIME_DIVIDER_GAP_MS).toISOString(),
    ),
  ];
  // r1→r2 under 5m; r2→r3 exactly 1ms under from r2... wait: r3 is at t0+5m,
  // r2 at t0+5m-1, so r2→r3 gap is 1ms → still merge all three.
  const { skipIds, groups } = buildMeshReceivedCollapse(messages, 'bot_a');
  assert.equal(groups.get('r1')?.count, 3);
  assert.equal(groups.get('r1')?.openMessage.id, 'r3');
  assert.ok(skipIds.has('r2'));
  assert.ok(skipIds.has('r3'));
}

// Gap strictly >5 min between adjacent same-peer rows: do not merge across
{
  const t0 = Date.parse('2026-10-14T12:00:00.000Z');
  const messages = [
    msg('r1', 'received', 'bot_b', 'bot_a', new Date(t0).toISOString()),
    msg(
      'r2',
      'received',
      'bot_b',
      'bot_a',
      new Date(t0 + 60_000).toISOString(),
    ),
    msg(
      'r3',
      'received',
      'bot_b',
      'bot_a',
      new Date(t0 + 60_000 + MESSAGE_TIME_DIVIDER_GAP_MS + 1).toISOString(),
    ),
    msg(
      'r4',
      'received',
      'bot_b',
      'bot_a',
      new Date(t0 + 60_000 + MESSAGE_TIME_DIVIDER_GAP_MS + 1 + 30_000).toISOString(),
    ),
  ];
  const { skipIds, groups } = buildMeshReceivedCollapse(messages, 'bot_a');
  // r1+r2 merge; r3+r4 merge; gap between r2 and r3 splits
  assert.equal(groups.get('r1')?.count, 2);
  assert.equal(groups.get('r1')?.openMessage.id, 'r2');
  assert.equal(groups.get('r3')?.count, 2);
  assert.equal(groups.get('r3')?.openMessage.id, 'r4');
  assert.ok(skipIds.has('r2'));
  assert.ok(skipIds.has('r4'));
  assert.equal(skipIds.has('r1'), false);
  assert.equal(skipIds.has('r3'), false);
}

// Exact 5 min gap → still merge (divider requires strictly greater)
{
  const t0 = Date.parse('2026-10-14T12:00:00.000Z');
  const messages = [
    msg('r1', 'received', 'bot_b', 'bot_a', new Date(t0).toISOString()),
    msg(
      'r2',
      'received',
      'bot_b',
      'bot_a',
      new Date(t0 + MESSAGE_TIME_DIVIDER_GAP_MS).toISOString(),
    ),
  ];
  const { skipIds, groups } = buildMeshReceivedCollapse(messages, 'bot_a');
  assert.equal(groups.get('r1')?.count, 2);
  assert.ok(skipIds.has('r2'));
}

console.log('meshStatusDisplay.test.ts: ok');
