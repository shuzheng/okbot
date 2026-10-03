import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';

/** How soon the tip appears. Native `title` is much slower. */
const SHOW_MS = 80;
const GAP = 6;

type TipPlace = 'right' | 'left' | 'below';

type TipChildProps = {
  ref?: Ref<HTMLElement>;
  onMouseEnter?: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (e: MouseEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
};

function assignRef(ref: Ref<HTMLElement> | undefined, node: HTMLElement | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(node);
  else (ref as { current: HTMLElement | null }).current = node;
}

/**
 * Small hover tip. Portaled so overflow on the sidebar, composer fan, and
 * header does not clip it. Hides immediately on press so it does not stick
 * after a click.
 */
export function QuickTip({
  text,
  place = 'right',
  children,
}: {
  text: string;
  place?: TipPlace;
  children: ReactElement<TipChildProps>;
}) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const held = useRef(false);
  const timer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number; transform: string } | null>(null);

  function clearTimer() {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function hide() {
    held.current = false;
    clearTimer();
    setOpen(false);
  }

  function schedule() {
    if (held.current || !text) return;
    clearTimer();
    timer.current = window.setTimeout(() => setOpen(true), SHOW_MS);
  }

  function dismiss() {
    held.current = true;
    clearTimer();
    setOpen(false);
  }

  useEffect(() => () => clearTimer(), []);

  useEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    const placeTip = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let top = r.top + r.height / 2;
      let left = r.right + GAP;
      let transform = 'translateY(-50%)';
      const preferLeft = place === 'left' || (place === 'right' && r.right + GAP + 168 > window.innerWidth);
      if (place === 'below') {
        top = r.bottom + GAP;
        left = Math.min(Math.max(8, r.left + r.width / 2), window.innerWidth - 8);
        transform = 'translateX(-50%)';
        if (top + 28 > window.innerHeight) {
          top = r.top - GAP;
          transform = 'translate(-50%, -100%)';
        }
      } else if (preferLeft) {
        left = r.left - GAP;
        transform = 'translate(-100%, -50%)';
      }
      setBox({ top, left, transform });
    };
    placeTip();
    window.addEventListener('scroll', placeTip, true);
    window.addEventListener('resize', placeTip);
    return () => {
      window.removeEventListener('scroll', placeTip, true);
      window.removeEventListener('resize', placeTip);
    };
  }, [open, place, text]);

  if (!isValidElement(children)) return children;

  const child = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      assignRef(children.props.ref, node);
    },
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      children.props.onMouseEnter?.(e);
      schedule();
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      children.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      children.props.onFocus?.(e);
      schedule();
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      children.props.onBlur?.(e);
      hide();
    },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      children.props.onPointerDown?.(e);
      dismiss();
    },
  });

  return (
    <>
      {child}
      {open && box && text
        ? createPortal(
            <span
              className="quick-tip"
              role="tooltip"
              style={{ top: box.top, left: box.left, transform: box.transform }}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
