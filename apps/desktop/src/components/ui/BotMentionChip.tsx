import { FlatAvatar } from './avatars';
import type { MentionBotRef } from '../../utils/botMentions';

/** Inline pill: small BotAvatar (plastic) + display name for @助手 mentions. */
export function BotMentionChip({
  bot,
  className = '',
  onClick,
  'aria-label': ariaLabel,
}: {
  bot: MentionBotRef;
  className?: string;
  /** When set, chip is a button (e.g. mesh status opens peer dialog). */
  onClick?: () => void;
  'aria-label'?: string;
}) {
  const label = (bot.name || '').trim() || bot.id;
  const chipClass = `bot-mention-chip ${onClick ? 'bot-mention-chip-clickable' : ''} ${className}`.trim();
  const common = {
    className: chipClass,
    title: label,
    'aria-label': ariaLabel || label,
  };
  const inner = (
    <>
      <FlatAvatar
        className="bot-mention-chip-avatar"
        emoji={bot.emoji || '🤖'}
        color={bot.color || ''}
        avatarKind={bot.avatarKind}
        botAvatarType={bot.botAvatarType}
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
