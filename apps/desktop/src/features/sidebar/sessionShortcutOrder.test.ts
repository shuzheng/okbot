import assert from 'node:assert/strict';
import { UNGROUPED_OWNER_GROUP_ID, type Bot, type OwnerGroup, type Squad } from '@okbot/shared';
import type { SessionItem } from '../../types';
import {
  computeSessionShortcutOrder,
  sessionShortcutHintLabel,
  sessionShortcutSlots,
} from './sessionShortcutOrder';

function bot(id: string, name: string, updatedAt = '2026-01-01T00:00:00.000Z'): Bot {
  return {
    id,
    name,
    emoji: '🤖',
    color: '#000',
    createdAt: updatedAt,
    updatedAt,
  } as unknown as Bot;
}

function squad(id: string, name: string, updatedAt = '2026-01-01T00:00:00.000Z'): Squad {
  return {
    id,
    name,
    members: [],
    createdAt: updatedAt,
    updatedAt,
  } as unknown as Squad;
}

function asSessions(bots: Bot[], squads: Squad[] = []): SessionItem[] {
  const items: SessionItem[] = [
    ...bots.map((b) => ({ kind: 'bot' as const, bot: b, updatedAt: b.updatedAt })),
    ...squads.map((s) => ({ kind: 'squad' as const, squad: s, updatedAt: s.updatedAt })),
  ];
  items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return items;
}

const g1: OwnerGroup = { id: 'grp_a', name: '新建分组' };
const bPin = bot('bot_pin', 'Grok Bot', '2026-01-04T00:00:00.000Z');
const bOk = bot('bot_ok', 'OkBot', '2026-01-03T00:00:00.000Z');
const bObs = bot('bot_obs', '可观测', '2026-01-02T00:00:00.000Z');
const bPc = bot('bot_pc', '电脑操作助手', '2026-01-01T00:00:00.000Z');
const bHid = bot('bot_hid', 'Hidden', '2025-12-01T00:00:00.000Z');

{
  const sessions = asSessions([bPin, bOk, bObs, bPc, bHid]);
  const ordered = computeSessionShortcutOrder({
    sessions,
    pinnedOwnerIds: ['bot_pin'],
    hiddenOwnerIds: ['bot_hid'],
    ownerGroups: [g1],
    ownerGroupOrder: ['grp_a', UNGROUPED_OWNER_GROUP_ID],
    ownerGroupMembership: { bot_ok: 'grp_a' },
  });
  assert.deepEqual(
    ordered.map((s) => (s.kind === 'bot' ? s.bot.id : s.squad.id)),
    ['bot_pin', 'bot_ok', 'bot_obs', 'bot_pc', 'bot_hid'],
  );
  const slots = sessionShortcutSlots({
    sessions,
    pinnedOwnerIds: ['bot_pin'],
    hiddenOwnerIds: ['bot_hid'],
    ownerGroups: [g1],
    ownerGroupOrder: ['grp_a', UNGROUPED_OWNER_GROUP_ID],
    ownerGroupMembership: { bot_ok: 'grp_a' },
  });
  assert.equal(slots[0]!.pinned, true);
  assert.equal(slots[1]!.pinned, false);
  assert.equal(slots[0]!.digit, 1);
}

{
  // No custom groups: pinned then updatedAt list order (sessions already sorted).
  const sessions = asSessions([
    bot('a', 'A', '2026-01-03T00:00:00.000Z'),
    bot('b', 'B', '2026-01-02T00:00:00.000Z'),
    bot('c', 'C', '2026-01-01T00:00:00.000Z'),
  ]);
  const ordered = computeSessionShortcutOrder({
    sessions,
    pinnedOwnerIds: ['b'],
    hiddenOwnerIds: [],
    ownerGroups: [],
    ownerGroupOrder: [],
    ownerGroupMembership: {},
  });
  assert.deepEqual(
    ordered.map((s) => (s.kind === 'bot' ? s.bot.id : s.squad.id)),
    ['b', 'a', 'c'],
  );
}

{
  // Cap at 9 slots.
  const bots = Array.from({ length: 12 }, (_, i) =>
    bot(`bot_${i}`, `B${i}`, `2026-01-${String(12 - i).padStart(2, '0')}T00:00:00.000Z`),
  );
  const slots = sessionShortcutSlots({
    sessions: asSessions(bots),
    pinnedOwnerIds: [],
    hiddenOwnerIds: [],
    ownerGroups: [],
    ownerGroupOrder: [],
    ownerGroupMembership: {},
  });
  assert.equal(slots.length, 9);
  assert.equal(slots[8]!.digit, 9);
}

assert.equal(sessionShortcutHintLabel(1, 'darwin'), '⌘1');
assert.equal(sessionShortcutHintLabel(2, 'win32'), 'Win+2');
assert.equal(sessionShortcutHintLabel(3, 'linux'), 'Super+3');

console.log('sessionShortcutOrder.test.ts: ok');
