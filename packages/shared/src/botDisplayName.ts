/**
 * Assistant (bot) display-name helpers.
 * Comparison is trimmed string equality (case-sensitive), matching roster/bot.json reads.
 */

export const DEFAULT_BOT_DISPLAY_NAME = '未命名助手';

/** Trim; empty / non-string → default display name. */
export function normalizeBotDisplayName(name: unknown): string {
  return typeof name === 'string' && name.trim() ? name.trim() : DEFAULT_BOT_DISPLAY_NAME;
}

/** True when another roster entry already uses this display name. */
export function isBotDisplayNameTaken(
  existingNames: ReadonlyArray<string>,
  name: unknown,
): boolean {
  const want = normalizeBotDisplayName(name);
  return existingNames.some((n) => normalizeBotDisplayName(n) === want);
}

/**
 * Import collision rename: keep `base` when free; otherwise `base-2`, `base-3`, …
 * (suffix starts at 2). Preserves the desired base and only appends `-${n}`.
 */
export function allocateUniqueBotDisplayName(
  existingNames: ReadonlyArray<string>,
  desired: unknown,
): string {
  const taken = new Set(existingNames.map((n) => normalizeBotDisplayName(n)));
  const base = normalizeBotDisplayName(desired);
  if (!taken.has(base)) return base;
  let n = 2;
  for (;;) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
    n += 1;
  }
}
