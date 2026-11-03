import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import data from '@emoji-mart/data';
import i18nZh from '@emoji-mart/data/i18n/zh.json';
import { init as emojiMartInit, Picker as EmojiMartPicker } from 'emoji-mart';
import type { UiLang } from '../../i18n';

/**
 * Same emoji-mart picker used by AvatarPicker 「更多」 — portal near an anchor.
 */
export function EmojiMartPopover({
  lang,
  open,
  anchorEl,
  onClose,
  onPick,
}: {
  lang: UiLang;
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onPick: (emoji: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const themeAttr =
    typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;
  const emojiMartTheme =
    themeAttr === 'light' ? 'light' : themeAttr === 'dark' ? 'dark' : 'auto';

  useEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = anchorEl.getBoundingClientRect();
      const width = 352;
      const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
      const top = Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 440));
      setPos({ top: Math.max(8, top), left });
    };
    place();
    const onPointerDown = (ev: PointerEvent) => {
      const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
      if (anchorEl && path.includes(anchorEl)) return;
      if (hostRef.current && path.includes(hostRef.current)) return;
      const target = ev.target as Node | null;
      if (target && anchorEl.contains(target)) return;
      if (target && hostRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchorEl, onClose]);

  useEffect(() => {
    if (!open || !pos) return;
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const locale = lang === 'en' ? 'en' : 'zh';
    const i18n = locale === 'zh' ? i18nZh : undefined;
    void (async () => {
      try {
        await emojiMartInit({ data, locale, i18n });
      } catch {
        /* already inited */
      }
      if (cancelled) return;
      host.innerHTML = '';
      const picker = new EmojiMartPicker({
        data,
        i18n,
        parent: host,
        theme: emojiMartTheme,
        locale,
        previewPosition: 'none',
        skinTonePosition: 'search',
        maxFrequentRows: 1,
        perLine: 9,
        emojiSize: 24,
        emojiButtonSize: 36,
        onEmojiSelect: (sel: { native?: string }) => {
          const next = sel?.native;
          if (!next) return;
          onClose();
          onPickRef.current(next);
        },
      }) as unknown as HTMLElement;
      const el = (picker instanceof HTMLElement ? picker : host.querySelector('em-emoji-picker')) as
        | HTMLElement
        | null;
      if (el) {
        el.style.setProperty('width', '352px', 'important');
        el.style.setProperty('min-width', '352px', 'important');
        el.style.setProperty('height', '435px', 'important');
        el.style.setProperty('min-height', '435px', 'important');
        el.style.display = 'flex';
      }
    })();
    return () => {
      cancelled = true;
      try {
        host.innerHTML = '';
      } catch {
        /* ignore */
      }
    };
  }, [open, pos, emojiMartTheme, lang, onClose]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={hostRef}
      className="emoji-mart-popover"
      style={{ top: pos.top, left: pos.left }}
    />,
    document.body,
  );
}
