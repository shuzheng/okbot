/** Sidebar 3D avatar motion: 静止 / 闲动画 / 忙动画. */

export const SESSION_AVATAR_IDLE_MS = 60_000; // 1 minute → 静止

export type SessionAvatarMotion = {
  /** Maps to bot-avatars `state="working"`. */
  busy: boolean;
  /** When false (and not busy), FlatAvatar freezes on the front-facing rest pose. */
  animate: boolean;
  /** Explicit pause — always paired with animate=false for 静止. */
  paused: boolean;
};

/**
 * Resolve sidebar session-list avatar motion.
 *
 * Rules:
 * 1. Active session → 闲动画
 * 2. Busy/executing → 忙动画 (overrides idle; any working session, not only active)
 * 3. Previously opened (has lastInteractedAt) within 1 minute → 闲动画
 * 4. No interaction for 1 minute (or never opened) → 静止
 * 5. 静止 is enforced by FlatAvatar via rest pose (not mid-frame freeze)
 */
export function resolveSessionAvatarMotion(opts: {
  active: boolean;
  busy: boolean;
  lastInteractedAt: number | undefined;
  now: number;
  idleMs?: number;
}): SessionAvatarMotion {
  if (opts.busy) {
    return { busy: true, animate: true, paused: false };
  }
  if (opts.active) {
    return { busy: false, animate: true, paused: false };
  }
  const idleMs = opts.idleMs ?? SESSION_AVATAR_IDLE_MS;
  const last = opts.lastInteractedAt;
  if (last != null && opts.now - last < idleMs) {
    return { busy: false, animate: true, paused: false };
  }
  return { busy: false, animate: false, paused: true };
}
