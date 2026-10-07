import type { BotSkill } from '@okbot/shared';

/** Canonical skill directory / slug prefix. */
export const OKBOT_SKILL_SLUG_PREFIX = 'okbot-';

/**
 * Path-safe skill slug with mandatory `okbot-` prefix.
 * Bare and already-prefixed inputs normalize to the same canonical slug so
 * refresh / write never create bare + prefixed siblings.
 */
export function normalizeSkillSlug(raw: string): string {
  let s = (raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) return '';
  if (!s.startsWith(OKBOT_SKILL_SLUG_PREFIX)) {
    s = `${OKBOT_SKILL_SLUG_PREFIX}${s}`;
  }
  return s.slice(0, 64);
}

/** Ensure a display name starts with `okbot-` (preserves non-slug characters). */
export function ensureOkbotSkillName(raw: string, fallback = ''): string {
  let nm = (raw || '').trim() || fallback.trim();
  if (!nm) return '';
  if (!nm.startsWith(OKBOT_SKILL_SLUG_PREFIX)) nm = `${OKBOT_SKILL_SLUG_PREFIX}${nm}`;
  return nm;
}

/** Strip surrounding YAML quotes from a scalar. */
export function unquoteYamlScalar(v: string): string {
  const s = v.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/** Parse Agent Skills SKILL.md (YAML frontmatter or # title fallback). */
export function parseSkillMarkdown(slug: string, raw: string): BotSkill {
  let name = slug;
  let description = '';
  let body = raw;
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (fm) {
    const meta = fm[1]!;
    body = fm[2]!;
    const n = meta.match(/^name:\s*(.*)$/m);
    const d = meta.match(/^description:\s*(.*)$/m);
    if (n) name = unquoteYamlScalar(n[1]!.trim()) || name;
    if (d) description = unquoteYamlScalar(d[1]!.trim());
  } else {
    const title = raw.match(/^#\s+(.+)$/m);
    if (title) name = title[1]!.trim();
  }
  return { slug, name, description: description || name, body: body.trim() };
}

/** Serialize a BotSkill to SKILL.md with YAML frontmatter. */
export function formatSkillMarkdown(skill: Pick<BotSkill, 'slug' | 'name' | 'description' | 'body'>): string {
  const slug = normalizeSkillSlug(skill.slug);
  const nm = ensureOkbotSkillName(skill.name, slug).replace(/"/g, "'");
  const desc = (skill.description.trim() || nm).replace(/"/g, "'");
  const body = skill.body.trim();
  return [
    '---',
    `name: "${nm}"`,
    `description: "${desc}"`,
    '---',
    '',
    body,
    '',
  ].join('\n');
}
