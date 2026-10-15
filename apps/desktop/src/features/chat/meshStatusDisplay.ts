import { meshExchangeChipRef, type ChatMessage, type MeshExchangeMeta } from '@okbot/shared';
import { shouldShowMessageTimeDivider } from '../../utils/formatSessionUpdatedAt';

export type MeshStatusChipRef = { id: string; name: string };

/** Chip subject for a mesh status row in this session. */
export function meshStatusChipRef(
  meta: MeshExchangeMeta,
  sessionOwnerId: string | undefined,
): MeshStatusChipRef {
  if (!sessionOwnerId) {
    return { id: meta.peerBotId, name: meta.peerName || meta.peerBotId };
  }
  return meshExchangeChipRef(meta, sessionOwnerId);
}

export function isMeshReceived(meta: MeshExchangeMeta | undefined): boolean {
  return meta?.direction === 'received';
}

/**
 * Adjacent 「消息来自」 rows from the same assistant collapse in the UI.
 * Same rule as ordinary chat time dividers: a gap strictly greater than
 * MESSAGE_TIME_DIVIDER_GAP_MS (5 minutes) splits the group — do not merge
 * across that boundary (a time separator will show between them).
 * Returns ids to skip (absorbed into a prior group) and group heads keyed by
 * the first message id → count + message to open on click (latest in group).
 */
export function buildMeshReceivedCollapse(
  messages: readonly ChatMessage[],
  sessionOwnerId: string | undefined,
): {
  skipIds: Set<string>;
  groups: Map<string, { count: number; openMessage: ChatMessage; fromId: string }>;
} {
  const skipIds = new Set<string>();
  const groups = new Map<string, { count: number; openMessage: ChatMessage; fromId: string }>();
  if (!sessionOwnerId) return { skipIds, groups };

  let i = 0;
  while (i < messages.length) {
    const m = messages[i]!;
    if (isMeshReceived(m.meshExchange)) {
      const fromId = meshStatusChipRef(m.meshExchange!, sessionOwnerId).id;
      const group: ChatMessage[] = [m];
      let j = i + 1;
      while (j < messages.length) {
        const n = messages[j]!;
        const prev = group[group.length - 1]!;
        if (
          isMeshReceived(n.meshExchange) &&
          meshStatusChipRef(n.meshExchange!, sessionOwnerId).id === fromId &&
          !shouldShowMessageTimeDivider(prev.createdAt, n.createdAt)
        ) {
          group.push(n);
          j += 1;
          continue;
        }
        break;
      }
      if (group.length > 1) {
        const head = group[0]!;
        groups.set(head.id, {
          count: group.length,
          openMessage: group[group.length - 1]!,
          fromId,
        });
        for (let k = 1; k < group.length; k++) {
          skipIds.add(group[k]!.id);
        }
      }
      i = j;
      continue;
    }
    i += 1;
  }
  return { skipIds, groups };
}
