import type { CSSProperties } from 'react';
import { BotAvatar, type BotAvatarType } from 'bot-avatars';
import {
  normalizeBotAvatarKind,
  normalizeBotAvatarType,
  type BotAvatarKind,
  type BotAvatarShape,
} from '@okbot/shared';

/** Infer canvas px from common avatar classNames when `size` is omitted. */
function inferBotAvatarSize(className: string): number {
  if (className.includes('header-avatar') || className.includes('dock-tip-avatar')) return 22;
  if (className.includes('global-search-avatar') || className.includes('bubble-speaker-avatar')) return 28;
  if (className.includes('bot-picker-chip-avatar')) return 20;
  if (className.includes('squad-role-row') || className.includes('squad-member')) return 28;
  if (className.includes('avatar-preview')) return 36;
  if (className.includes('session-avatar')) return 36;
  return 36;
}

export function FlatAvatar({
  emoji,
  color,
  className = '',
  title,
  style,
  avatarKind = 'emoji',
  botAvatarType,
  busy = false,
  size,
}: {
  emoji: string;
  color?: string;
  className?: string;
  title?: string;
  style?: CSSProperties;
  avatarKind?: BotAvatarKind;
  botAvatarType?: BotAvatarShape;
  /** Maps to bot-avatars `state="working"` when avatarKind is bot-avatar. */
  busy?: boolean;
  /** Explicit BotAvatar canvas size in px. */
  size?: number;
}) {
  const kind = normalizeBotAvatarKind(avatarKind);
  if (kind === 'bot-avatar') {
    const resolvedSize = size ?? inferBotAvatarSize(className);
    const shape = normalizeBotAvatarType(botAvatarType) as BotAvatarType;
    const hex = color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : undefined;
    return (
      <span
        className={`flat-avatar flat-avatar-bot ${className}`.trim()}
        style={style}
        title={title}
      >
        <BotAvatar
          type={shape}
          state={busy ? 'working' : 'default'}
          size={resolvedSize}
          {...(hex ? { color: hex } : {})}
          interactive={false}
        />
      </span>
    );
  }

  // Empty / non-hex = 「默认」: emoji with no colored circle fill (transparent).
  const hex = color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '';
  return (
    <span
      className={`flat-avatar${hex ? '' : ' flat-avatar-emoji-bare'} ${className}`.trim()}
      style={{ ...(hex ? { background: hex } : { background: 'transparent' }), ...style }}
      title={title}
    >
      <span className="flat-avatar-emoji" aria-hidden>
        {emoji}
      </span>
    </span>
  );
}

export function SquadAvatar({
  members,
  className = '',
  style,
}: {
  members: Array<{ emoji: string; color: string }>;
  className?: string;
  style?: CSSProperties;
}) {
  // At most 4: 1 centered; 2 side-by-side; 3–4 = 2×2 田字格 (row-major, first 4).
  // Keep emoji/member collage — do not force bot-avatars into squad tiles.
  const cells = members.slice(0, 4);
  const n = Math.max(1, cells.length);
  const cellsClass = n <= 1 ? 'cells-1' : n === 2 ? 'cells-2' : 'cells-4';
  return (
    <span className={`squad-avatar ${cellsClass} ${className}`.trim()} style={style}>
      {cells.map((m, i) => (
        <span
          key={i}
          className="squad-avatar-cell"
          style={{
            background:
              m.color && /^#[0-9A-Fa-f]{6}$/.test(m.color) ? m.color : 'transparent',
          }}
        >
          <span className="squad-avatar-emoji" aria-hidden>
            {m.emoji}
          </span>
        </span>
      ))}
    </span>
  );
}
