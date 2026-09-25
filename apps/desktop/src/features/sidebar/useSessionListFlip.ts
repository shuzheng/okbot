import { useLayoutEffect, useRef, type RefObject } from 'react';

/** FLIP every session row whose Y changed (pin-to-top and rows shifting down). */
export function useSessionListFlip(listRef: RefObject<HTMLDivElement | null>, orderKey: string) {
  const prevTops = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll<HTMLElement>('[data-session-id]');
    const nextTops = new Map<string, number>();
    nodes.forEach((node) => {
      const id = node.dataset.sessionId;
      if (!id) return;
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
