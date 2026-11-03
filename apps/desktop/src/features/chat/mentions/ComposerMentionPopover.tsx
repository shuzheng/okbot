import { memo, useEffect, useRef } from 'react';
import { FlatAvatar } from '../../../components/ui/avatars';
import { t, type UiLang } from '../../../i18n';
import {
  groupMentionsByKind,
  type MentionEntityRef,
  type MentionKind,
} from '../../../utils/entityMentions';

const KIND_EMOJI: Record<MentionKind, string> = {
  bot: '🤖',
  squad: '👥',
  schedule: '⏰',
  skill: '🧩',
};

function kindLabel(lang: UiLang, kind: MentionKind): string {
  if (kind === 'bot' || kind === 'squad') return t(lang, 'mentionGroupAssistants');
  if (kind === 'schedule') return t(lang, 'mentionGroupAutomations');
  return t(lang, 'mentionGroupSkills');
}

/** Flat list with stable indices matching filteredItems order (for keyboard highlight). */
export function flattenGrouped(
  items: readonly MentionEntityRef[],
): MentionEntityRef[] {
  return groupMentionsByKind(items).flatMap((g) => g.items);
}

export const ComposerMentionPopover = memo(function ComposerMentionPopover({
  lang,
  items,
  highlightIndex,
  onHighlight,
  onSelect,
}: {
  lang: UiLang;
  items: readonly MentionEntityRef[];
  highlightIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (entity: MentionEntityRef) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const flat = flattenGrouped(items);
  const groups = groupMentionsByKind(items);

  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-mention-idx="${highlightIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex]);

  if (flat.length === 0) {
    return (
      <div className="composer-mention-popover" role="listbox" aria-label={t(lang, 'mentionPopoverAria')}>
        <div className="composer-mention-empty">{t(lang, 'mentionEmpty')}</div>
      </div>
    );
  }

  let running = 0;
  return (
    <div
      ref={listRef}
      className="composer-mention-popover"
      role="listbox"
      aria-label={t(lang, 'mentionPopoverAria')}
    >
      {groups.map((g) => {
        // bot + squad share one group header "助手/小队"
        const showHeader =
          g.kind === 'bot' ||
          g.kind === 'schedule' ||
          g.kind === 'skill' ||
          (g.kind === 'squad' && !groups.some((x) => x.kind === 'bot'));
        const headerKind: MentionKind =
          g.kind === 'squad' && groups.some((x) => x.kind === 'bot') ? 'bot' : g.kind;
        // Skip duplicate header when squad follows bot in same visual group
        const skipHeader = g.kind === 'squad' && groups.some((x) => x.kind === 'bot');
        return (
          <div key={g.kind} className="composer-mention-group" role="group">
            {!skipHeader && showHeader ? (
              <div className="composer-mention-group-label">{kindLabel(lang, headerKind)}</div>
            ) : null}
            {g.items.map((entity) => {
              const idx = running;
              running += 1;
              const active = idx === highlightIndex;
              return (
                <button
                  key={`${entity.kind}:${entity.id}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-mention-idx={idx}
                  className={`composer-mention-option${active ? ' is-active' : ''}`}
                  onMouseEnter={() => onHighlight(idx)}
                  onMouseDown={(e) => {
                    // Prevent textarea blur before click applies.
                    e.preventDefault();
                  }}
                  onClick={() => onSelect(entity)}
                >
                  <FlatAvatar
                    className="composer-mention-option-avatar"
                    emoji={entity.emoji || KIND_EMOJI[entity.kind]}
                    color={entity.color || ''}
                    avatarKind={entity.avatarKind || 'emoji'}
                    botAvatarType={entity.botAvatarType}
                    size={22}
                    paused
                    animate={false}
                  />
                  <span className="composer-mention-option-text">
                    <span className="composer-mention-option-label">{entity.label}</span>
                    {entity.subtitle ? (
                      <span className="composer-mention-option-sub">{entity.subtitle}</span>
                    ) : null}
                  </span>
                  <span className="composer-mention-option-kind" aria-hidden>
                    {entity.kind === 'bot'
                      ? t(lang, 'mentionKindBot')
                      : entity.kind === 'squad'
                        ? t(lang, 'mentionKindSquad')
                        : entity.kind === 'schedule'
                          ? t(lang, 'mentionKindSchedule')
                          : t(lang, 'mentionKindSkill')}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
});
