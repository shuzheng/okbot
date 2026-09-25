import { useEffect, type RefObject } from 'react';
import { updateScrollFade } from '../utils/scrollFade';

export function useScrollFade(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => updateScrollFade(el);
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    // children size changes (session list / messages)
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(sync) : null;
    mo?.observe(el, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', sync);
    return () => {
      el.removeEventListener('scroll', sync);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', sync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
