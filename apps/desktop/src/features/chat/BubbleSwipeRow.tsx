import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { formatMessageClockTime } from '../../utils/formatSessionUpdatedAt';

/** Fallback when `--bubble-swipe-reveal` is unavailable (matches app.css). */
export const BUBBLE_SWIPE_REVEAL_PX = 52;

/** Movement before axis lock / time reveal (px). Higher = less sensitive. */
const AXIS_LOCK_PX = 20;

/** Horizontal must dominate vertical by this factor to claim the gesture. */
const HORIZ_DOMINANCE = 0.85;

/** Idle after last horizontal wheel before spring-back (ms). Keep low so release feels instant. */
const WHEEL_IDLE_MS = 80;

/** Minimum |deltaX| (px, after deltaMode scale) to treat as horizontal. */
const WHEEL_EPS = 0.08;

/** Amplify trackpad/mouse deltaX so a small flick fully reveals HH:MM. */
const WHEEL_GAIN = 10;

/**
 * macOS trackpad / Magic Mouse often emit |deltaX| ≪ 1–3 px per event.
 * Extra boost when the raw horizontal delta is tiny.
 */
const WHEEL_TINY_ABS = 2.5;
const WHEEL_TINY_BOOST = 2.8;

/** Opacity reaches 1 before full reveal so the clock is readable sooner. */
const OPACITY_FULL_AT = 0.28;

type RowHandle = {
  id: string;
  /** Apply shared offset to this row's DOM + React drag/reveal flags. */
  paint: (offset: number, dragging: boolean) => void;
  readMax: () => number;
  host: () => HTMLElement | null;
};

/** All mounted swipe rows — one gesture paints every visible clock together. */
const swipeRows = new Map<string, RowHandle>();

let sharedOffset = 0;
let sharedDragging = false;
let gestureOwnerId: string | null = null;
let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;
let rafId: number | null = null;
let pendingOffset: number | null = null;
/** Accumulated open-direction wheel delta while still inside the activation deadzone. */
let wheelArmAccum = 0;

function clearWheelIdleTimer(): void {
  if (wheelIdleTimer != null) {
    clearTimeout(wheelIdleTimer);
    wheelIdleTimer = null;
  }
}

function cancelRaf(): void {
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  pendingOffset = null;
}

function broadcast(offset: number, dragging: boolean): void {
  sharedOffset = offset;
  sharedDragging = dragging;
  for (const row of swipeRows.values()) {
    row.paint(offset, dragging);
  }
}

/**
 * Spring every row closed. Drop is-dragging on the DOM first (sync) so the CSS
 * transform / time transitions run when offset returns to 0.
 */
function finishAll(): void {
  clearWheelIdleTimer();
  cancelRaf();
  sharedDragging = false;
  for (const row of swipeRows.values()) {
    const host = row.host();
    host?.classList.remove('is-dragging');
    if (host) void host.offsetWidth;
    row.paint(0, false);
  }
  sharedOffset = 0;
  gestureOwnerId = null;
  wheelArmAccum = 0;
}

function scheduleWheelSpringBack(): void {
  clearWheelIdleTimer();
  wheelIdleTimer = setTimeout(() => {
    wheelIdleTimer = null;
    finishAll();
  }, WHEEL_IDLE_MS);
}

function scheduleSharedOffset(next: number, dragging: boolean): void {
  pendingOffset = next;
  sharedDragging = dragging;
  if (rafId == null) {
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const pending = pendingOffset;
      if (pending == null) return;
      pendingOffset = null;
      broadcast(pending, sharedDragging);
    });
  }
}

function registerRow(handle: RowHandle): () => void {
  swipeRows.set(handle.id, handle);
  if (sharedOffset !== 0 || sharedDragging) {
    handle.paint(sharedOffset, sharedDragging);
  }
  return () => {
    swipeRows.delete(handle.id);
    if (gestureOwnerId === handle.id) {
      finishAll();
    }
  };
}

function claimGesture(id: string): void {
  gestureOwnerId = id;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, [role="button"], [role="slider"], [role="menuitem"]',
    ),
  );
}

/** True when an element can scroll on either axis (overflow auto/scroll + overflowed). */
function canScrollOverflow(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  const ox = style.overflowX;
  const oy = style.overflowY;
  const xOk = ox === 'auto' || ox === 'scroll' || ox === 'overlay';
  const yOk = oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  if (xOk && el.scrollWidth > el.clientWidth + 1) return true;
  if (yOk && el.scrollHeight > el.clientHeight + 1) return true;
  return false;
}

/**
 * Wheel over scrollable content inside the bubble (e.g. code blocks):
 * let native scroll win — do not start swipe-to-show-time.
 */
function isOverScrollableInsideHost(
  target: EventTarget | null,
  host: HTMLElement | null,
): boolean {
  if (!(target instanceof Element) || !host) return false;
  let el: Element | null = target;
  while (el && el !== host) {
    if (el instanceof HTMLElement && canScrollOverflow(el)) return true;
    el = el.parentElement;
  }
  return false;
}

function readRevealPx(el: HTMLElement | null): number {
  if (!el) return BUBBLE_SWIPE_REVEAL_PX;
  const raw = getComputedStyle(el).getPropertyValue('--bubble-swipe-reveal').trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : BUBBLE_SWIPE_REVEAL_PX;
}

/** Normalize wheel deltas to CSS pixels. */
function wheelDeltaPx(e: WheelEvent): { dx: number; dy: number } {
  let dx = e.deltaX;
  let dy = e.deltaY;
  if (e.deltaMode === 1) {
    dx *= 16;
    dy *= 16;
  } else if (e.deltaMode === 2) {
    dx *= BUBBLE_SWIPE_REVEAL_PX;
    dy *= BUBBLE_SWIPE_REVEAL_PX;
  }
  return { dx, dy };
}

function opacityForOffset(offset: number, max: number): number {
  const progress = Math.min(1, Math.abs(offset) / Math.max(1, max));
  return Math.min(1, progress / OPACITY_FULL_AT);
}

/** Effective wheel gain — aggressive for tiny macOS trackpad deltas. */
function wheelGainFor(horiz: number): number {
  const abs = Math.abs(horiz);
  if (abs > 0 && abs < WHEEL_TINY_ABS) return WHEEL_GAIN * WHEEL_TINY_BOOST;
  return WHEEL_GAIN;
}

/** Shared max reveal across mounted rows (CSS var is uniform). */
function sharedMaxReveal(): number {
  for (const row of swipeRows.values()) {
    const m = row.readMax();
    if (m > 0) return m;
  }
  return BUBBLE_SWIPE_REVEAL_PX;
}

export type BubbleSwipeRowProps = {
  messageId: string;
  createdAt: string;
  className: string;
  /** Only user (send) rows translate left; assistant rows stay fixed. */
  role: 'user' | 'assistant';
  children: ReactNode;
};

/**
 * Reveal HH:MM in the trailing gutter (iMessage-style).
 *
 * Gesture targets the **whole message row** (host), not only the bubble.
 * One horizontal gesture updates **every** mounted row's clock together.
 *
 * - Wheel / trackpad: macOS natural-scroll deltaX — finger left (positive deltaX) opens;
 *   finger right closes. Reversed vs 58acd8b wheel polarity.
 *   Mouse press-drag is intentionally disabled so text selection works in bubbles.
 * - Time slides in from the **right** proportional to distance; vertically centered.
 * - Only **user** slides translateX left; assistant slides stay put (time still paints).
 * - Slide uses `transform` (not `left`) so bubble layout width/shape never changes.
 */
export function BubbleSwipeRow({
  messageId,
  createdAt,
  className,
  role,
  children,
}: BubbleSwipeRowProps) {
  const clock = formatMessageClockTime(createdAt);
  const movesOnSwipe = role === 'user';
  const [dragging, setDragging] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const offsetRef = useRef(0);
  const maxRef = useRef(BUBBLE_SWIPE_REVEAL_PX);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const slideRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const draggingRef = useRef(false);
  const movesRef = useRef(movesOnSwipe);
  movesRef.current = movesOnSwipe;

  const paintLocal = useCallback((next: number, isDragging: boolean) => {
    offsetRef.current = next;
    const slide = slideRef.current;
    const time = timeRef.current;
    const host = hostRef.current;
    const max = maxRef.current || sharedMaxReveal();
    if (host) host.classList.toggle('is-dragging', isDragging);
    // Clear legacy `left` from older builds; translate only (no layout width change).
    if (slide) {
      slide.style.left = '';
      if (movesRef.current) {
        slide.style.transform = next === 0 ? '' : `translateX(${-next}px)`;
      } else {
        slide.style.transform = '';
      }
    }
    if (time) {
      const progress = Math.min(1, Math.abs(next) / Math.max(1, max));
      // Slide in from the right proportional to swipe distance.
      time.style.transform = `translateX(${(1 - progress) * max}px)`;
      time.style.opacity = String(opacityForOffset(next, max));
    }
    const on = Math.abs(next) > 1;
    setRevealing((prev) => (prev === on ? prev : on));
    if (draggingRef.current !== isDragging) {
      draggingRef.current = isDragging;
      setDragging(isDragging);
    }
  }, []);

  useEffect(() => {
    maxRef.current = readRevealPx(hostRef.current);
  }, [clock]);

  useEffect(() => {
    if (!clock) return;
    return registerRow({
      id: messageId,
      paint: paintLocal,
      readMax: () => readRevealPx(hostRef.current),
      host: () => hostRef.current,
    });
  }, [clock, messageId, paintLocal]);

  useEffect(() => {
    if (!clock) return;
    const host = hostRef.current;
    if (!host) return;

    const onWheel = (e: WheelEvent) => {
      if (isInteractiveTarget(e.target)) return;
      // Code blocks / nested overflow: never steal for swipe-to-show-time.
      if (isOverScrollableInsideHost(e.target, host)) return;

      const { dx, dy } = wheelDeltaPx(e);
      let horiz = dx;
      if (Math.abs(dx) < WHEEL_EPS && e.shiftKey && Math.abs(dy) >= WHEEL_EPS) {
        horiz = dy;
      }

      if (Math.abs(horiz) < WHEEL_EPS) return;

      const base = pendingOffset ?? sharedOffset;
      const alreadyOpen = base > 1;
      const shiftFallback = e.shiftKey && Math.abs(dx) < WHEEL_EPS;
      if (
        !alreadyOpen &&
        Math.abs(horiz) <= Math.abs(dy) * HORIZ_DOMINANCE &&
        !shiftFallback
      ) {
        wheelArmAccum = 0;
        return;
      }

      // Closed + finger-right (negative deltaX under macOS natural scroll): ignore.
      // Open is finger-left → positive deltaX → content left, time from right.
      if (base <= 0 && horiz < 0) {
        wheelArmAccum = 0;
        return;
      }

      const gain = wheelGainFor(horiz);
      const delta = horiz * gain;

      // Deadzone: require AXIS_LOCK_PX of open-direction travel before locking.
      if (!alreadyOpen) {
        if (delta <= 0) return;
        wheelArmAccum += delta;
        if (wheelArmAccum < AXIS_LOCK_PX) return;
        // Crossed threshold — start reveal from overshoot past the deadzone.
        const overshoot = wheelArmAccum - AXIS_LOCK_PX;
        wheelArmAccum = AXIS_LOCK_PX;
        e.preventDefault();
        e.stopPropagation();
        maxRef.current = readRevealPx(hostRef.current);
        claimGesture(messageId);
        const max = sharedMaxReveal();
        const next = Math.min(max, Math.max(0, overshoot));
        scheduleSharedOffset(next, true);
        scheduleWheelSpringBack();
        return;
      }

      // Reversed vs 58acd8b: positive horiz increases reveal (matches natural scroll).
      e.preventDefault();
      e.stopPropagation();
      maxRef.current = readRevealPx(hostRef.current);
      claimGesture(messageId);
      const max = sharedMaxReveal();
      const next = Math.min(max, Math.max(0, base + delta));
      scheduleSharedOffset(next, true);
      scheduleWheelSpringBack();
    };

    host.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => host.removeEventListener('wheel', onWheel, { capture: true });
  }, [clock, messageId]);

  if (!clock) {
    return (
      <div data-message-id={messageId} className={className}>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className={`bubble-swipe-host${movesOnSwipe ? ' bubble-swipe-host--user' : ' bubble-swipe-host--assistant'}${
        dragging ? ' is-dragging' : ''
      }${revealing ? ' is-revealing' : ''}`}
      data-message-id={messageId}
    >
      <span ref={timeRef} className="bubble-swipe-time" aria-hidden={!revealing}>
        {clock}
      </span>
      <div ref={slideRef} className={`bubble-swipe-slide ${className}`}>
        {children}
      </div>
    </div>
  );
}
