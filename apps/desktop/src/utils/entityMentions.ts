import type { BotAvatarKind, BotAvatarShape } from '@okbot/shared';

/** Entity kinds selectable from the composer `@` popover. */
export type MentionKind = 'bot' | 'squad' | 'schedule' | 'skill';

export type MentionEntityRef = {
  kind: MentionKind;
  id: string;
  /** Chip / list label. */
  label: string;
  emoji?: string;
  color?: string;
  avatarKind?: BotAvatarKind;
  botAvatarType?: BotAvatarShape;
  /** Secondary line in the popover (e.g. schedule label, skill description). */
  subtitle?: string;
};

/** @deprecated Prefer MentionEntityRef; kept for bubble bot-only call sites. */
export type MentionBotRef = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  avatarKind?: BotAvatarKind;
  botAvatarType?: BotAvatarShape;
};

export function botRefToEntity(bot: MentionBotRef): MentionEntityRef {
  return {
    kind: 'bot',
    id: bot.id,
    label: (bot.name || '').trim() || bot.id,
    emoji: bot.emoji,
    color: bot.color,
    avatarKind: bot.avatarKind,
    botAvatarType: bot.botAvatarType,
  };
}

export function entityToBotRef(e: MentionEntityRef): MentionBotRef {
  return {
    id: e.id,
    name: e.label,
    emoji: e.emoji || (e.kind === 'squad' ? '👥' : e.kind === 'schedule' ? '⏰' : e.kind === 'skill' ? '🧩' : '🤖'),
    color: e.color || '',
    avatarKind: e.avatarKind,
    botAvatarType: e.botAvatarType,
  };
}

export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; entity: MentionEntityRef; raw: string };

const MENTION_HREF_PREFIX = 'okbot-mention:';

/** Structured token inserted into composer draft / user message body. */
export const MENTION_TOKEN_RE =
  /@\[(bot|squad|schedule|skill):([^\]|]+)(?:\|([^\]]*))?\]/g;

export function isBotMentionHref(href: string | undefined | null): boolean {
  return typeof href === 'string' && href.startsWith(MENTION_HREF_PREFIX);
}

export function parseMentionHref(
  href: string,
): { kind: MentionKind; id: string } | null {
  if (!isBotMentionHref(href)) return null;
  const rest = href.slice(MENTION_HREF_PREFIX.length);
  const m = /^(bot|squad|schedule|skill):(.+)$/.exec(rest);
  if (m) return { kind: m[1] as MentionKind, id: m[2]! };
  // Legacy: okbot-mention:<botId>
  if (rest && !rest.includes(':')) return { kind: 'bot', id: rest };
  return null;
}

export function botIdFromMentionHref(href: string): string {
  return parseMentionHref(href)?.id ?? href.slice(MENTION_HREF_PREFIX.length);
}

export function mentionHrefForEntity(kind: MentionKind, id: string): string {
  return `${MENTION_HREF_PREFIX}${kind}:${id}`;
}

export function mentionHrefForBotId(botId: string): string {
  return mentionHrefForEntity('bot', botId);
}

/** Serialize a selected entity into a round-trippable composer token. */
export function formatMentionToken(entity: MentionEntityRef): string {
  const label = (entity.label || '').trim();
  const safeLabel = label.replace(/[\[\]]/g, '');
  if (safeLabel && safeLabel !== entity.id) {
    return `@[${entity.kind}:${entity.id}|${safeLabel}]`;
  }
  return `@[${entity.kind}:${entity.id}]`;
}

export function parseMentionToken(
  raw: string,
): { kind: MentionKind; id: string; label?: string } | null {
  const m = /^@\[(bot|squad|schedule|skill):([^\]|]+)(?:\|([^\]]*))?\]$/.exec(raw);
  if (!m) return null;
  return {
    kind: m[1] as MentionKind,
    id: m[2]!,
    label: m[3] || undefined,
  };
}

/**
 * Unique mention entities in draft order (structured tokens + legacy bot @Name).
 * Used by composer chip row.
 */
export function extractMentionEntities(
  text: string,
  catalog: readonly MentionEntityRef[] = [],
  opts?: MentionResolveOpts,
): MentionEntityRef[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: MentionEntityRef[] = [];
  for (const seg of splitEntityMentions(text, catalog, opts)) {
    if (seg.kind !== 'mention') continue;
    const key = `${seg.entity.kind}:${seg.entity.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(seg.entity);
  }
  return out;
}

/**
 * Visible composer text: drop structured `@[kind:id|label]` tokens so the
 * textarea never shows raw markup beside bubble-style chips.
 * Does not trim trailing spaces (user may be typing).
 */
export function stripMentionTokens(text: string): string {
  if (!text) return '';
  return text
    .replace(MENTION_TOKEN_RE, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^ /, '');
}

/**
 * Legacy helper: structured tokens first, then plain text.
 * Composer no longer uses this for @ insert (see insertMentionInDraft); kept for
 * tests / callers that want "all chips then body".
 */
export function composeDraftWithMentions(
  entities: readonly MentionEntityRef[],
  plainText: string,
): string {
  const tokens = entities.map(formatMentionToken);
  if (!tokens.length) return plainText;
  const plain = plainText.replace(/^\s+/, '');
  if (!plain) return tokens.join(' ');
  return `${tokens.join(' ')} ${plain}`;
}

/**
 * Insert a mention token in place of the live `@query` at queryStart in the
 * full draft (tokens already interleaved). Returns next draft + caret offset
 * after the chip (and trailing space when at end / needed before following text).
 */
export function insertMentionInDraft(
  draft: string,
  queryStart: number,
  query: string,
  entity: MentionEntityRef,
): { draft: string; caret: number } {
  const atLen = 1 + query.length;
  const start = Math.max(0, Math.min(queryStart, draft.length));
  const before = draft.slice(0, start);
  const after = draft.slice(start + atLen);
  const token = formatMentionToken(entity);
  const needsSpace = after.length > 0 && !/^[ \t\n]/.test(after);
  const gap = after.length === 0 || needsSpace ? ' ' : '';
  const next = `${before}${token}${gap}${after}`;
  return { draft: next, caret: before.length + token.length + gap.length };
}

/** Remove the first `@[kind:id|…]` occurrence for this entity from draft. */
export function removeMentionTokenFromDraft(
  draft: string,
  entity: MentionEntityRef,
): string {
  if (!draft) return '';
  const token = formatMentionToken(entity);
  let idx = draft.indexOf(token);
  let len = token.length;
  if (idx < 0) {
    const re = new RegExp(
      `@\\[${entity.kind}:${escapeRegExp(entity.id)}(?:\\|[^\\]]*)?\\]`,
    );
    const m = re.exec(draft);
    if (!m || m.index == null) return draft;
    idx = m.index;
    len = m[0].length;
  }
  const before = draft.slice(0, idx);
  const after = draft.slice(idx + len);
  return `${before}${after}`
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^ /, '')
    .replace(/\n{3,}/g, '\n\n');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sidebar / preview: show @label instead of raw structured tokens. */
export function humanizeMentionTokens(text: string): string {
  if (!text) return '';
  return text.replace(MENTION_TOKEN_RE, (_raw, _kind, id, label) => {
    const name = (label || id || '').trim() || id;
    return `@${name}`;
  });
}

function isEmailLocalCharBefore(text: string, atIndex: number): boolean {
  if (atIndex <= 0) return false;
  return /[A-Za-z0-9._%+-]/.test(text[atIndex - 1]!);
}

export type MentionResolveOpts = {
  preferBotId?: string;
};

function buildLegacyBotKeys(
  bots: readonly MentionBotRef[],
  opts?: MentionResolveOpts,
): { key: string; bot: MentionBotRef }[] {
  const preferId = (opts?.preferBotId || '').trim();
  const byId = new Map<string, MentionBotRef>();
  for (const bot of bots) {
    if (!bot?.id) continue;
    byId.set(bot.id, bot);
  }
  const keys: { key: string; bot: MentionBotRef }[] = [];
  const seen = new Set<string>();
  for (const bot of byId.values()) {
    if (!seen.has(bot.id)) {
      keys.push({ key: bot.id, bot });
      seen.add(bot.id);
    }
  }
  const byName = new Map<string, MentionBotRef[]>();
  for (const bot of byId.values()) {
    const name = (bot.name || '').trim();
    if (!name) continue;
    const list = byName.get(name);
    if (list) list.push(bot);
    else byName.set(name, [bot]);
  }
  for (const [name, list] of byName) {
    if (seen.has(name)) continue;
    let bot: MentionBotRef | undefined;
    if (list.length === 1) bot = list[0];
    else if (preferId) bot = list.find((b) => b.id === preferId);
    if (!bot) continue;
    keys.push({ key: name, bot });
    seen.add(name);
  }
  keys.sort((a, b) => b.key.length - a.key.length || a.key.localeCompare(b.key));
  return keys;
}

function entityFromCatalog(
  catalog: readonly MentionEntityRef[],
  kind: MentionKind,
  id: string,
  labelFallback?: string,
): MentionEntityRef {
  const hit = catalog.find((e) => e.kind === kind && e.id === id);
  if (hit) return hit;
  return {
    kind,
    id,
    label: (labelFallback || '').trim() || id,
    emoji:
      kind === 'squad' ? '👥' : kind === 'schedule' ? '⏰' : kind === 'skill' ? '🧩' : '🤖',
  };
}

/**
 * Split plain text into text / mention segments.
 * Prefers structured `@[kind:id|label]` tokens; also resolves legacy `@Name` / `@id` for bots.
 */
export function splitEntityMentions(
  text: string,
  catalog: readonly MentionEntityRef[],
  opts?: MentionResolveOpts,
): MentionSegment[] {
  if (!text) return [];
  const bots = catalog.filter((e) => e.kind === 'bot').map(entityToBotRef);
  const legacyKeys = buildLegacyBotKeys(bots, opts);
  const segments: MentionSegment[] = [];
  let i = 0;
  let textStart = 0;

  const flushText = (end: number) => {
    if (end > textStart) segments.push({ kind: 'text', text: text.slice(textStart, end) });
  };

  while (i < text.length) {
    // Structured token @[kind:id|label]
    if (text[i] === '@' && text[i + 1] === '[') {
      const close = text.indexOf(']', i + 2);
      if (close > i) {
        const raw = text.slice(i, close + 1);
        const parsed = parseMentionToken(raw);
        if (parsed) {
          flushText(i);
          segments.push({
            kind: 'mention',
            entity: entityFromCatalog(catalog, parsed.kind, parsed.id, parsed.label),
            raw,
          });
          i = close + 1;
          textStart = i;
          continue;
        }
      }
    }

    const ch = text[i];
    if ((ch === '@' || ch === '＠') && !isEmailLocalCharBefore(text, i)) {
      const after = text.slice(i + 1);
      let hit: { key: string; bot: MentionBotRef } | null = null;
      for (const cand of legacyKeys) {
        if (after.startsWith(cand.key)) {
          hit = cand;
          break;
        }
      }
      if (hit) {
        flushText(i);
        const raw = `${ch}${hit.key}`;
        segments.push({
          kind: 'mention',
          entity: botRefToEntity(hit.bot),
          raw,
        });
        i += raw.length;
        textStart = i;
        continue;
      }
    }

    if (ch === '「') {
      const close = text.indexOf('」', i + 1);
      if (close > i + 1) {
        const inner = text.slice(i + 1, close);
        const hit = legacyKeys.find((cand) => cand.key === inner) ?? null;
        if (hit) {
          flushText(i);
          const raw = text.slice(i, close + 1);
          segments.push({
            kind: 'mention',
            entity: botRefToEntity(hit.bot),
            raw,
          });
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

/** Back-compat wrapper: bot roster only. */
export function splitBotMentions(
  text: string,
  bots: readonly MentionBotRef[],
  opts?: MentionResolveOpts,
): Array<{ kind: 'text'; text: string } | { kind: 'mention'; bot: MentionBotRef; raw: string }> {
  return splitEntityMentions(text, bots.map(botRefToEntity), opts).map((s) =>
    s.kind === 'text'
      ? s
      : { kind: 'mention' as const, bot: entityToBotRef(s.entity), raw: s.raw },
  );
}

function replaceMentionsInPlain(
  text: string,
  catalog: readonly MentionEntityRef[],
  opts?: MentionResolveOpts,
): string {
  if (!text || !catalog.length) return text;
  return splitEntityMentions(text, catalog, opts)
    .map((s) =>
      s.kind === 'text'
        ? s.text
        : `[@${s.entity.label}](${mentionHrefForEntity(s.entity.kind, s.entity.id)})`,
    )
    .join('');
}

export function linkifyEntityMentions(
  md: string,
  catalog: readonly MentionEntityRef[],
  opts?: MentionResolveOpts,
): string {
  if (!md || !catalog.length) return md;
  const fenceSplit = md.split(/(```[\s\S]*?```)/g);
  return fenceSplit
    .map((chunk, idx) => {
      if (idx % 2 === 1) return chunk;
      return chunk
        .split(/(`[^`]*`)/g)
        .map((piece, j) =>
          j % 2 === 1 ? piece : replaceMentionsInPlain(piece, catalog, opts),
        )
        .join('');
    })
    .join('');
}

export function linkifyBotMentions(
  md: string,
  bots: readonly MentionBotRef[],
  opts?: MentionResolveOpts,
): string {
  return linkifyEntityMentions(md, bots.map(botRefToEntity), opts);
}

/** Active `@query` at caret in a plain draft (for composer popover). */
export function mentionQueryAtCaret(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const head = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  // Find last @ not part of a completed token / email.
  for (let i = head.length - 1; i >= 0; i -= 1) {
    const ch = head[i];
    if (ch === ']' && head.lastIndexOf('@[', i) >= 0) {
      // Inside or after a closed token — stop if this ] closes a token before caret.
      const open = head.lastIndexOf('@[', i);
      if (open >= 0 && !head.slice(open, i + 1).includes(' ')) {
        return null;
      }
    }
    if (ch === '@' || ch === '＠') {
      if (isEmailLocalCharBefore(head, i)) return null;
      // Do not treat start of `@[` structured token as a live query until user
      // somehow types it by hand mid-flight; popover only for bare @query.
      if (head[i + 1] === '[') return null;
      const query = head.slice(i + 1);
      // Query cannot contain whitespace (close popover after space).
      if (/[\s\n]/.test(query)) return null;
      return { start: i, query };
    }
    // Stop at whitespace / newline — @ must be in the current token.
    if (/\s/.test(ch!)) return null;
  }
  return null;
}

export function filterMentionCatalog(
  catalog: readonly MentionEntityRef[],
  query: string,
): MentionEntityRef[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...catalog];
  return catalog.filter((e) => {
    const hay = `${e.label} ${e.id} ${e.subtitle || ''}`.toLowerCase();
    return hay.includes(needle);
  });
}

export const MENTION_KIND_ORDER: MentionKind[] = ['bot', 'squad', 'schedule', 'skill'];

export function groupMentionsByKind(
  items: readonly MentionEntityRef[],
): { kind: MentionKind; items: MentionEntityRef[] }[] {
  const map = new Map<MentionKind, MentionEntityRef[]>();
  for (const k of MENTION_KIND_ORDER) map.set(k, []);
  for (const e of items) {
    const list = map.get(e.kind);
    if (list) list.push(e);
  }
  return MENTION_KIND_ORDER.map((kind) => ({ kind, items: map.get(kind) || [] })).filter(
    (g) => g.items.length > 0,
  );
}

/** Keep only schedules owned by the open session (bot or squad). Never cross-member. */
export function filterSchedulesForOwner<T extends { ownerId: string }>(
  jobs: readonly T[],
  ownerId: string | null | undefined,
): T[] {
  const id = (ownerId || '').trim();
  if (!id) return [];
  return jobs.filter((j) => (j.ownerId || '').trim() === id);
}

/**
 * Skills for the open session only.
 * - bot: that bot's local skills
 * - squad: union of that squad's member bots' local skills
 * Never merges another member outside the session, and does not pull global skills
 * into the `@` catalog (globals are not "当前成员").
 */
export function mergeOwnerScopedSkills<T extends { slug: string }>(
  localLists: readonly (readonly T[] | T[] | null | undefined)[],
): T[] {
  const bySlug = new Map<string, T>();
  for (const list of localLists) {
    for (const s of Array.isArray(list) ? list : []) {
      if (!s?.slug) continue;
      bySlug.set(s.slug, s);
    }
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}
