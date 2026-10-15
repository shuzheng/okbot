import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * FLIP every list node whose Y changed (session rows + sticky group headers).
 * Pin/unpin shrinks or grows the strip above the list; members already tweened
 * via [data-session-id] — headers must share the same invert so they don't jump.
 */
export function useSessionListFlip(listRef: RefObject<HTMLDivElement | null>, orderKey: string) {
  const prevTops = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll<HTMLElement>('[data-session-id], [data-flip-id]');
    const nextTops = new Map<string, number>();
    nodes.forEach((node) => {
      const id = node.dataset.sessionId ?? node.dataset.flipId;
      if (!id) return;
      // Skip rows inside a collapsed group fold (still in DOM for CSS height anim).
      if (node.closest('.session-group-fold:not(.is-open)')) return;
      node.getAnimations().forEach((a) => a.cancel());
      const top = node.getBoundingClientRect().top;
      nextTops.set(id, top);
      const prev = prevTops.current.get(id);
      if (prev != null) {
        const dy = prev - top;
        if (Math.abs(dy) > 0.5) {
          node.animate(
            [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0px)' }],
            {
              duration: 480,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
              fill: 'both',
            },
          );
        }
      }
    });
    prevTops.current = nextTops;
  }, [listRef, orderKey]);
}
