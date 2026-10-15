import { useCallback, useRef, useState, type AnimationEvent } from 'react';

/** Match `.form-drawer` slide duration (okbot-drawer-in / okbot-drawer-out). */
export const DRAWER_ANIM_MS = 200;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Slide-out + delayed unmount for right form drawers.
 * Call `requestClose` instead of the parent's onClose; fire parent only after
 * the out animation ends (or immediately when reduced-motion).
 */
export function useDrawerClose(onClosed: () => void) {
  const [closing, setClosing] = useState(false);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const finishedRef = useRef(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onClosedRef.current();
  }, []);

  const requestClose = useCallback(() => {
    if (closing || finishedRef.current) return;
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    setClosing(true);
  }, [closing, finish]);

  const onDrawerAnimationEnd = useCallback(
    (e: AnimationEvent<HTMLElement>) => {
      if (!closing) return;
      // Ignore bubbled animations from children (emoji picker, etc.).
      if (e.target !== e.currentTarget) return;
      finish();
    },
    [closing, finish],
  );

  return { closing, requestClose, onDrawerAnimationEnd };
}
