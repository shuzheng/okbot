import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import type { SessionItem } from '../../types';

const FLIP_MS = 480;
const FLIP_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export type PinStripPhase = 'in' | 'enter' | 'leave';

export type PinStripDisplayItem = {
  item: SessionItem;
  id: string;
  phase: PinStripPhase;
  /** Absolute box relative to the strip (leave only). */
  leaveStyle?: CSSProperties;
};

export function sessionPinId(item: SessionItem): string {
  return item.kind === 'bot' ? `bot:${item.bot.id}` : `squad:${item.squad.id}`;
}

type LeaveRecord = {
  item: SessionItem;
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

type Rect = { left: number; top: number };

function leaveListEqual(a: LeaveRecord[], b: LeaveRecord[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.id === b[i]?.id);
}

/**
 * Pin-strip FLIP: new pins pop/scale in while neighbors squeeze aside;
 * unpin reverses (shrink in place + neighbors close the gap).
 * List/header FLIP stays in useSessionListFlip.
 */
export function usePinStripFlip(pinnedSessions: SessionItem[]): {
  stripRef: RefObject<HTMLDivElement | null>;
  displayItems: PinStripDisplayItem[];
  /** Keep strip tall enough so absolute leave scales aren't clipped by pane. */
  stripStyle?: CSSProperties;
} {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const prevRects = useRef<Map<string, Rect>>(new Map());
  const prevSessionsRef = useRef<SessionItem[]>(pinnedSessions);
  const prevKeyRef = useRef(pinnedSessions.map(sessionPinId).join('|'));
  /** Enter ids for this commit only; cleared in useLayoutEffect (no setState). */
  const pendingEnterRef = useRef<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<LeaveRecord[]>([]);

  const pinnedKey = pinnedSessions.map(sessionPinId).join('|');

  // Same-render adjust while DOM still mirrors the previous pin set.
  if (pinnedKey !== prevKeyRef.current) {
    const prevIds = prevKeyRef.current.split('|').filter(Boolean);
    const nextIds = pinnedKey.split('|').filter(Boolean);
    const nextIdSet = new Set(nextIds);
    const prevIdSet = new Set(prevIds);
    const root = stripRef.current;
    const stripRect = root?.getBoundingClientRect();

    const gone = prevSessionsRef.current.filter((s) => !nextIdSet.has(sessionPinId(s)));
    const nextLeaving: LeaveRecord[] = [];
    if (gone.length && root && stripRect) {
      for (const item of gone) {
        const id = sessionPinId(item);
        const el = root.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(id)}"]`);
        if (!el || el.classList.contains('is-leaving')) continue;
        const r = el.getBoundingClientRect();
        nextLeaving.push({
          item,
          id,
          left: r.left - stripRect.left,
          top: r.top - stripRect.top,
          width: r.width,
          height: r.height,
        });
      }
    }

    const added = nextIds.filter((id) => !prevIdSet.has(id));
    pendingEnterRef.current = new Set(added);

    setLeaving((cur) => {
      const kept = cur.filter((l) => !nextIdSet.has(l.id));
      const goneIds = new Set(nextLeaving.map((l) => l.id));
      const merged = [...kept.filter((l) => !goneIds.has(l.id)), ...nextLeaving];
      return leaveListEqual(cur, merged) ? cur : merged;
    });

    prevKeyRef.current = pinnedKey;
    prevSessionsRef.current = pinnedSessions;
  }

  const pinnedIdSet = new Set(pinnedSessions.map(sessionPinId));
  const displayItems: PinStripDisplayItem[] = [
    ...pinnedSessions.map((item) => {
      const id = sessionPinId(item);
      return {
        item,
        id,
        phase: (pendingEnterRef.current.has(id) ? 'enter' : 'in') as PinStripPhase,
      };
    }),
    ...leaving
      .filter((l) => !pinnedIdSet.has(l.id))
      .map((l) => ({
        item: l.item,
        id: l.id,
        phase: 'leave' as const,
        leaveStyle: {
          position: 'absolute' as const,
          left: l.left,
          top: l.top,
          width: l.width,
          height: l.height,
          margin: 0,
          zIndex: 3,
          pointerEvents: 'none' as const,
        },
      })),
  ];

  useLayoutEffect(() => {
    const root = stripRef.current;
    if (!root) {
      prevRects.current = new Map();
      pendingEnterRef.current = new Set();
      return;
    }

    const nodes = root.querySelectorAll<HTMLElement>('[data-session-id]');
    const nextRects = new Map<string, Rect>();

    nodes.forEach((node) => {
      const id = node.dataset.sessionId;
      if (!id) return;
      node.getAnimations().forEach((a) => a.cancel());

      if (node.classList.contains('is-leaving')) {
        const anim = node.animate(
          [
            { transform: 'scale(1)', opacity: 1 },
            { transform: 'scale(0.35)', opacity: 0 },
          ],
          { duration: FLIP_MS, easing: FLIP_EASE, fill: 'forwards' },
        );
        anim.finished.then(
          () => setLeaving((cur) => cur.filter((l) => l.id !== id)),
          () => {
            /* cancelled */
          },
        );
        return;
      }

      const rect = node.getBoundingClientRect();
      nextRects.set(id, { left: rect.left, top: rect.top });
      const prev = prevRects.current.get(id);
      const isEnter = node.dataset.pinPhase === 'enter';

      if (isEnter) {
        node.animate(
          [
            { transform: 'scale(0.35)', opacity: 0.5 },
            { transform: 'scale(1)', opacity: 1 },
          ],
          { duration: FLIP_MS, easing: FLIP_EASE, fill: 'both' },
        );
        return;
      }

      if (prev != null) {
        const dx = prev.left - rect.left;
        const dy = prev.top - rect.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          node.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: 'translate(0px, 0px)' },
            ],
            { duration: FLIP_MS, easing: FLIP_EASE, fill: 'both' },
          );
        }
      }
    });

    prevRects.current = nextRects;
    pendingEnterRef.current = new Set();
  }, [pinnedKey, leaving]);

  const stripStyle: CSSProperties | undefined =
    leaving.length > 0
      ? {
          minHeight: Math.ceil(Math.max(...leaving.map((l) => l.top + l.height), 0)),
        }
      : undefined;

  return { stripRef, displayItems, stripStyle };
}
