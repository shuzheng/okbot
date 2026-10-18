import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { t, type UiLang } from '../../i18n';
import { MoreHorizontalIcon } from '../../components/ui/icons';

const GAP = 6;
const MENU_MIN_W = 148;

export type BubbleMoreMenuItem = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
};

type Place = { top: number; left: number };

function placeNearAnchor(anchor: DOMRect, preferLeft: boolean): Place {
  const width = MENU_MIN_W;
  const estHeight = 8 + 36 * 3;
  let left = preferLeft
    ? Math.max(8, anchor.left - width - GAP)
    : anchor.right + GAP;
  if (!preferLeft && left + width > window.innerWidth - 8) {
    left = Math.max(8, anchor.left - width - GAP);
  }
  if (preferLeft && left < 8) {
    left = Math.min(window.innerWidth - width - 8, anchor.right + GAP);
  }
  let top = anchor.top;
  if (top + estHeight > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - estHeight - 8);
  }
  if (top < 8) top = 8;
  return { top, left };
}

/**
 * Bubble hover “更多 (···)” — reuses sidebar `.menu` chrome.
 * Keeps the action rail visible while open via `.is-active`.
 */
export function BubbleMoreMenu({
  lang,
  items,
  /** Prefer opening toward the bubble (left for assistant, right for user). */
  preferLeft = false,
  buttonRef,
}: {
  lang: UiLang;
  items: BubbleMoreMenuItem[];
  preferLeft?: boolean;
  /** Optional external ref to the ··· button (e.g. usage popover anchor). */
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const localBtnRef = useRef<HTMLButtonElement | null>(null);
  const btnRef = buttonRef ?? localBtnRef;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Place | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setBox(null);
      return;
    }
    const update = () =>
      setBox(placeNearAnchor(btnRef.current!.getBoundingClientRect(), preferLeft));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, preferLeft, btnRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    const onPointer = (e: MouseEvent | PointerEvent) => {
      const node = e.target as Node | null;
      if (!node) return;
      if (panelRef.current?.contains(node)) return;
      if (btnRef.current?.contains(node)) return;
      setOpen(false);
    };
    // Defer so the opening click does not immediately close.
    const timer = window.setTimeout(() => {
      window.addEventListener('keydown', onKey);
      window.addEventListener('pointerdown', onPointer, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open, btnRef]);

  if (!items.length) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`bubble-action-btn${open ? ' is-active' : ''}`}
        title={t(lang, 'more')}
        aria-label={t(lang, 'more')}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontalIcon />
      </button>
      {open && box
        ? createPortal(
            <div
              ref={panelRef}
              className="menu bubble-more-menu"
              role="menu"
              aria-label={t(lang, 'more')}
              style={{ top: box.top, left: box.left }}
            >
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  <span className="menu-item-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
