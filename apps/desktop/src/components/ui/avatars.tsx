import type { CSSProperties } from 'react';
import { BotAvatar, type BotAvatarType } from 'bot-avatars';
import {
  normalizeBotAvatarKind,
  normalizeBotAvatarType,
  type BotAvatarKind,
  type BotAvatarShape,
} from '@okbot/shared';

/** One tile in a squad collage (emoji or 3D bot-avatar). */
export type SquadAvatarMember = {
  emoji: string;
  color: string;
  avatarKind?: BotAvatarKind;
  botAvatarType?: BotAvatarShape;
};

/** Infer canvas px from common avatar classNames when `size` is omitted. */
function inferBotAvatarSize(className: string): number {
  if (className.includes('header-avatar') || className.includes('dock-tip-avatar')) return 22;
  if (className.includes('global-search-avatar') || className.includes('bubble-speaker-avatar')) return 28;
  if (className.includes('bot-picker-chip-avatar')) return 20;
  if (className.includes('bot-mention-chip-avatar')) return 14;
  if (className.includes('squad-role-row') || className.includes('squad-member')) return 28;
  if (className.includes('avatar-preview')) return 36;
  if (className.includes('bot-avatar-type-preview')) return 36;
  if (className.includes('session-pin-avatar')) return 56;
  if (className.includes('session-avatar')) return 36;
  return 36;
}

function DefaultAssistantMark({ title }: { title?: string }) {
  return (
    <span className="default-assistant-mark" title={title} aria-hidden>
      <svg viewBox="0 0 12 12" aria-hidden>
        {/* Fatter arms (higher inner radius); tips unchanged; slight downward optical bias. */}
        <path
          d="M6 1.58L7.31 4.42L10.37 4.76L8.11 6.9L8.7 9.9L6 8.44L3.3 9.9L3.89 6.9L1.63 4.76L4.69 4.42Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
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
  paused,
  animate = true,
  showDefaultMark = false,
  defaultMarkTitle,
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
  /** Freeze on the still pose (bot-avatars `paused`). Overrides `animate`. */
  paused?: boolean;
  /**
   * When false, idle bot-avatars stay still (working/`busy` still animates).
   * Use to limit concurrent canvas loops in dense lists/grids.
   */
  animate?: boolean;
  /** Bottom-right circular star mark for the user-chosen default assistant. */
  showDefaultMark?: boolean;
  defaultMarkTitle?: string;
}) {
  const kind = normalizeBotAvatarKind(avatarKind);
  const mark = showDefaultMark ? <DefaultAssistantMark title={defaultMarkTitle} /> : null;
  const markClass = showDefaultMark ? ' has-default-mark' : '';
  if (kind === 'bot-avatar') {
    const resolvedSize = size ?? inferBotAvatarSize(className);
    const shape = normalizeBotAvatarType(botAvatarType) as BotAvatarType;
    const hex = color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : undefined;
    // Working always moves; otherwise respect paused / animate budget.
    const motionPaused = paused === true || (animate === false && !busy);
    // bot-avatars `paused` freezes the *current* frame (mid-flip). For 静止 we
    // must force the face-on rest pose via `pose` (see restPose in the lib).
    const faceOnStill = motionPaused ? ({ yaw: 0 } as const) : undefined;
    return (
      <span
        className={`flat-avatar flat-avatar-bot${markClass} ${className}`.trim()}
        style={style}
        title={title}
      >
        <BotAvatar
          type={shape}
          state={busy ? 'working' : 'default'}
          size={resolvedSize}
          shading="plastic"
          {...(hex ? { color: hex } : {})}
          interactive={false}
          paused={motionPaused}
          {...(faceOnStill ? { pose: faceOnStill } : {})}
        />
        {mark}
      </span>
    );
  }

  // Empty / non-hex = 「默认」: emoji with no colored circle fill (transparent).
  const hex = color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '';
  return (
    <span
      className={`flat-avatar${hex ? '' : ' flat-avatar-emoji-bare'}${markClass} ${className}`.trim()}
      style={{ ...(hex ? { background: hex } : { background: 'transparent' }), ...style }}
      title={title}
    >
      <span className="flat-avatar-emoji" aria-hidden>
        {emoji}
      </span>
      {mark}
    </span>
  );
}

function cellBotSize(n: number, hostHintPx: number): number {
  // Collage tiles are small; keep 3D readable without overflowing the cell.
  if (n <= 1) return Math.max(14, Math.round(hostHintPx * 0.92));
  if (n === 2) return Math.max(12, Math.round(hostHintPx * 0.48));
  return Math.max(10, Math.round(hostHintPx * 0.42));
}

function inferSquadHostSize(className: string): number {
  if (className.includes('header-avatar') || className.includes('dock-tip-avatar')) return 22;
  if (className.includes('global-search-avatar')) return 28;
  if (className.includes('session-pin-avatar')) return 56;
  if (className.includes('session-avatar')) return 36;
  return 36;
}

export function SquadAvatar({
  members,
  className = '',
  style,
}: {
  members: SquadAvatarMember[];
  className?: string;
  style?: CSSProperties;
}) {
  // At most 4: 1 centered; 2 side-by-side; 3–4 = 2×2 田字格 (row-major, first 4).
  // Prefer each member's 3D bot-avatar when avatarKind is bot-avatar; else emoji tile.
  const cells = members.slice(0, 4);
  const n = Math.max(1, cells.length);
  const cellsClass = n <= 1 ? 'cells-1' : n === 2 ? 'cells-2' : 'cells-4';
  const hostPx = inferSquadHostSize(className);
  const botSize = cellBotSize(n, hostPx);
  return (
    <span className={`squad-avatar ${cellsClass} ${className}`.trim()} style={style}>
      {cells.map((m, i) => {
        const kind = normalizeBotAvatarKind(m.avatarKind);
        if (kind === 'bot-avatar') {
          return (
            <span key={i} className="squad-avatar-cell squad-avatar-cell-bot">
              <FlatAvatar
                className="squad-avatar-bot"
                emoji={m.emoji}
                color={m.color}
                avatarKind="bot-avatar"
                botAvatarType={m.botAvatarType}
                size={botSize}
                paused
                animate={false}
              />
            </span>
          );
        }
        return (
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
        );
      })}
    </span>
  );
}
