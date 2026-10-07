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
export const SKILL_CATALOG_MAX_ENTRIES = 40;
export const SKILL_CATALOG_MAX_CHARS = 4_000;

export function formatSkillCatalog(
  entries: SkillCatalogEntry[],
  limits?: { maxEntries?: number; maxChars?: number },
): string {
  if (!entries.length) return '';
  const maxEntries = limits?.maxEntries ?? SKILL_CATALOG_MAX_ENTRIES;
  const maxChars = limits?.maxChars ?? SKILL_CATALOG_MAX_CHARS;
  const kept: string[] = [];
  let chars = 0;
  for (const s of entries.slice(0, maxEntries)) {
    const title = s.global
      ? `### ${s.name} (\`${s.slug}\`) · 全局技能`
      : `### ${s.name} (\`${s.slug}\`)`;
    const block = [title, '', `何时使用：${s.description}`].join('\n');
    const sep = kept.length ? 2 : 0;
    if (chars + sep + block.length > maxChars) {
      if (kept.length) kept.push('…(技能目录已截断；可用 read_skill 按 slug 加载)');
      break;
    }
    kept.push(block);
    chars += sep + block.length;
  }
  return kept.join('\n\n');
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
