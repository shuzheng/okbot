import { FlatAvatar } from './avatars';
import type { MentionEntityRef, MentionKind } from '../../utils/entityMentions';
import { entityToBotRef } from '../../utils/entityMentions';
import { BotMentionChip } from './BotMentionChip';

const KIND_EMOJI: Record<MentionKind, string> = {
  bot: '🤖',
  squad: '👥',
  schedule: '⏰',
  skill: '🧩',
};

/**
 * Inline mention chip for bots / squads / schedules / skills.
 * Bots reuse BotMentionChip (bubble card language); other kinds share the same
 * pill chrome with kind emoji + name (no letter badge — emoji already disambiguates).
 */
export function EntityMentionChip({
  entity,
  className = '',
  onClick,
  'aria-label': ariaLabel,
}: {
  entity: MentionEntityRef;
  className?: string;
  onClick?: () => void;
  'aria-label'?: string;
}) {
  if (entity.kind === 'bot') {
    return (
      <BotMentionChip
        bot={entityToBotRef(entity)}
        className={className}
        onClick={onClick}
        aria-label={ariaLabel}
      />
    );
  }

  const label = (entity.label || '').trim() || entity.id;
  const chipClass =
    `bot-mention-chip entity-mention-chip entity-mention-chip-${entity.kind} ${onClick ? 'bot-mention-chip-clickable' : ''} ${className}`.trim();
  const common = {
    className: chipClass,
    title: entity.subtitle ? `${label} — ${entity.subtitle}` : label,
    'aria-label': ariaLabel || label,
  };
  const inner = (
    <>
      <FlatAvatar
        className="bot-mention-chip-avatar"
        emoji={entity.emoji || KIND_EMOJI[entity.kind]}
        color={entity.color || ''}
        avatarKind={entity.avatarKind || 'emoji'}
        botAvatarType={entity.botAvatarType}
        size={14}
        paused
        animate={false}
      />
      <span className="bot-mention-chip-name">{label}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" {...common} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <span {...common}>{inner}</span>;
}
