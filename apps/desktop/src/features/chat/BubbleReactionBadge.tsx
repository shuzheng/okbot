import { useEffect, useState } from 'react';
import type { MessageReaction } from '@okbot/shared';

/**
 * Round reaction chip on a bubble corner.
 * Re-plays pop animation whenever emoji/updatedAt changes.
 */
export function BubbleReactionBadge({
  reaction,
  placement,
  onClick,
}: {
  reaction: MessageReaction;
  /** Assistant reaction on user bubble → br; user on assistant → bl. */
  placement: 'br' | 'bl';
  onClick?: () => void;
}) {
  const [popKey, setPopKey] = useState(0);
  useEffect(() => {
    setPopKey((k) => k + 1);
  }, [reaction.emoji, reaction.updatedAt]);

  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`bubble-reaction bubble-reaction-${placement}${onClick ? ' is-clickable' : ''}`}
      key={`${reaction.emoji}-${reaction.updatedAt}-${popKey}`}
      title={reaction.emoji}
      aria-label={reaction.emoji}
      onClick={onClick}
    >
      <span className="bubble-reaction-emoji" aria-hidden>
        {reaction.emoji}
      </span>
    </Tag>
  );
}
