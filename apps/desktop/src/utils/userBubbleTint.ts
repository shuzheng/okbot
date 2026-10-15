/**
 * Assistant accent → user-send bubble wash.
 * Empty / non-hex = no tint (default --bubble-user).
 * Squad has no squad-level color field; tint only applies in 1:1 bot chats.
 */

const HEX6 = /^#[0-9A-Fa-f]{6}$/;

/** True when `color` is a usable #RRGGBB accent (same rule as FlatAvatar). */
export function isAvatarAccentHex(color: string | undefined | null): color is string {
  return typeof color === 'string' && HEX6.test(color);
}

/**
 * CSS custom props for `.messages.has-user-bubble-tint`.
 * Sets `--user-bubble-accent`; CSS mixes it toward `--chat-bg` and uses `--text`.
 */
export function userBubbleTintStyle(
  color: string | undefined | null,
): Record<string, string> | undefined {
  if (!isAvatarAccentHex(color)) return undefined;
  return { ['--user-bubble-accent' as string]: color };
}
