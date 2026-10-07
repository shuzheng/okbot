import { useEffect, useRef } from 'react';
import type { Bot, ModelProvider } from '@okbot/shared';
import { t } from '../../i18n';
import { ChevronsRightIcon } from '../../components/ui/icons';
import type { SquadWizardState } from '../../types';
import { FlatAvatar } from '../../components/ui/avatars';
import { BotSearchSelect } from '../bots/BotSearchSelect';
import { ModelRefSelect } from '../settings/ModelRefSelect';
import { updateScrollFade } from '../../utils/scrollFade';
import { SchedulesList } from '../settings/SchedulesList';

export type SquadWizardModalProps = {
  lang: 'zh' | 'en';
  bots: Bot[];
  value: SquadWizardState;
  providers: ModelProvider[];
  defaultProviderId: string;
  defaultModelId: string;
  onChange: (next: SquadWizardState) => void;
  onClose: () => void;
  onSubmit: () => void;
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
  onChange: setSquadWizard,
  onClose,
  onSubmit,
  syncMembers,
  removeMember,
  reorderMember,
}: SquadWizardModalProps) {
  /* esc-close-modal */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);


  const squadNameRef = useRef<HTMLInputElement>(null);
  const squadDragIdRef = useRef<string | null>(null);

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

  return (
    <div className="modal-backdrop drawer-backdrop" onClick={() => onClose()}>
      <div
        className="modal modal-compact squad-wizard form-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, squadWizard.id ? 'squadProfile' : 'squadWizardTitle')}
      >
        <div className="modal-head form-drawer-head">
          <h2>{t(lang, squadWizard.id ? 'squadProfile' : 'squadWizardTitle')}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={() => onClose()}
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
            onChange={(e) => setSquadWizard({ ...squadWizard, name: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="okbot-squad-desc">{t(lang, 'descriptionLabel')}</label>
          <textarea
            spellCheck={false}
            id="okbot-squad-desc"
            rows={2}
            value={squadWizard.description}
            onChange={(e) => setSquadWizard({ ...squadWizard, description: e.target.value })}
          />
        </div>
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
              setSquadWizard({ ...squadWizard, providerId, modelId })
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
            onChange={(ids) => syncMembers(ids)}
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
                      if (fromId) reorderMember(fromId, id);
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
                        setSquadWizard({
                          ...squadWizard,
                          roles: { ...squadWizard.roles, [id]: e.target.value },
                        })
                      }
                      placeholder={t(lang, 'squadRolePlaceholder')}
                      aria-label={t(lang, 'squadRoleLabel')}
                    />
                    <button
                      type="button"
                      className="squad-role-remove"
                      title={t(lang, 'squadRemoveMember')}
                      aria-label={t(lang, 'squadRemoveMember')}
                      onClick={() => removeMember(id)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {squadWizard.id ? (
          <div className="field" style={{ marginTop: 12 }}>
            <label>{t(lang, 'scheduledJobsList')}</label>
            <p className="bot-form-model-hint">{t(lang, 'scheduledJobsOwnerHint')}</p>
            <SchedulesList lang={lang} active compact ownerId={squadWizard.id} />
          </div>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={() => onClose()}>
            {t(lang, 'cancel')}
          </button>
          <button type="button" className="primary" onClick={() => void onSubmit()}>
            {t(lang, squadWizard.id ? 'save' : 'squadCreate')}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
