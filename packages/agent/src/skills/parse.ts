import type { BotSkill } from '@okbot/shared';

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
  const slug = skill.slug.trim();
  const nm = (skill.name.trim() || slug).replace(/"/g, "'");
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
