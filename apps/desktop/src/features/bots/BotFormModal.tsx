import { useCallback, useEffect, useRef, useState } from 'react';
import {
  normalizeBotAvatarKind,
  normalizeBotAvatarType,
  type BotAvatarKind,
  type BotAvatarShape,
  type ModelProvider,
} from '@okbot/shared';
import { t } from '../../i18n';
import type { BotFormValues } from '../../types';
import { FlatAvatar } from '../../components/ui/avatars';
import { toast } from '../../components/ui';
import { ChevronsRightIcon, ChevronsDownIcon, ChevronsUpIcon, ExportAssistantIcon } from '../../components/ui/icons';
import { formatSystemError } from '../../utils/formatSystemError';
import { updateScrollFade } from '../../utils/scrollFade';
import { useDrawerClose } from '../../utils/useDrawerClose';
import { ModelRefSelect } from '../settings/ModelRefSelect';
import { AvatarPicker } from './AvatarPicker';
import { BotAdvancedSection, BotMemoryPanel, BotSkillsPanel } from './BotAdvancedSection';
import {
  OwnerFormTabs,
  OwnerTasksPanel,
  OwnerResourcesPanel,
  BOT_OWNER_FORM_TABS,
  type OwnerFormTab,
} from '../owner';
import { SchedulesList } from '../settings/SchedulesList';

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
  developerMode = false,
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
  /** When false, hide Advanced (SOUL.md / 灵魂). Memory & skills are own tabs; schedules under 自动化. */
  developerMode?: boolean;
  onCancel: () => void;
  onSave?: (v: BotFormValues) => void;
  onApply?: (v: BotFormValues) => void;
}) {
  const { closing, requestClose, onDrawerAnimationEnd } = useDrawerClose(onCancel);

  /* esc-close-modal */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);


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
  const soulMdRef = useRef({ text: '', touched: false });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ownerFormTab, setOwnerFormTab] = useState<OwnerFormTab>('details');
  const nameRef = useRef<HTMLInputElement>(null);
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

  const composingRef = useRef(false);
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEmitRef = useRef<BotFormValues | null>(null);

  useEffect(() => {
    return () => {
      if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    };
  }, []);

  function withAdvanced(base: BotFormValues): BotFormValues {
    const snap = soulMdRef.current;
    return {
      ...base,
      soulMd: snap.touched ? snap.text : null,
      soulMdTouched: snap.touched,
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

  const onSoulMdChange = useCallback((text: string, touched: boolean) => {
    soulMdRef.current = {
      text,
      touched: soulMdRef.current.touched || touched,
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
      soulMd: soulMdRef.current.touched ? soulMdRef.current.text : null,
      soulMdTouched: soulMdRef.current.touched,
      useGlobalSkills: next.useGlobalSkills,
      enabledGlobalSkills: next.enabledGlobalSkills,
    });
  }

  return (
    <div
      className={`modal-backdrop drawer-backdrop${closing ? ' closing' : ''}`}
      onClick={requestClose}
    >
      <div
        className={`modal modal-compact form-drawer${closing ? ' closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onDrawerAnimationEnd}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head form-drawer-head">
          <h2>{title}</h2>
          <div className="modal-head-actions">
            {botId ? (
              <button
                type="button"
                className="icon-btn"
                title={t(lang, 'botExportPackage')}
                aria-label={t(lang, 'botExportPackage')}
                onClick={() => {
                  const id = botId;
                  void (async () => {
                    try {
                      const res = await window.okbot.exportAssistantPackage(id);
                      if (res && !res.canceled && 'path' in res) {
                        toast.success(`${t(lang, 'botPackageExported')}: ${res.path}`);
                      }
                    } catch (err) {
                      toast.error(formatSystemError(err));
                    }
                  })();
                }}
              >
                <ExportAssistantIcon />
              </button>
            ) : null}
            <button type="button" className="modal-close" onClick={requestClose} aria-label={t(lang, 'close')}>
              <ChevronsRightIcon />
            </button>
          </div>
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
        <div className="avatar-preview-stack">
          <button
            type="button"
            className={`avatar-preview-hit${pickerOpen ? ' open' : ''}`}
            onClick={() => {
              setPickerOpen((v) => !v);
            }}
            aria-expanded={pickerOpen}
            aria-label={pickerOpen ? t(lang, 'avatarPickerCollapse') : t(lang, 'avatarPickerExpand')}
          >
            <FlatAvatar
              className="session-pin-avatar"
              emoji={emoji}
              color={color}
              avatarKind={avatarKind}
              botAvatarType={botAvatarType}
            />
            <span className="avatar-preview-mask" aria-hidden>
              {pickerOpen ? <ChevronsUpIcon /> : <ChevronsDownIcon />}
            </span>
          </button>
          <div className="field field-name">
            <input
              spellCheck={false}
              id="okbot-bot-name"
              ref={nameRef}
              value={name}
              aria-label={t(lang, 'nameLabel')}
              placeholder={t(lang, 'nameLabel')}
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
                if (autoApply) requestClose();
                else onSave?.(current());
              }}
            />
          </div>
          {description.trim() ? (
            <p className="bot-form-description-text">{description}</p>
          ) : null}
        </div>
        {pickerOpen ? (
          <AvatarPicker
            lang={lang}
            value={{ avatarKind, emoji, color, botAvatarType }}
            onChange={(patch) => {
              const next = {
                avatarKind: patch.avatarKind ?? avatarKind,
                emoji: patch.emoji ?? emoji,
                color: patch.color ?? color,
                botAvatarType: patch.botAvatarType ?? botAvatarType,
              };
              if (patch.avatarKind !== undefined) setAvatarKind(next.avatarKind);
              if (patch.emoji !== undefined) setEmoji(next.emoji);
              if (patch.color !== undefined) setColor(next.color);
              if (patch.botAvatarType !== undefined) setBotAvatarType(next.botAvatarType);
              emit(formValues({ name, description, ...next, providerId, modelId }), { immediate: true });
            }}
          />
        ) : null}
        <OwnerFormTabs lang={lang} value={ownerFormTab} onChange={setOwnerFormTab} tabs={BOT_OWNER_FORM_TABS} />
        {ownerFormTab === 'details' ? (
        <>
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
        {developerMode ? (
          <BotAdvancedSection
            lang={lang}
            botId={botId}
            onSoulMdChange={onSoulMdChange}
          />
        ) : null}
        </>
        ) : null}
        {ownerFormTab === 'tasks' ? (
          <OwnerTasksPanel lang={lang} ownerId={botId} active={ownerFormTab === 'tasks'} />
        ) : null}
        {ownerFormTab === 'automation' ? (
          <SchedulesList lang={lang} active={ownerFormTab === 'automation'} ownerId={botId} compact />
        ) : null}
        {ownerFormTab === 'memory' ? (
          <BotMemoryPanel lang={lang} botId={botId} active={ownerFormTab === 'memory'} />
        ) : null}
        {ownerFormTab === 'skills' ? (
          <BotSkillsPanel
            lang={lang}
            botId={botId}
            active={ownerFormTab === 'skills'}
            useGlobalSkills={useGlobalSkills}
            enabledGlobalSkills={enabledGlobalSkills}
            onGlobalSkillsChange={persistGlobalSkills}
          />
        ) : null}
        {ownerFormTab === 'resources' ? (
          <OwnerResourcesPanel lang={lang} ownerId={botId} active={ownerFormTab === 'resources'} />
        ) : null}
        {!autoApply && (
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={requestClose}>
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
