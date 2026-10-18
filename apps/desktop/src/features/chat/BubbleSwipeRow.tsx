import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from 'react';
import { formatMessageClockTime } from '../../utils/formatSessionUpdatedAt';

/** Fallback when `--bubble-swipe-reveal` is unavailable (matches app.css). */
export const BUBBLE_SWIPE_REVEAL_PX = 52;

/** Horizontal must dominate vertical by this factor to claim the gesture. */
const HORIZ_DOMINANCE = 0.85;

/**
 * Idle after last horizontal wheel before spring-back (ms).
 * Must be long enough that a brief pause mid-reverse (跟手滑出) does not
 * finishAll — 80ms was firing while the finger was still on the trackpad.
 */
const WHEEL_IDLE_MS = 280;

/** Minimum |deltaX| (px, after deltaMode scale) to treat as horizontal. */
const WHEEL_EPS = 0.08;

/** Gesture owner id when the chat messages area owns the swipe (not a bubble row). */
const MESSAGES_GESTURE_OWNER = '__messages__';

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
    // Rows no longer own the gesture; only clear if nothing left to paint.
    if (swipeRows.size === 0 && (sharedOffset !== 0 || sharedDragging)) {
      finishAll();
    }
  };
}

function claimGesture(id: string): void {
  gestureOwnerId = id;
}

function currentOffset(): number {
  return pendingOffset ?? sharedOffset;
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
 * Wheel over nested scrollable content (e.g. code blocks) inside the chat
 * area: let native scroll win — do not start swipe-to-show-time.
 * The messages container itself is excluded (it is the gesture host).
 */
function isOverNestedScrollable(
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

/** Opacity fades 0→1 with the same progress as horizontal enter. */
function opacityForOffset(offset: number, max: number): number {
  return Math.min(1, Math.abs(offset) / Math.max(1, max));
}

/** Shared max reveal across mounted rows (CSS var is uniform). */
function sharedMaxReveal(fallbackEl?: HTMLElement | null): number {
  for (const row of swipeRows.values()) {
    const m = row.readMax();
    if (m > 0) return m;
  }
  return readRevealPx(fallbackEl ?? null);
}

/**
 * Bind wheel/trackpad swipe-to-reveal on the **entire** messages scroll
 * container (including gaps between bubbles). Left-button pointer drag is
 * intentionally left alone so native text/box selection works.
 * Keeps 跟手 progress, opacity, swipe-out, and idle auto-close. Broadcasts
 * offset to every mounted BubbleSwipeRow time column.
 */
export function useMessagesSwipeReveal(
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    const onWheel = (e: WheelEvent) => {
      if (isInteractiveTarget(e.target)) return;
      if (isOverNestedScrollable(e.target, host)) return;

      const { dx, dy } = wheelDeltaPx(e);
      let horiz = dx;
      if (Math.abs(dx) < WHEEL_EPS && e.shiftKey && Math.abs(dy) >= WHEEL_EPS) {
        horiz = dy;
      }

      const base = currentOffset();
      // Any reveal counts as open so reverse stays 跟手 all the way to 0
      // (base > 1 left a 1px band where reverse was ignored then idle snapped shut).
      const alreadyOpen = base > 0;

      // While revealing: even sub-EPS / non-dominant wheel means the finger is
      // still active — refresh idle so a noisy pause mid-滑出 cannot finishAll.
      if (alreadyOpen && Math.abs(horiz) < WHEEL_EPS) {
        scheduleWheelSpringBack();
        return;
      }
      if (Math.abs(horiz) < WHEEL_EPS) return;

      const shiftFallback = e.shiftKey && Math.abs(dx) < WHEEL_EPS;
      if (
        !alreadyOpen &&
        Math.abs(horiz) <= Math.abs(dy) * HORIZ_DOMINANCE &&
        !shiftFallback
      ) {
        return;
      }

      // Closed + finger-right (negative deltaX under macOS natural scroll): ignore.
      // Open is finger-left → positive deltaX → content left, time from right.
      // Already open: negative horiz 跟手滑出 (proportionally closes).
      if (base <= 0 && horiz < 0) {
        return;
      }

      // 跟手 1:1 both ways — NO gain on open or close.
      // progress = clamp(offset / timeColumnWidthPx, 0, 1).
      const enterDelta = horiz;

      // Closed: only open-direction travel starts the reveal (no binary deadzone).
      if (!alreadyOpen && enterDelta <= 0) return;

      // Reversed vs 58acd8b: positive horiz increases reveal; negative decreases (跟手滑出).
      e.preventDefault();
      e.stopPropagation();
      claimGesture(MESSAGES_GESTURE_OWNER);
      const max = sharedMaxReveal(host);
      const next = Math.min(max, Math.max(0, base + enterDelta));
      scheduleSharedOffset(next, true);
      scheduleWheelSpringBack();
    };

    host.addEventListener('wheel', onWheel, { passive: false, capture: true });

    return () => {
      host.removeEventListener('wheel', onWheel, { capture: true });
      if (gestureOwnerId === MESSAGES_GESTURE_OWNER) {
        finishAll();
      }
    };
  }, [containerRef]);
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
 * Gesture is owned by the **messages scroll container** (`useMessagesSwipeReveal`)
 * so gaps between bubbles also trigger reveal. This row only paints the shared
 * offset onto its time column / user slide.
 *
 * - Wheel / trackpad only: macOS natural-scroll deltaX — finger left (positive
 *   deltaX) opens; finger right closes (跟手滑出). Idle after last horizontal
 *   wheel spring-closes. Left-button drag never claims swipe — native text
 *   selection only.
 * - 跟手: swipePx accumulates 1:1 both ways (no gain on open OR close).
 *   progress = clamp(swipePx / timeColumnWidthPx, 0, 1) where timeColumnWidthPx
 *   is `--bubble-swipe-reveal` (fallback 52). Opacity and translateX both use progress.
 * - Time slides in from the **right** with translate + opacity fade (0→1) by that progress.
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
      // progress = clamp(offset / timeColumnWidth, 0, 1)
      const progress = Math.min(1, Math.abs(next) / Math.max(1, max));
      // Horizontal enter from the right + opacity fade with the same progress.
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
