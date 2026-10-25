import { useEffect, type RefObject } from 'react';
import { updateScrollFade } from '../utils/scrollFade';
import { isWindowResizing, subscribeWindowResizeGate } from '../utils/windowResizeGate';

export function useScrollFade(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      // Mask-image toggles are expensive during live window resize; defer to settle.
      if (isWindowResizing()) return;
      updateScrollFade(el);
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    const mo =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(sync)
        : null;
    const observe = () => {
      ro?.observe(el);
      mo?.observe(el, { childList: true, subtree: true, characterData: true });
    };
    const disconnect = () => {
      ro?.disconnect();
      mo?.disconnect();
    };
    // While the window edge is dragged, drop observers entirely so Chromium
    // resize does not pay for N JS callbacks that only early-return.
    let watching = !isWindowResizing();
    if (watching) observe();
    const unsubResize = subscribeWindowResizeGate(() => {
      if (!watching) {
        watching = true;
        observe();
      }
      sync();
    });
    const onWinResize = () => {
      if (!isWindowResizing()) return;
      if (!watching) return;
      watching = false;
      disconnect();
    };
    window.addEventListener('resize', onWinResize);
    return () => {
      el.removeEventListener('scroll', sync);
      window.removeEventListener('resize', onWinResize);
      disconnect();
      unsubResize();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
