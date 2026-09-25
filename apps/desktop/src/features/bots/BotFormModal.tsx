import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import data from '@emoji-mart/data';
import i18nZh from '@emoji-mart/data/i18n/zh.json';
import { init as emojiMartInit, Picker as EmojiMartPicker } from 'emoji-mart';
import {
  AVATAR_COLORS,
  BOT_AVATAR_TYPES,
  EMOJI_PRESETS,
  normalizeBotAvatarKind,
  normalizeBotAvatarType,
  type BotAvatarKind,
  type BotAvatarShape,
  type ModelProvider,
} from '@okbot/shared';
import { t } from '../../i18n';
import type { BotFormValues } from '../../types';
import { FlatAvatar } from '../../components/ui/avatars';
import { updateScrollFade } from '../../utils/scrollFade';
import { ModelRefSelect } from '../settings/ModelRefSelect';
import { BotAdvancedSection } from './BotAdvancedSection';

export type { BotFormValues };

function formValues(partial: {
  name: string;
  description: string;
  avatarKind: BotAvatarKind;
  emoji: string;
  color: string;
  botAvatarType: BotAvatarShape;
  providerId: string;
  modelId: string;
}): BotFormValues {
  return {
    name: partial.name,
    description: partial.description,
    avatarKind: partial.avatarKind,
    emoji: partial.emoji,
    color: partial.color,
    botAvatarType: partial.botAvatarType,
    providerId: partial.providerId,
    modelId: partial.modelId,
  };
}

export function BotFormModal({
  lang,
  title,
  initial,
  providers,
  defaultProviderId,
  defaultModelId,
  botId = null,
  autoApply = false,
  onCancel,
  onSave,
  onApply,
}: {
  lang: 'zh' | 'en';
  title: string;
  initial: BotFormValues;
  /** Providers from settings for the 2-level model picker. */
  providers: ModelProvider[];
  defaultProviderId: string;
  defaultModelId: string;
  /** Existing bot id (create flow allocates before opening the modal). */
  botId?: string | null;
  autoApply?: boolean;
  onCancel: () => void;
  onSave?: (v: BotFormValues) => void;
  onApply?: (v: BotFormValues) => void;
}) {
  /* esc-close-modal */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);


  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [avatarKind, setAvatarKind] = useState<BotAvatarKind>(
    normalizeBotAvatarKind(initial.avatarKind),
  );
  const [emoji, setEmoji] = useState(initial.emoji);
  const [color, setColor] = useState(
    typeof initial.color === 'string' ? initial.color : '',
  );
  const [botAvatarType, setBotAvatarType] = useState<BotAvatarShape>(
    normalizeBotAvatarType(initial.botAvatarType),
  );
  const [providerId, setProviderId] = useState(initial.providerId || '');
  const [modelId, setModelId] = useState(initial.modelId || '');
  const [useGlobalSkills, setUseGlobalSkills] = useState(initial.useGlobalSkills === true);
  const [enabledGlobalSkills, setEnabledGlobalSkills] = useState<string[]>(
    Array.isArray(initial.enabledGlobalSkills) ? [...initial.enabledGlobalSkills] : [],
  );
  const agentsMdRef = useRef({ text: '', touched: false });
  const [emojiMoreOpen, setEmojiMoreOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emojiMoreBtnRef = useRef<HTMLButtonElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ top: number; left: number } | null>(null);
  // Hot presets: 2 rows × 7 cols (👑 stays second).
  const emojiCols = 7;
  const emojiHotCount = emojiCols * 2;
  const hotEmojis = [...EMOJI_PRESETS].slice(0, emojiHotCount) as string[];
  if (emoji && !hotEmojis.includes(emoji) && EMOJI_PRESETS.includes(emoji as (typeof EMOJI_PRESETS)[number])) {
    hotEmojis[emojiHotCount - 1] = emoji;
  }
  const themeAttr = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;
  const emojiMartTheme =
    themeAttr === 'light' ? 'light' : themeAttr === 'dark' ? 'dark' : 'auto';
  // Keep latest form values for picker onEmojiSelect without remounting on every keystroke.
  const formSnapRef = useRef({
    name,
    description,
    avatarKind,
    color,
    botAvatarType,
    providerId,
    modelId,
  });
  formSnapRef.current = { name, description, avatarKind, color, botAvatarType, providerId, modelId };

  useEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    // Focus once on mount. Avoid delayed focus/select — they clobber early IME on Windows.
    el.focus();
    const isWin =
      document.documentElement.dataset.platform === 'win32' ||
      /Windows/i.test(navigator.userAgent);
    // Windows + IME 全角: select() on default「新建助手」breaks composition; focus only.
    if (isWin) return;
    if ((el as HTMLInputElement & { composing?: boolean }).composing) return;
    if (document.activeElement === el) el.select();
  }, []);

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
      const t = ev.target as Node | null;
      if (t && emojiMoreBtnRef.current?.contains(t)) return;
      if (t && emojiPickerRef.current?.contains(t)) return;
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
          const snap = formSnapRef.current;
          setEmoji(next);
          setEmojiMoreOpen(false);
          emit(
            formValues({
              name: snap.name,
              description: snap.description,
              avatarKind: snap.avatarKind,
              emoji: next,
              color: snap.color,
              botAvatarType: snap.botAvatarType,
              providerId: snap.providerId,
              modelId: snap.modelId,
            }),
            { immediate: true },
          );
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

  const composingRef = useRef(false);
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEmitRef = useRef<BotFormValues | null>(null);

  useEffect(() => {
    return () => {
      if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    };
  }, []);

  function withAdvanced(base: BotFormValues): BotFormValues {
    const snap = agentsMdRef.current;
    return {
      ...base,
      agentsMd: snap.touched ? snap.text : null,
      agentsMdTouched: snap.touched,
      useGlobalSkills,
      enabledGlobalSkills,
    };
  }

  function current(): BotFormValues {
    return withAdvanced(
      formValues({ name, description, avatarKind, emoji, color, botAvatarType, providerId, modelId }),
    );
  }

  function clearEmitTimer() {
    if (emitTimerRef.current) {
      clearTimeout(emitTimerRef.current);
      emitTimerRef.current = null;
    }
  }

  function flushEmit() {
    clearEmitTimer();
    const next = pendingEmitRef.current;
    pendingEmitRef.current = null;
    if (!autoApply || !next) return;
    onApply?.(withAdvanced(next));
  }

  /** autoApply persist: skip during IME composition; debounce text; immediate for picks. */
  function emit(next: BotFormValues, opts?: { immediate?: boolean }) {
    if (!autoApply) return;
    pendingEmitRef.current = next;
    if (composingRef.current && !opts?.immediate) return;
    if (opts?.immediate) {
      flushEmit();
      return;
    }
    clearEmitTimer();
    emitTimerRef.current = setTimeout(() => {
      emitTimerRef.current = null;
      if (composingRef.current) return;
      flushEmit();
    }, 350);
  }

  function onComposeStart() {
    composingRef.current = true;
    clearEmitTimer();
  }

  function onComposeEnd() {
    composingRef.current = false;
    // Flush committed composition so parent persists without mid-IME IPC churn.
    flushEmit();
  }

  const onAgentsMdChange = useCallback((text: string, touched: boolean) => {
    agentsMdRef.current = {
      text,
      touched: agentsMdRef.current.touched || touched,
    };
  }, []);

  function persistGlobalSkills(next: {
    useGlobalSkills: boolean;
    enabledGlobalSkills: string[];
  }) {
    setUseGlobalSkills(next.useGlobalSkills);
    setEnabledGlobalSkills(next.enabledGlobalSkills);
    if (!autoApply) return;
    onApply?.({
      ...formValues({ name, description, avatarKind, emoji, color, botAvatarType, providerId, modelId }),
      agentsMd: agentsMdRef.current.touched ? agentsMdRef.current.text : null,
      agentsMdTouched: agentsMdRef.current.touched,
      useGlobalSkills: next.useGlobalSkills,
      enabledGlobalSkills: next.enabledGlobalSkills,
    });
  }

  function switchKind(next: BotAvatarKind) {
    setAvatarKind(next);
    setEmojiMoreOpen(false);
    // Preserve color (including '' 「默认」). Do not invent a hash color when
    // leaving bot-avatar default for emoji — emoji default is transparent.
    emit(
      formValues({
        name,
        description,
        avatarKind: next,
        emoji,
        color,
        botAvatarType,
        providerId,
        modelId,
      }),
      { immediate: true },
    );
  }

  return (
    <div className="modal-backdrop drawer-backdrop" onClick={onCancel}>
      <div
        className="modal modal-compact form-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head form-drawer-head">
          <h2>{title}</h2>
          <button type="button" className="modal-close" onClick={onCancel} aria-label={t(lang, 'close')}>
            ×
          </button>
        </div>
        <div
          className="form-drawer-body scroll-fade"
          onScroll={(e) => updateScrollFade(e.currentTarget)}
          ref={(el) => {
            if (el) {
              updateScrollFade(el);
              requestAnimationFrame(() => updateScrollFade(el));
            }
          }}
        >
        <div className="avatar-preview-row">
          <button
            type="button"
            className={`avatar-preview-hit${pickerOpen ? ' open' : ''}`}
            onClick={() =>
              setPickerOpen((v) => {
                const next = !v;
                if (!next) setEmojiMoreOpen(false);
                return next;
              })
            }
            aria-expanded={pickerOpen}
            aria-label={pickerOpen ? t(lang, 'avatarPickerCollapse') : t(lang, 'avatarPickerExpand')}
          >
            <FlatAvatar
              className="avatar-preview"
              emoji={emoji}
              color={color}
              avatarKind={avatarKind}
              botAvatarType={botAvatarType}
            />
            <span className="avatar-preview-mask" aria-hidden>
              {pickerOpen ? t(lang, 'avatarPickerCollapse') : t(lang, 'avatarPickerExpand')}
            </span>
          </button>
          <div className="field field-name">
            <label htmlFor="okbot-bot-name">{t(lang, 'nameLabel')}</label>
            <input
              spellCheck={false}
              id="okbot-bot-name"
              ref={nameRef}
              value={name}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                emit(formValues({ name: v, description, avatarKind, emoji, color, botAvatarType, providerId, modelId }));
              }}
              onCompositionStart={onComposeStart}
              onCompositionEnd={(e) => {
                const v = (e.target as HTMLInputElement).value;
                setName(v);
                pendingEmitRef.current = formValues({
                  name: v,
                  description,
                  avatarKind,
                  emoji,
                  color,
                  botAvatarType,
                  providerId,
                  modelId,
                });
                onComposeEnd();
              }}
              onBlur={() => flushEmit()}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key !== 'Enter') return;
                e.preventDefault();
                flushEmit();
                if (autoApply) onCancel();
                else onSave?.(current());
              }}
            />
          </div>
        </div>
        <div className="field">
          <label>{t(lang, 'descriptionLabel')}</label>
          <textarea
            spellCheck={false}
            rows={2}
            value={description}
            onChange={(e) => {
              const v = e.target.value;
              setDescription(v);
              emit(formValues({ name, description: v, avatarKind, emoji, color, botAvatarType, providerId, modelId }));
            }}
            onCompositionStart={onComposeStart}
            onCompositionEnd={(e) => {
              const v = (e.target as HTMLTextAreaElement).value;
              setDescription(v);
              pendingEmitRef.current = formValues({
                name,
                description: v,
                avatarKind,
                emoji,
                color,
                botAvatarType,
                providerId,
                modelId,
              });
              onComposeEnd();
            }}
            onBlur={() => flushEmit()}
          />
        </div>
        <div className="field bot-form-model-row">
          <label>{t(lang, 'botModel')}</label>
          <ModelRefSelect
            lang={lang}
            providers={providers}
            providerId={providerId}
            modelId={modelId}
            defaultProviderId={defaultProviderId}
            defaultModelId={defaultModelId}
            emptyLabel={t(lang, 'botModelDefault')}
            onChange={({ providerId: pid, modelId: mid }) => {
              setProviderId(pid);
              setModelId(mid);
              emit(
                formValues({
                  name,
                  description,
                  avatarKind,
                  emoji,
                  color,
                  botAvatarType,
                  providerId: pid,
                  modelId: mid,
                }),
                { immediate: true },
              );
            }}
          />
          <p className="bot-form-model-hint">{t(lang, 'botModelHint')}</p>
        </div>
        {pickerOpen ? (
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
                  <div className="emoji-picker-row">
                    <div className="emoji-grid">
                      {hotEmojis.map((e) => (
                        <button
                          key={e}
                          type="button"
                          className={emoji === e ? 'active' : ''}
                          onClick={() => {
                            setEmoji(e);
                            setEmojiMoreOpen(false);
                            emit(
                              formValues({
                                name,
                                description,
                                avatarKind,
                                emoji: e,
                                color,
                                botAvatarType,
                                providerId,
                                modelId,
                              }),
                              { immediate: true },
                            );
                          }}
                        >
                          <span className="emoji-grid-raw">{e}</span>
                        </button>
                      ))}
                    </div>
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
                <div className="field">
                  <label>{t(lang, 'colorLabel')}</label>
                  <div className="color-picker-row">
                    <div className="color-grid color-grid-one-row">
                      <button
                        type="button"
                        className={`color-swatch color-swatch-default${!color ? ' active' : ''}`}
                        title={t(lang, 'colorPaletteDefault')}
                        onClick={() => {
                          setColor('');
                          emit(
                            formValues({
                              name,
                              description,
                              avatarKind,
                              emoji,
                              color: '',
                              botAvatarType,
                              providerId,
                              modelId,
                            }),
                            { immediate: true },
                          );
                        }}
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
                          onClick={() => {
                            setColor(c);
                            emit(
                              formValues({
                                name,
                                description,
                                avatarKind,
                                emoji,
                                color: c,
                                botAvatarType,
                                providerId,
                                modelId,
                              }),
                            { immediate: true },
                            );
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
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
                        onClick={() => {
                          setBotAvatarType(shape);
                          emit(
                            formValues({
                              name,
                              description,
                              avatarKind,
                              emoji,
                              color,
                              botAvatarType: shape,
                              providerId,
                              modelId,
                            }),
                          { immediate: true },
                          );
                        }}
                      >
                        <FlatAvatar
                          className="bot-avatar-type-preview"
                          emoji={emoji}
                          color={color}
                          avatarKind="bot-avatar"
                          botAvatarType={shape}
                          size={32}
                        />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>{t(lang, 'colorOverrideLabel')}</label>
                  <div className="color-picker-row">
                    <div className="color-grid color-grid-one-row">
                      <button
                        type="button"
                        className={`color-swatch color-swatch-default${!color ? ' active' : ''}`}
                        title={t(lang, 'colorPaletteDefault')}
                        onClick={() => {
                          setColor('');
                          emit(
                            formValues({
                              name,
                              description,
                              avatarKind,
                              emoji,
                              color: '',
                              botAvatarType,
                              providerId,
                              modelId,
                            }),
                          { immediate: true },
                          );
                        }}
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
                          onClick={() => {
                            setColor(c);
                            emit(
                              formValues({
                                name,
                                description,
                                avatarKind,
                                emoji,
                                color: c,
                                botAvatarType,
                                providerId,
                                modelId,
                              }),
                            { immediate: true },
                          );
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        ) : null}
        <BotAdvancedSection
          lang={lang}
          botId={botId}
          useGlobalSkills={useGlobalSkills}
          enabledGlobalSkills={enabledGlobalSkills}
          onAgentsMdChange={onAgentsMdChange}
          onGlobalSkillsChange={persistGlobalSkills}
        />
        {!autoApply && (
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onCancel}>
              {t(lang, 'cancel')}
            </button>
            <button type="button" className="primary" onClick={() => onSave?.(current())}>
              {t(lang, 'save')}
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
