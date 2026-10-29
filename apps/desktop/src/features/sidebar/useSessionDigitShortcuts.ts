import { useEffect, useMemo, useRef, useState } from 'react';
import type { OwnerGroup } from '@okbot/shared';
import type { Selection, SessionItem } from '../../types';
import {
  sessionShortcutHintLabel,
  sessionShortcutSlots,
  type SessionShortcutOrderInput,
} from './sessionShortcutOrder';

const LONG_PRESS_MS = 500;

export type SessionDigitShortcutMap = Record<
  string,
  { digit: number; pinned: boolean; label: string }
>;

function ownerIdOf(item: SessionItem): string {
  return item.kind === 'bot' ? item.bot.id : item.squad.id;
}

function selectionOf(item: SessionItem): NonNullable<Selection> {
  return item.kind === 'bot'
    ? { kind: 'bot', id: item.bot.id }
    : { kind: 'squad', id: item.squad.id };
}

/**
 * Window-focused Cmd/Win+1..9 session switcher + long-press modifier hints.
 * Uses Meta (⌘ on macOS, Win on Windows). Does not register global shortcuts.
 */
export function useSessionDigitShortcuts(opts: {
  enabled: boolean;
  platform: string | null;
  sessions: SessionItem[];
  pinnedOwnerIds: string[];
  hiddenOwnerIds: string[];
  ownerGroups: OwnerGroup[];
  ownerGroupOrder: string[];
  ownerGroupMembership: Record<string, string>;
  onSelect: (selection: NonNullable<Selection>) => void;
}): { hintsVisible: boolean; hintByOwnerId: SessionDigitShortcutMap } {
  const {
    enabled,
    platform,
    sessions,
    pinnedOwnerIds,
    hiddenOwnerIds,
    ownerGroups,
    ownerGroupOrder,
    ownerGroupMembership,
    onSelect,
  } = opts;

  const [hintsVisible, setHintsVisible] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaDown = useRef(false);
  const chordUsed = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const orderInput: SessionShortcutOrderInput = useMemo(
    () => ({
      sessions,
      pinnedOwnerIds,
      hiddenOwnerIds,
      ownerGroups,
      ownerGroupOrder,
      ownerGroupMembership,
    }),
    [
      sessions,
      pinnedOwnerIds,
      hiddenOwnerIds,
      ownerGroups,
      ownerGroupOrder,
      ownerGroupMembership,
    ],
  );

  const slots = useMemo(() => sessionShortcutSlots(orderInput), [orderInput]);

  const hintByOwnerId = useMemo(() => {
    const map: SessionDigitShortcutMap = {};
    for (const slot of slots) {
      const id = ownerIdOf(slot.item);
      map[id] = {
        digit: slot.digit,
        pinned: slot.pinned,
        label: sessionShortcutHintLabel(slot.digit, platform),
      };
    }
    return map;
  }, [slots, platform]);

  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  useEffect(() => {
    if (!enabled) {
      setHintsVisible(false);
      return;
    }

    const clearLongPress = () => {
      if (longPressTimer.current != null) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };

    const hideHints = () => {
      clearLongPress();
      setHintsVisible(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Meta = ⌘ (mac) / Win (windows). Ignore Ctrl-only chords.
      if (e.key === 'Meta') {
        if (metaDown.current) return;
        metaDown.current = true;
        chordUsed.current = false;
        clearLongPress();
        longPressTimer.current = setTimeout(() => {
          longPressTimer.current = null;
          if (metaDown.current && !chordUsed.current) {
            setHintsVisible(true);
          }
        }, LONG_PRESS_MS);
        return;
      }

      if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.repeat) return;
      if (!/^[1-9]$/.test(e.key)) return;
      if (e.isComposing || e.keyCode === 229) return;

      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
        if (target.closest('[role="dialog"], [aria-modal="true"], .modal, .settings-modal')) {
          return;
        }
      }

      const digit = Number(e.key);
      const slot = slotsRef.current.find((s) => s.digit === digit);
      if (!slot) return;

      e.preventDefault();
      e.stopPropagation();
      chordUsed.current = true;
      clearLongPress();
      setHintsVisible(false);
      onSelectRef.current(selectionOf(slot.item));
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Meta') return;
      metaDown.current = false;
      chordUsed.current = false;
      hideHints();
    };

    const onBlur = () => {
      metaDown.current = false;
      chordUsed.current = false;
      hideHints();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      hideHints();
    };
  }, [enabled]);

  return { hintsVisible, hintByOwnerId };
}
