import type { BotSkill } from '@okbot/shared';

export type SkillCatalogEntry = {
  slug: string;
  name: string;
  description: string;
  /** When true, labeled as global in the catalog. */
  global?: boolean;
};

/**
 * Progressive disclosure: system prompt gets name / slug / when-to-use only.
 * Full SKILL.md body is loaded on demand via `read_skill`.
 */
export function formatSkillCatalog(entries: SkillCatalogEntry[]): string {
  if (!entries.length) return '';
  return entries
    .map((s) => {
      const title = s.global
        ? `### ${s.name} (\`${s.slug}\`) · 全局技能`
        : `### ${s.name} (\`${s.slug}\`)`;
      return [title, '', `何时使用：${s.description}`].join('\n');
    })
    .join('\n\n');
}

/** Build catalog entries from local + enabled-global skills (local wins on slug clash). */
export function buildSkillCatalogEntries(input: {
  local: BotSkill[];
  global?: BotSkill[];
  useGlobalSkills?: boolean;
  enabledGlobalSkills?: string[];
}): SkillCatalogEntry[] {
  const out: SkillCatalogEntry[] = input.local.map((s) => ({
    slug: s.slug,
    name: s.name,
    description: s.description,
  }));
  const seen = new Set(out.map((e) => e.slug));
  if (input.useGlobalSkills && input.enabledGlobalSkills?.length) {
    const enabled = new Set(input.enabledGlobalSkills);
    for (const s of input.global ?? []) {
      if (!enabled.has(s.slug) || seen.has(s.slug)) continue;
      seen.add(s.slug);
      out.push({
        slug: s.slug,
        name: s.name,
        description: s.description,
        global: true,
      });
    }
  }
  return out;
}
