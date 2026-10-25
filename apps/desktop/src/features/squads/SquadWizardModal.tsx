import { useEffect, useRef, useState } from 'react';
import type { Bot, ModelProvider } from '@okbot/shared';
import { t } from '../../i18n';
import { ChevronsRightIcon } from '../../components/ui/icons';
import type { SquadWizardState } from '../../types';
import { SquadAvatar } from '../../components/ui/avatars';
import { BotSearchSelect } from '../bots/BotSearchSelect';
import { ModelRefSelect } from '../settings/ModelRefSelect';
import { updateScrollFade } from '../../utils/scrollFade';
import { useDrawerClose } from '../../utils/useDrawerClose';
import { OwnerFormTabs, OwnerTasksPanel, OwnerResourcesPanel, type OwnerFormTab } from '../owner';
import { SchedulesList } from '../settings/SchedulesList';

export type SquadWizardModalProps = {
  lang: 'zh' | 'en';
  bots: Bot[];
  value: SquadWizardState;
  providers: ModelProvider[];
  defaultProviderId: string;
  defaultModelId: string;
  /** Edit flow: persist on change like BotFormModal (no Cancel/Save). */
  autoApply?: boolean;
  onChange: (next: SquadWizardState) => void;
  onClose: () => void;
  onSubmit: () => void;
  /** autoApply persist (edit). */
  onApply?: (next: SquadWizardState) => void;
  syncMembers: (ids: string[]) => void;
};

export function SquadWizardModal({
  lang,
  bots,
  value: squadWizard,
  providers,
  defaultProviderId,
  defaultModelId,
  autoApply = false,
  onChange: setSquadWizard,
  onClose,
  onSubmit,
  onApply,
  syncMembers,
}: SquadWizardModalProps) {
  const { closing, requestClose, onDrawerAnimationEnd } = useDrawerClose(onClose);

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


  const [ownerFormTab, setOwnerFormTab] = useState<OwnerFormTab>('details');
  const squadNameRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEmitRef = useRef<SquadWizardState | null>(null);

  useEffect(() => {
    return () => {
      if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const el = squadNameRef.current;
    if (!el) return;
    // Focus once; no delayed select — Windows IME composition can be clobbered by timers.
    el.focus();
    const isWin =
      document.documentElement.dataset.platform === 'win32' ||
      /Windows/i.test(navigator.userAgent);
    if (isWin) return;
    if ((el as HTMLInputElement & { composing?: boolean }).composing) return;
    if (document.activeElement === el) el.select();
  }, [squadWizard.id]);

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
    onApply?.(next);
  }

  /** autoApply persist: skip during IME composition; debounce text; immediate for picks. */
  function emit(next: SquadWizardState, opts?: { immediate?: boolean }) {
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
    flushEmit();
  }

  function patch(partial: Partial<SquadWizardState>, opts?: { immediate?: boolean }) {
    const next = { ...squadWizard, ...partial };
    setSquadWizard(next);
    emit(next, opts);
  }

  return (
    <div
      className={`modal-backdrop drawer-backdrop${closing ? ' closing' : ''}`}
      onClick={requestClose}
    >
      <div
        className={`modal modal-compact squad-wizard form-drawer${closing ? ' closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onDrawerAnimationEnd}
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, squadWizard.id ? 'squadProfile' : 'squadWizardTitle')}
      >
        <div className="modal-head form-drawer-head">
          <h2>{t(lang, squadWizard.id ? 'squadProfile' : 'squadWizardTitle')}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={requestClose}
            aria-label={t(lang, 'close')}
          >
            <ChevronsRightIcon />
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
        <div className="avatar-preview-stack">
          <button
            type="button"
            className="avatar-preview-hit"
            aria-label={t(lang, 'ownerFormTabDetails')}
            onClick={() => setOwnerFormTab('details')}
          >
            <SquadAvatar
              className="session-pin-avatar"
              members={squadWizard.memberIds
                .map((id) => bots.find((b) => b.id === id))
                .filter((b): b is Bot => !!b)
                .map((b) => ({
                  emoji: b.emoji,
                  color: b.color,
                  avatarKind: b.avatarKind,
                  botAvatarType: b.botAvatarType,
                }))}
            />
          </button>
          <div className="field field-name">
            <input
              spellCheck={false}
              id="okbot-squad-name"
              ref={squadNameRef}
              value={squadWizard.name}
              aria-label={t(lang, 'nameLabel')}
              placeholder={t(lang, 'nameLabel')}
              onChange={(e) => patch({ name: e.target.value })}
              onCompositionStart={onComposeStart}
              onCompositionEnd={(e) => {
                const v = (e.target as HTMLInputElement).value;
                const next = { ...squadWizard, name: v };
                setSquadWizard(next);
                pendingEmitRef.current = next;
                onComposeEnd();
              }}
              onBlur={() => flushEmit()}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key !== 'Enter') return;
                e.preventDefault();
                flushEmit();
                if (autoApply) requestClose();
                else void onSubmit();
              }}
            />
          </div>
          {squadWizard.description.trim() ? (
            <p className="bot-form-description-text">{squadWizard.description}</p>
          ) : null}
        </div>
        <OwnerFormTabs lang={lang} value={ownerFormTab} onChange={setOwnerFormTab} />
        {ownerFormTab === 'details' ? (
        <>
        <div className="field bot-form-model-row">
          <label htmlFor="okbot-squad-model">{t(lang, 'squadModelLabel')}</label>
          <ModelRefSelect
            id="okbot-squad-model"
            lang={lang}
            providers={providers}
            providerId={squadWizard.providerId}
            modelId={squadWizard.modelId}
            defaultProviderId={defaultProviderId}
            defaultModelId={defaultModelId}
            emptyLabel={t(lang, 'botModelDefault')}
            onChange={({ providerId, modelId }) =>
              patch({ providerId, modelId }, { immediate: true })
            }
          />
          <p className="bot-form-model-hint">{t(lang, 'squadModelHint')}</p>
        </div>
        <div className="field">
          <label>{t(lang, 'squadMembersLabel')}</label>
          <BotSearchSelect
            bots={bots}
            lang={lang}
            multi
            values={squadWizard.memberIds}
            placeholder={t(lang, 'squadMembersPlaceholder')}
            onChange={(ids) => {
              syncMembers(ids);
              if (!autoApply) return;
              const prev = squadWizard.memberIds;
              const keep = prev.filter((id) => ids.includes(id));
              const added = ids.filter((id) => !prev.includes(id));
              const memberIds = [...keep, ...added];
              emit({ ...squadWizard, memberIds }, { immediate: true });
            }}
          />
          {squadWizard.memberIds.length < 2 ? (
            <div className="squad-members-hint">{t(lang, 'squadMembersHint')}</div>
          ) : null}
        </div>
        </>
        ) : null}
        {ownerFormTab === 'tasks' ? (
          <OwnerTasksPanel
            lang={lang}
            ownerId={squadWizard.id || null}
            active={ownerFormTab === 'tasks'}
          />
        ) : null}
        {ownerFormTab === 'automation' ? (
          <SchedulesList
            lang={lang}
            active={ownerFormTab === 'automation'}
            ownerId={squadWizard.id || null}
            compact
          />
        ) : null}
        {ownerFormTab === 'resources' ? (
          <OwnerResourcesPanel
            lang={lang}
            ownerId={squadWizard.id || null}
            active={ownerFormTab === 'resources'}
          />
        ) : null}
        {!autoApply && (
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={requestClose}>
              {t(lang, 'cancel')}
            </button>
            <button type="button" className="primary" onClick={() => void onSubmit()}>
              {t(lang, squadWizard.id ? 'save' : 'squadCreate')}
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
