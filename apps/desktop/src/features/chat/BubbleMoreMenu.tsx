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
import { DEFAULT_REACTION_EMOJIS } from '@okbot/shared';
import { EmojiMartPopover } from './EmojiMartPopover';
import { loadReactionMru, rememberReactionEmoji } from './reactionMru';

const GAP = 6;
const MENU_MIN_W = 168;

export type BubbleMoreMenuItem = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
};

type Place = { top: number; left: number };

function placeNearAnchor(anchor: DOMRect, preferLeft: boolean, estHeight: number): Place {
  const width = MENU_MIN_W;
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
 * Optional reaction grid (2×3: 5 MRU + …) sits above menu items.
 * Keeps the action rail visible while open via `.is-active`.
 */
export function BubbleMoreMenu({
  lang,
  items,
  preferLeft = false,
  buttonRef,
  enableReactions = false,
  currentReactionEmoji,
  onPickReaction,
}: {
  lang: UiLang;
  items: BubbleMoreMenuItem[];
  preferLeft?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  /** Show frequent-emoji grid above items (user → assistant bubbles). */
  enableReactions?: boolean;
  currentReactionEmoji?: string;
  onPickReaction?: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mru, setMru] = useState<string[]>(() => loadReactionMru());
  const [pickerOpen, setPickerOpen] = useState(false);
  const localBtnRef = useRef<HTMLButtonElement | null>(null);
  const btnRef = buttonRef ?? localBtnRef;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const moreEmojiBtnRef = useRef<HTMLButtonElement | null>(null);
  const [box, setBox] = useState<Place | null>(null);

  const showReactions = Boolean(enableReactions && onPickReaction);
  const hasContent = showReactions || items.length > 0;

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setBox(null);
      return;
    }
    const estHeight = 8 + (showReactions ? 72 : 0) + 36 * Math.max(items.length, 1);
    const update = () =>
      setBox(placeNearAnchor(btnRef.current!.getBoundingClientRect(), preferLeft, estHeight));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, preferLeft, btnRef, showReactions, items.length]);

  useEffect(() => {
    if (!open) {
      setPickerOpen(false);
      return;
    }
    setMru(loadReactionMru());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (pickerOpen) setPickerOpen(false);
        else setOpen(false);
      }
    };
    const onPointer = (e: MouseEvent | PointerEvent) => {
      const node = e.target as Node | null;
      if (!node) return;
      if (panelRef.current?.contains(node)) return;
      if (btnRef.current?.contains(node)) return;
      // Keep menu open while emoji-mart popover is up (handled inside popover).
      if (pickerOpen) return;
      setOpen(false);
    };
    const timer = window.setTimeout(() => {
      window.addEventListener('keydown', onKey);
      window.addEventListener('pointerdown', onPointer, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open, btnRef, pickerOpen]);

  if (!hasContent) return null;

  const pick = (emoji: string) => {
    const next = rememberReactionEmoji(emoji);
    setMru(next);
    setOpen(false);
    setPickerOpen(false);
    onPickReaction?.(emoji);
  };

  const slots = [...mru].slice(0, 5);
  while (slots.length < 5) slots.push(DEFAULT_REACTION_EMOJIS[slots.length]!);

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
              {showReactions ? (
                <div className="bubble-reaction-grid" role="group" aria-label={t(lang, 'reactMessage')}>
                  {slots.map((emoji, i) => (
                    <button
                      key={`r-${i}-${emoji}`}
                      type="button"
                      role="menuitem"
                      className={`bubble-reaction-grid-btn${
                        currentReactionEmoji === emoji ? ' is-active' : ''
                      }`}
                      title={emoji}
                      aria-label={emoji}
                      onClick={() => pick(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                  <button
                    ref={moreEmojiBtnRef}
                    type="button"
                    role="menuitem"
                    className="bubble-reaction-grid-btn bubble-reaction-grid-more"
                    title={t(lang, 'moreEmojis')}
                    aria-label={t(lang, 'moreEmojis')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPickerOpen(true);
                    }}
                  >
                    …
                  </button>
                </div>
              ) : null}
              {showReactions && items.length ? <div className="menu-sep" role="separator" /> : null}
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
      <EmojiMartPopover
        lang={lang}
        open={pickerOpen}
        anchorEl={moreEmojiBtnRef.current}
        onClose={() => setPickerOpen(false)}
        onPick={pick}
      />
    </>
  );
}

