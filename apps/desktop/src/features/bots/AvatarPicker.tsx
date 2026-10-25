import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import data from '@emoji-mart/data';
import i18nZh from '@emoji-mart/data/i18n/zh.json';
import { init as emojiMartInit, Picker as EmojiMartPicker } from 'emoji-mart';
import {
  AVATAR_COLORS,
  BOT_AVATAR_TYPES,
  EMOJI_PRESETS,
  type BotAvatarKind,
  type BotAvatarShape,
} from '@okbot/shared';
import { t } from '../../i18n';
import { FlatAvatar } from '../../components/ui/avatars';

export type AvatarValue = {
  avatarKind: BotAvatarKind;
  emoji: string;
  color: string;
  botAvatarType: BotAvatarShape;
};

/**
 * Assistant avatar picker (kind toggle, bot-avatar shapes / emoji grid + emoji-mart
 * 「更多」, color swatches). Shared by the profile drawer and the new-assistant dialog.
 * Every pick calls `onChange` with the changed fields only.
 */
export function AvatarPicker({
  lang,
  value,
  onChange,
}: {
  lang: 'zh' | 'en';
  value: AvatarValue;
  onChange: (patch: Partial<AvatarValue>) => void;
}) {
  const { avatarKind, emoji, color, botAvatarType } = value;
  const [emojiMoreOpen, setEmojiMoreOpen] = useState(false);
  const emojiMoreBtnRef = useRef<HTMLButtonElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ top: number; left: number } | null>(null);
  // Match bot-avatar-type-grid: 3 rows × 6 cols; last cell is 「更多」.
  const emojiCols = 6;
  const emojiHotCount = emojiCols * 3 - 1; // 17 slots; EMOJI_PRESETS has 17
  const hotEmojis = [...EMOJI_PRESETS].slice(0, emojiHotCount) as string[];
  if (emoji && !hotEmojis.includes(emoji)) {
    // Keep a non-preset (emoji-mart) selection visible in the last emoji slot.
    hotEmojis[emojiHotCount - 1] = emoji;
  }
  const themeAttr = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;
  const emojiMartTheme =
    themeAttr === 'light' ? 'light' : themeAttr === 'dark' ? 'dark' : 'auto';
  // Latest onChange for the emoji-mart callback without remounting the picker.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!emojiMoreOpen) {
      setEmojiPickerPos(null);
      return;
    }
    const place = () => {
      const btn = emojiMoreBtnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const width = 352;
      const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
      const top = Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 440));
      setEmojiPickerPos({ top: Math.max(8, top), left });
    };
    place();
    const onPointerDown = (ev: PointerEvent) => {
      const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
      if (emojiMoreBtnRef.current && path.includes(emojiMoreBtnRef.current)) return;
      if (emojiPickerRef.current && path.includes(emojiPickerRef.current)) return;
      const target = ev.target as Node | null;
      if (target && emojiMoreBtnRef.current?.contains(target)) return;
      if (target && emojiPickerRef.current?.contains(target)) return;
      setEmojiMoreOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setEmojiMoreOpen(false);
    };
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [emojiMoreOpen]);

  useEffect(() => {
    if (!emojiMoreOpen || !emojiPickerPos) return;
    const host = emojiPickerRef.current;
    if (!host) return;
    let cancelled = false;
    const locale = lang === 'en' ? 'en' : 'zh';
    const i18n = locale === 'zh' ? i18nZh : undefined;

    void (async () => {
      try {
        await emojiMartInit({ data, locale, i18n });
      } catch {
        /* init may already be done; still try to mount */
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
          setEmojiMoreOpen(false);
          onChangeRef.current({ emoji: next });
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
  }, [emojiMoreOpen, emojiPickerPos, emojiMartTheme, lang]);

  function switchKind(next: BotAvatarKind) {
    setEmojiMoreOpen(false);
    // Preserve color (including '' 「默认」). Do not invent a hash color when
    // leaving bot-avatar default for emoji — emoji default is transparent.
    onChange({ avatarKind: next });
  }

  const colorRow = (label: string) => (
    <div className="field">
      <label>{label}</label>
      <div className="color-picker-row">
        <div className="color-grid color-grid-one-row">
          <button
            type="button"
            className={`color-swatch color-swatch-default${!color ? ' active' : ''}`}
            title={t(lang, 'colorPaletteDefault')}
            onClick={() => onChange({ color: '' })}
          >
            {t(lang, 'colorPaletteDefault')}
          </button>
          {AVATAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch${c.toUpperCase() === '#FFFFFF' ? ' color-swatch-white' : ''}${color.toLowerCase() === c.toLowerCase() ? ' active' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => onChange({ color: c })}
            />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="field">
        <label>{t(lang, 'avatarKindLabel')}</label>
        <div className="avatar-kind-toggle" role="group" aria-label={t(lang, 'avatarKindLabel')}>
          <button
            type="button"
            className={avatarKind === 'bot-avatar' ? 'active' : ''}
            onClick={() => switchKind('bot-avatar')}
          >
            {t(lang, 'avatarKindBotAvatar')}
          </button>
          <button
            type="button"
            className={avatarKind === 'emoji' ? 'active' : ''}
            onClick={() => switchKind('emoji')}
          >
            {t(lang, 'avatarKindEmoji')}
          </button>
        </div>
      </div>
      {avatarKind === 'emoji' ? (
        <>
          <div className="field">
            <label>{t(lang, 'emojiLabel')}</label>
            <div className="emoji-grid">
              {hotEmojis.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={`emoji-grid-btn${emoji === e ? ' active' : ''}`}
                  onClick={() => {
                    setEmojiMoreOpen(false);
                    onChange({ emoji: e });
                  }}
                >
                  <FlatAvatar
                    className="bot-avatar-type-preview"
                    emoji={e}
                    color={color}
                    avatarKind="emoji"
                  />
                </button>
              ))}
              <div className="emoji-more-wrap">
                <button
                  ref={emojiMoreBtnRef}
                  type="button"
                  className={`emoji-more-btn${emojiMoreOpen ? ' open' : ''}`}
                  aria-expanded={emojiMoreOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (emojiMoreOpen) {
                      setEmojiMoreOpen(false);
                      setEmojiPickerPos(null);
                      return;
                    }
                    const btn = emojiMoreBtnRef.current;
                    if (btn) {
                      const r = btn.getBoundingClientRect();
                      const width = 352;
                      const left = Math.min(
                        Math.max(8, r.left),
                        Math.max(8, window.innerWidth - width - 8),
                      );
                      const top = Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 440));
                      setEmojiPickerPos({ top: Math.max(8, top), left });
                    }
                    setEmojiMoreOpen(true);
                  }}
                >
                  {t(lang, 'more')}
                </button>
                {emojiMoreOpen && emojiPickerPos
                  ? createPortal(
                      <div
                        ref={emojiPickerRef}
                        className="emoji-mart-portal"
                        style={{
                          top: emojiPickerPos.top,
                          left: emojiPickerPos.left,
                          width: 352,
                          minWidth: 352,
                          minHeight: 435,
                        }}
                        role="dialog"
                        aria-label={t(lang, 'more')}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      />,
                      document.body,
                    )
                  : null}
              </div>
            </div>
          </div>
          {colorRow(t(lang, 'colorLabel'))}
        </>
      ) : (
        <>
          <div className="field">
            <label>{t(lang, 'botAvatarTypeLabel')}</label>
            <div className="bot-avatar-type-grid">
              {BOT_AVATAR_TYPES.map((shape) => (
                <button
                  key={shape}
                  type="button"
                  className={`bot-avatar-type-btn${botAvatarType === shape ? ' active' : ''}`}
                  title={shape}
                  onClick={() => onChange({ botAvatarType: shape })}
                >
                  <FlatAvatar
                    className="bot-avatar-type-preview"
                    emoji={emoji}
                    color={color}
                    avatarKind="bot-avatar"
                    botAvatarType={shape}
                    size={36}
                  />
                </button>
              ))}
            </div>
          </div>
          {colorRow(t(lang, 'colorOverrideLabel'))}
        </>
      )}
    </>
  );
}
