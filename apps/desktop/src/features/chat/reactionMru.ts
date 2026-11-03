import { DEFAULT_REACTION_EMOJIS } from '@okbot/shared';

const STORAGE_KEY = 'okbot.reactionMru';

export function loadReactionMru(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_REACTION_EMOJIS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_REACTION_EMOJIS];
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const e = item.trim();
      if (!e || out.includes(e)) continue;
      out.push(e);
      if (out.length >= 5) break;
    }
    for (const d of DEFAULT_REACTION_EMOJIS) {
      if (out.length >= 5) break;
      if (!out.includes(d)) out.push(d);
    }
    return out.slice(0, 5);
  } catch {
    return [...DEFAULT_REACTION_EMOJIS];
  }
}

/** Move emoji to slot 1 and persist (cap 5). */
export function rememberReactionEmoji(emoji: string): string[] {
  const e = emoji.trim();
  if (!e) return loadReactionMru();
  const next = [e, ...loadReactionMru().filter((x) => x !== e)].slice(0, 5);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}
