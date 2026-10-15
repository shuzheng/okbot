import { useEffect, useRef } from 'react';
import type { Bot, ModelProvider } from '@okbot/shared';
import { t } from '../../i18n';
import { ChevronsRightIcon } from '../../components/ui/icons';
import type { SquadWizardState } from '../../types';
import { FlatAvatar } from '../../components/ui/avatars';
import { BotSearchSelect } from '../bots/BotSearchSelect';
import { ModelRefSelect } from '../settings/ModelRefSelect';
import { updateScrollFade } from '../../utils/scrollFade';
import { useDrawerClose } from '../../utils/useDrawerClose';
import { SquadAdvancedSection } from './SquadAdvancedSection';

export type SquadWizardModalProps = {
  lang: 'zh' | 'en';
  bots: Bot[];
  value: SquadWizardState;
  providers: ModelProvider[];
  defaultProviderId: string;
  defaultModelId: string;
  /** When false, hide description (read-only when shown) and Advanced (schedules). */
  showAdvancedSettings?: boolean;
  /** Edit flow: persist on change like BotFormModal (no Cancel/Save). */
  autoApply?: boolean;
  onChange: (next: SquadWizardState) => void;
  onClose: () => void;
  onSubmit: () => void;
  /** autoApply persist (edit). */
  onApply?: (next: SquadWizardState) => void;
  syncMembers: (ids: string[]) => void;
  removeMember: (id: string) => void;
  reorderMember: (fromId: string, toId: string) => void;
};

export function SquadWizardModal({
  lang,
  bots,
  value: squadWizard,
  providers,
  defaultProviderId,
  defaultModelId,
  showAdvancedSettings = false,
  autoApply = false,
  onChange: setSquadWizard,
  onClose,
  onSubmit,
  onApply,
  syncMembers,
  removeMember,
  reorderMember,
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


  const squadNameRef = useRef<HTMLInputElement>(null);
  const squadDragIdRef = useRef<string | null>(null);
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
        <div className="field">
          <label htmlFor="okbot-squad-name">{t(lang, 'nameLabel')}</label>
          <input
            spellCheck={false}
            id="okbot-squad-name"
            ref={squadNameRef}
            value={squadWizard.name}
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
        {showAdvancedSettings ? (
          <div className="field">
            <label htmlFor="okbot-squad-desc">{t(lang, 'descriptionLabel')}</label>
            <textarea
              spellCheck={false}
              id="okbot-squad-desc"
              rows={2}
              value={squadWizard.description}
              readOnly
              aria-readonly="true"
            />
            <p className="bot-form-model-hint">{t(lang, 'descriptionAutoHint')}</p>
          </div>
        ) : null}
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
            excludeIds={squadWizard.memberIds}
            selectedDisplay="none"
            placeholder={t(lang, 'squadMembersPlaceholder')}
            onChange={(ids) => {
              syncMembers(ids);
              if (!autoApply) return;
              const prev = squadWizard.memberIds;
              const keep = prev.filter((id) => ids.includes(id));
              const added = ids.filter((id) => !prev.includes(id));
              const memberIds = [...keep, ...added];
              const roles = { ...squadWizard.roles };
              for (const id of Object.keys(roles)) {
                if (!memberIds.includes(id)) delete roles[id];
              }
              for (const id of memberIds) {
                if (!roles[id]) roles[id] = t(lang, 'squadMemberDefaultRole');
              }
              emit({ ...squadWizard, memberIds, roles }, { immediate: true });
            }}
          />
          {squadWizard.memberIds.length === 0 ? (
            <div className="squad-members-hint">{t(lang, 'squadMembersHint')}</div>
          ) : (
            <div className="squad-role-list">
              {squadWizard.memberIds.map((id) => {
                const b = bots.find((x) => x.id === id);
                if (!b) return null;
                return (
                  <div
                    key={id}
                    className="squad-role-row"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const fromId =
                        e.dataTransfer.getData('text/plain') || squadDragIdRef.current || '';
                      squadDragIdRef.current = null;
                      if (!fromId) return;
                      reorderMember(fromId, id);
                      if (!autoApply || fromId === id) return;
                      const ids = [...squadWizard.memberIds];
                      const from = ids.indexOf(fromId);
                      const to = ids.indexOf(id);
                      if (from < 0 || to < 0) return;
                      ids.splice(from, 1);
                      ids.splice(to, 0, fromId);
                      emit({ ...squadWizard, memberIds: ids }, { immediate: true });
                    }}
                    onDragEnd={() => {
                      squadDragIdRef.current = null;
                      document
                        .querySelectorAll('.squad-role-row.dragging')
                        .forEach((el) => el.classList.remove('dragging'));
                    }}
                  >
                    <span
                      className="squad-role-grip"
                      title={t(lang, 'squadDragHint')}
                      aria-label={t(lang, 'squadDragHint')}
                      draggable
                      onDragStart={(e) => {
                        squadDragIdRef.current = id;
                        e.dataTransfer.setData('text/plain', id);
                        e.dataTransfer.effectAllowed = 'move';
                        (e.currentTarget.parentElement as HTMLElement | null)?.classList.add(
                          'dragging',
                        );
                      }}
                    >
                      ⋮⋮
                    </span>
                    <FlatAvatar
                      emoji={b.emoji}
                      color={b.color}
                      avatarKind={b.avatarKind}
                      botAvatarType={b.botAvatarType}
                    />
                    <span className="squad-role-name">{b.name}</span>
                    <input
                      spellCheck={false}
                      value={squadWizard.roles[id] || ''}
                      onChange={(e) =>
                        patch({
                          roles: { ...squadWizard.roles, [id]: e.target.value },
                        })
                      }
                      onCompositionStart={onComposeStart}
                      onCompositionEnd={(e) => {
                        const v = (e.target as HTMLInputElement).value;
                        const next = {
                          ...squadWizard,
                          roles: { ...squadWizard.roles, [id]: v },
                        };
                        setSquadWizard(next);
                        pendingEmitRef.current = next;
                        onComposeEnd();
                      }}
                      onBlur={() => flushEmit()}
                      placeholder={t(lang, 'squadRolePlaceholder')}
                      aria-label={t(lang, 'squadRoleLabel')}
                    />
                    <button
                      type="button"
                      className="squad-role-remove"
                      title={t(lang, 'squadRemoveMember')}
                      aria-label={t(lang, 'squadRemoveMember')}
                      onClick={() => {
                        removeMember(id);
                        if (!autoApply) return;
                        const memberIds = squadWizard.memberIds.filter((x) => x !== id);
                        const roles = { ...squadWizard.roles };
                        delete roles[id];
                        emit({ ...squadWizard, memberIds, roles }, { immediate: true });
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {showAdvancedSettings ? (
          <SquadAdvancedSection lang={lang} squadId={squadWizard.id || null} />
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
