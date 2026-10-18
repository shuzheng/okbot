import {
  UNGROUPED_OWNER_GROUP_ID,
  type OwnerGroup,
} from '@okbot/shared';
import type { SessionItem } from '../../types';

export type SessionShortcutOrderInput = {
  sessions: SessionItem[];
  pinnedOwnerIds: string[];
  hiddenOwnerIds: string[];
  ownerGroups: OwnerGroup[];
  ownerGroupOrder: string[];
  ownerGroupMembership: Record<string, string>;
};

function ownerIdOf(item: SessionItem): string {
  return item.kind === 'bot' ? item.bot.id : item.squad.id;
}

/**
 * Visual top-to-bottom order matching SessionSidebar:
 * pinned strip (pinnedOwnerIds, skipping hidden) →
 * custom groups / 未分组 (ownerGroupOrder; within each group, listSessions order) →
 * 已隐藏 (hiddenOwnerIds order).
 *
 * Collapse state is ignored so Cmd/Win+N stays stable.
 */
export function computeSessionShortcutOrder(
  input: SessionShortcutOrderInput,
): SessionItem[] {
  const {
    sessions,
    pinnedOwnerIds,
    hiddenOwnerIds,
    ownerGroups,
    ownerGroupOrder,
    ownerGroupMembership,
  } = input;

  const sessionsByOwner = new Map<string, SessionItem>();
  for (const item of sessions) {
    sessionsByOwner.set(ownerIdOf(item), item);
  }

  const hiddenIdSet = new Set(hiddenOwnerIds);
  const pinnedIdSet = new Set(pinnedOwnerIds);

  const out: SessionItem[] = [];
  const seen = new Set<string>();

  const push = (item: SessionItem | undefined) => {
    if (!item) return;
    const id = ownerIdOf(item);
    if (seen.has(id)) return;
    seen.add(id);
    out.push(item);
  };

  for (const id of pinnedOwnerIds) {
    if (hiddenIdSet.has(id)) continue;
    push(sessionsByOwner.get(id));
  }

  const listSessions = sessions.filter((item) => {
    const id = ownerIdOf(item);
    return !pinnedIdSet.has(id) && !hiddenIdSet.has(id);
  });

  const showOwnerGroupHeaders = ownerGroups.length > 0;
  if (!showOwnerGroupHeaders) {
    for (const item of listSessions) push(item);
  } else {
    const byId = new Map(ownerGroups.map((g) => [g.id, g]));
    const byGroup = new Map<string, SessionItem[]>();
    for (const g of ownerGroups) byGroup.set(g.id, []);
    const ungrouped: SessionItem[] = [];
    for (const item of listSessions) {
      const id = ownerIdOf(item);
      const gid = ownerGroupMembership[id];
      if (gid && byGroup.has(gid)) {
        byGroup.get(gid)!.push(item);
      } else {
        ungrouped.push(item);
      }
    }
    const order =
      ownerGroupOrder.length > 0
        ? ownerGroupOrder
        : [...ownerGroups.map((g) => g.id), UNGROUPED_OWNER_GROUP_ID];
    const sectionSeen = new Set<string>();
    for (const gid of order) {
      if (sectionSeen.has(gid)) continue;
      sectionSeen.add(gid);
      if (gid === UNGROUPED_OWNER_GROUP_ID) {
        for (const item of ungrouped) push(item);
        continue;
      }
      if (!byId.has(gid)) continue;
      for (const item of byGroup.get(gid) || []) push(item);
    }
    for (const g of ownerGroups) {
      if (sectionSeen.has(g.id)) continue;
      for (const item of byGroup.get(g.id) || []) push(item);
    }
    if (!sectionSeen.has(UNGROUPED_OWNER_GROUP_ID)) {
      for (const item of ungrouped) push(item);
    }
  }

  for (const id of hiddenOwnerIds) {
    push(sessionsByOwner.get(id));
  }

  return out;
}

/** First 9 sessions with 1-based digit index; pinned flag for hint placement. */
export function sessionShortcutSlots(
  input: SessionShortcutOrderInput,
): Array<{ digit: number; item: SessionItem; pinned: boolean }> {
  const pinnedIdSet = new Set(input.pinnedOwnerIds);
  const hiddenIdSet = new Set(input.hiddenOwnerIds);
  const ordered = computeSessionShortcutOrder(input).slice(0, 9);
  return ordered.map((item, i) => {
    const id = ownerIdOf(item);
    const pinned = pinnedIdSet.has(id) && !hiddenIdSet.has(id);
    return { digit: i + 1, item, pinned };
  });
}

export function sessionShortcutHintLabel(
  digit: number,
  platform: string | null | undefined,
): string {
  const n = String(digit);
  if (platform === 'darwin') return `⌘${n}`;
  if (platform === 'win32') return `Win+${n}`;
  // Linux / unknown: Meta is Super; show Win-style for consistency with Meta binding.
  return `Win+${n}`;
}
