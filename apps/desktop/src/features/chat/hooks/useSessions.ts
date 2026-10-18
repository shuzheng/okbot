import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Bot, Squad } from '@okbot/shared';
import type { Selection, SessionItem } from '../../../types';
import { saveLastSelection } from '../../sidebar';
import { SESSION_AVATAR_IDLE_MS } from '../../../utils/sessionAvatarMotion';

/**
 * Roster + selection + unread helpers.
 * Keep bots/squads here so session list / unread / selection races share one owner.
 */
export function useSessions() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  /** ownerId → last open/interact timestamp (ms). Drives sidebar 3D avatar 闲/静止. */
  const [sessionInteractedAt, setSessionInteractedAt] = useState<Record<string, number>>({});
  /** Coarse clock so 1-minute idle → 静止 without per-row timers. */
  const [avatarMotionNow, setAvatarMotionNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setAvatarMotionNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const touchSessionInteraction = useCallback((ownerId: string) => {
    if (!ownerId) return;
    const t = Date.now();
    setSessionInteractedAt((prev) => {
      if (prev[ownerId] === t) return prev;
      return { ...prev, [ownerId]: t };
    });
    setAvatarMotionNow(t);
  }, []);

  const markSessionUnread = (ownerId: string, hasUnread: boolean) => {
    if (!ownerId) return;
    if (ownerId.startsWith('squad_')) {
      setSquads((prev) =>
        prev.map((s) => {
          if (s.id !== ownerId) return s;
          if ((s.hasUnreadReply === true) === hasUnread) return s;
          const next = { ...s };
          if (hasUnread) next.hasUnreadReply = true;
          else delete next.hasUnreadReply;
          return next;
        }),
      );
    } else {
      setBots((prev) =>
        prev.map((b) => {
          if (b.id !== ownerId) return b;
          if ((b.hasUnreadReply === true) === hasUnread) return b;
          const next = { ...b };
          if (hasUnread) next.hasUnreadReply = true;
          else delete next.hasUnreadReply;
          return next;
        }),
      );
    }
    void window.okbot.setChatUnread(ownerId, hasUnread);
  };

  const clearUnreadForSelection = (sel: Selection) => {
    if (!sel) return;
    markSessionUnread(sel.id, false);
  };

  const selectSession = (next: Selection) => {
    setSelection(next);
    if (next) {
      clearUnreadForSelection(next);
      touchSessionInteraction(next.id);
    }
  };

  const sessionHasUnread = useCallback(
    (ownerId: string) => {
      if (ownerId.startsWith('squad_')) {
        return !!squads.find((s) => s.id === ownerId)?.hasUnreadReply;
      }
      return !!bots.find((b) => b.id === ownerId)?.hasUnreadReply;
    },
    [bots, squads],
  );

  // Sort key is owner.updatedAt, which touchBot/touchSquad bump on chat messages only.
  // Profile edits must not change updatedAt (see RosterStore.updateBot/updateSquad).
  const sessions = useMemo(() => {
    const items: SessionItem[] = [
      ...bots.map((bot) => ({ kind: 'bot' as const, bot, updatedAt: bot.updatedAt })),
      ...squads.map((squad) => ({ kind: 'squad' as const, squad, updatedAt: squad.updatedAt })),
    ];
    items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return items;
  }, [bots, squads]);

  const persistSelection = (sel: Selection) => {
    setSelection(sel);
    saveLastSelection(sel);
    if (sel) touchSessionInteraction(sel.id);
  };

  return {
    bots,
    setBots,
    squads,
    setSquads,
    selection,
    setSelection,
    selectSession,
    markSessionUnread,
    clearUnreadForSelection,
    sessionHasUnread,
    sessions,
    persistSelection,
    sessionInteractedAt,
    avatarMotionNow,
    touchSessionInteraction,
    /** Exported for tests / docs — idle threshold for 静止. */
    sessionAvatarIdleMs: SESSION_AVATAR_IDLE_MS,
  };
}
