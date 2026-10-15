import type { BotAvatarKind, BotAvatarShape } from '@okbot/shared';

/** Minimal bot fields needed to resolve and render @mentions. */
export type MentionBotRef = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  avatarKind?: BotAvatarKind;
  botAvatarType?: BotAvatarShape;
};

export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; bot: MentionBotRef; raw: string };

const MENTION_HREF_PREFIX = 'okbot-mention:';

export function isBotMentionHref(href: string | undefined | null): boolean {
  return typeof href === 'string' && href.startsWith(MENTION_HREF_PREFIX);
}

export function botIdFromMentionHref(href: string): string {
  return href.slice(MENTION_HREF_PREFIX.length);
}

export function mentionHrefForBotId(botId: string): string {
  return `${MENTION_HREF_PREFIX}${botId}`;
}

/** True when `@` is likely an email local-part boundary (ASCII word char before). */
function isEmailLocalCharBefore(text: string, atIndex: number): boolean {
  if (atIndex <= 0) return false;
  return /[A-Za-z0-9._%+-]/.test(text[atIndex - 1]!);
}

type MentionKey = { key: string; bot: MentionBotRef };

function buildMentionKeys(bots: readonly MentionBotRef[]): MentionKey[] {
  const keys: MentionKey[] = [];
  const seen = new Set<string>();
  for (const bot of bots) {
    if (!bot?.id) continue;
    const name = (bot.name || '').trim();
    if (name && !seen.has(name)) {
      keys.push({ key: name, bot });
      seen.add(name);
    }
    if (bot.id && !seen.has(bot.id)) {
      keys.push({ key: bot.id, bot });
      seen.add(bot.id);
    }
  }
  // Longest key first so "翻译助手" wins over "翻译".
  keys.sort((a, b) => b.key.length - a.key.length || a.key.localeCompare(b.key));
  return keys;
}

function uniqueBotsFromKeys(keys: MentionKey[]): MentionBotRef[] {
  const byId = new Map<string, MentionBotRef>();
  for (const k of keys) byId.set(k.bot.id, k.bot);
  return [...byId.values()];
}

/**
 * Split plain text into text / @bot mention segments.
 * Exact name or id match only (roster-driven); skips email-like `user@domain`.
 */
export function splitBotMentions(
  text: string,
  bots: readonly MentionBotRef[],
): MentionSegment[] {
  if (!text) return [];
  const keys = buildMentionKeys(bots);
  if (!keys.length) return [{ kind: 'text', text }];

  const segments: MentionSegment[] = [];
  let i = 0;
  let textStart = 0;

  const flushText = (end: number) => {
    if (end > textStart) {
      segments.push({ kind: 'text', text: text.slice(textStart, end) });
    }
  };

  while (i < text.length) {
    const ch = text[i];
    // ASCII @ or fullwidth ＠ (common in CJK paste), skip email-like locals.
    if ((ch === '@' || ch === '＠') && !isEmailLocalCharBefore(text, i)) {
      const after = text.slice(i + 1);
      let hit: MentionKey | null = null;
      for (const cand of keys) {
        if (after.startsWith(cand.key)) {
          hit = cand;
          break;
        }
      }
      if (hit) {
        flushText(i);
        const raw = `${ch}${hit.key}`;
        segments.push({ kind: 'mention', bot: hit.bot, raw });
        i += raw.length;
        textStart = i;
        continue;
      }
    }
    // Chinese book-title quotes around an exact roster name/id → chip.
    // Models often write「助手名」after prompts dropped tool-name prose.
    if (ch === '「') {
      const close = text.indexOf('」', i + 1);
      if (close > i + 1) {
        const inner = text.slice(i + 1, close);
        const hit = keys.find((cand) => cand.key === inner) ?? null;
        if (hit) {
          flushText(i);
          const raw = text.slice(i, close + 1);
          segments.push({ kind: 'mention', bot: hit.bot, raw });
          i = close + 1;
          textStart = i;
          continue;
        }
      }
    }
    i += 1;
  }
  flushText(text.length);
  return segments.length ? segments : [{ kind: 'text', text }];
}

function replaceMentionsInPlain(text: string, bots: readonly MentionBotRef[]): string {
  if (!text || !bots.length) return text;
  return splitBotMentions(text, bots)
    .map((s) =>
      s.kind === 'text'
        ? s.text
        : `[@${(s.bot.name || '').trim() || s.bot.id}](${mentionHrefForBotId(s.bot.id)})`,
    )
    .join('');
}

/**
 * Rewrite `@助手名` / `@id` outside fenced / inline code into markdown links
 * `[@显示名](okbot-mention:<id>)` for MarkdownContent to render as chips.
 */
export function linkifyBotMentions(md: string, bots: readonly MentionBotRef[]): string {
  if (!md || !bots.length) return md;
  const keys = buildMentionKeys(bots);
  if (!keys.length) return md;
  const roster = uniqueBotsFromKeys(keys);

  // Protect fenced code blocks first.
  const fenceSplit = md.split(/(```[\s\S]*?```)/g);
  return fenceSplit
    .map((chunk, idx) => {
      if (idx % 2 === 1) return chunk; // fenced
      // Protect inline code.
      return chunk
        .split(/(`[^`]*`)/g)
        .map((piece, j) => (j % 2 === 1 ? piece : replaceMentionsInPlain(piece, roster)))
        .join('');
    })
    .join('');
}
