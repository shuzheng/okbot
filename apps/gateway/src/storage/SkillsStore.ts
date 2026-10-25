import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { type BotSkill, stripThinkContent } from '@okbot/shared';
import {
  parseSkillMarkdown,
  formatSkillMarkdown,
  formatSkillCatalog,
  buildSkillCatalogEntries,
  normalizeSkillSlug,
  upgradeSkillFormat,
} from '@okbot/agent';
import { ensureDir } from './fs';
import { sanitizeSkillSlug } from './ids';
import type { OwnerLifecycle } from './ownerLifecycle';
import type { BotConfig } from '@okbot/shared';

export type SkillsStoreDeps = {
  botSkillsDir(botId: string): string;
  ensureBotLayout(botId: string): void;
  assertKnownBotId(botId: string): void;
  readBotConfig(botId: string): BotConfig;
};

/** Per-bot skills/ + ~/.agents/skills catalog. */
export class SkillsStore {
  constructor(
    private readonly life: OwnerLifecycle,
    private readonly deps: SkillsStoreDeps,
  ) {}

  botSkillsDirPublic(botId: string): string {
    this.deps.assertKnownBotId(botId);
    return this.deps.botSkillsDir(botId);
  }

  /** Public `~/.agents/skills` for hot-reload. */
  globalAgentsSkillsDirPublic(): string {
    return this.globalAgentsSkillsDir();
  }

  private skillDir(botId: string, slug: string): string {
    return path.join(this.deps.botSkillsDir(botId), slug);
  }

  private skillFile(botId: string, slug: string): string {
    return path.join(this.skillDir(botId, slug), 'SKILL.md');
  }

  /**
   * Migrate bare skill dirs to canonical `okbot-*` names.
   * If bare exists and prefixed does not → rename; if both exist → drop bare.
   */
  migrateSkillDirsToCanonical(botId: string): void {
    const root = this.deps.botSkillsDir(botId);
    if (!fs.existsSync(root)) return;
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      const canon = normalizeSkillSlug(name);
      if (!canon || canon === name) continue;
      const dest = path.join(root, canon);
      if (!fs.existsSync(dest)) {
        fs.renameSync(dir, dest);
      } else {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  listSkills(botId: string): BotSkill[] {
    this.deps.assertKnownBotId(botId);
    this.deps.ensureBotLayout(botId);
    this.migrateSkillDirsToCanonical(botId);
    const root = this.deps.botSkillsDir(botId);
    if (!fs.existsSync(root)) return [];
    const out: BotSkill[] = [];
    for (const name of fs.readdirSync(root)) {
      const file = this.skillFile(botId, name);
      if (!fs.existsSync(file) || !fs.statSync(path.join(root, name)).isDirectory()) continue;
      try {
        const parsed = this.parseSkillMarkdown(name, fs.readFileSync(file, 'utf8'));
        const upgraded = upgradeSkillFormat(parsed);
        if (upgraded.changed) {
          const prevBody = (parsed.body || '').trim();
          const nextBody = (upgraded.skill.body || '').trim();
          // Never persist an upgrade that empties a previously non-empty body.
          if (!(prevBody && !nextBody)) {
            // Persist professional skill-template body (when/how/examples/notes) once.
            fs.writeFileSync(file, formatSkillMarkdown(upgraded.skill), 'utf8');
          }
        }
        out.push(upgraded.skill);
      } catch {
        /* skip bad skill */
      }
    }
    return out.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /** `~/.agents/skills` — user-global Agent Skills (SKILL.md per subdir). */
  private globalAgentsSkillsDir(): string {
    return path.join(os.homedir(), '.agents', 'skills');
  }

  listGlobalAgentsSkills(): BotSkill[] {
    const root = this.globalAgentsSkillsDir();
    if (!fs.existsSync(root)) return [];
    const out: BotSkill[] = [];
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      const file = path.join(dir, 'SKILL.md');
      try {
        if (!fs.statSync(dir).isDirectory() || !fs.existsSync(file)) continue;
        out.push(this.parseSkillMarkdown(name, fs.readFileSync(file, 'utf8')));
      } catch {
        /* skip bad skill */
      }
    }
    return out.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * Resolve one enabled skill for this bot: local `skills/<slug>` first, then
   * an enabled global skill under `~/.agents/skills` when useGlobalSkills is on.
   */
  resolveEnabledSkill(
    botId: string,
    slug: string,
  ): (BotSkill & { source: 'local' | 'global' }) | null {
    const clean = normalizeSkillSlug(slug) || slug.trim();
    if (!clean) return null;
    const local = this.listSkills(botId).find(
      (s) => s.slug === clean || normalizeSkillSlug(s.slug) === clean,
    );
    if (local) return { ...local, source: 'local' };
    try {
      const config = this.deps.readBotConfig(botId);
      const enabled = config.enabledGlobalSkills.some(
        (g) => g === clean || normalizeSkillSlug(g) === clean || g === slug.trim(),
      );
      if (config.useGlobalSkills && enabled) {
        const global = this.listGlobalAgentsSkills().find(
          (s) => s.slug === clean || normalizeSkillSlug(s.slug) === clean || s.slug === slug.trim(),
        );
        if (global) return { ...global, source: 'global' };
      }
    } catch {
      /* missing bot.json — local only */
    }
    return null;
  }

  /**
   * Catalog-only skills for system prompt: name / slug / when-to-use.
   * Full SKILL.md body is loaded on demand via the `read_skill` tool.
   */
  formatSkillsForPrompt(botId: string): string {
    const local = this.listSkills(botId);
    let useGlobalSkills = false;
    let enabledGlobalSkills: string[] = [];
    let global: BotSkill[] = [];
    try {
      const config = this.deps.readBotConfig(botId);
      useGlobalSkills = config.useGlobalSkills === true;
      enabledGlobalSkills = Array.isArray(config.enabledGlobalSkills)
        ? config.enabledGlobalSkills
        : [];
      if (useGlobalSkills) global = this.listGlobalAgentsSkills();
    } catch {
      /* missing bot.json — local only */
    }
    return formatSkillCatalog(
      buildSkillCatalogEntries({
        local,
        global,
        useGlobalSkills,
        enabledGlobalSkills,
      }),
      { maxEntries: 40, maxChars: 4_000 },
    );
  }

  writeSkill(botId: string, skill: BotSkill): void {
    this.deps.assertKnownBotId(botId);
    const slug = normalizeSkillSlug(skill.slug);
    if (!slug) throw new Error('invalid skill slug');
    this.deps.ensureBotLayout(botId);
    this.migrateSkillDirsToCanonical(botId);
    // Match existing by normalized slug: migrate bare → prefixed, never create a sibling.
    const root = this.deps.botSkillsDir(botId);
    if (fs.existsSync(root)) {
      for (const name of fs.readdirSync(root)) {
        if (normalizeSkillSlug(name) !== slug || name === slug) continue;
        const from = path.join(root, name);
        const to = path.join(root, slug);
        try {
          if (!fs.statSync(from).isDirectory()) continue;
        } catch {
          continue;
        }
        if (!fs.existsSync(to)) fs.renameSync(from, to);
        else fs.rmSync(from, { recursive: true, force: true });
      }
    }
    const dir = this.skillDir(botId, slug);
    ensureDir(dir);
    // Optional Agent Skills scaffold dirs (create-skills / Zhihu professional template).
    for (const sub of ['scripts', 'references', 'assets'] as const) {
      ensureDir(path.join(dir, sub));
    }
    const readme = path.join(dir, 'README.md');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, `# ${slug}\n\nSee SKILL.md.\n`, 'utf8');
    }
    const nm = stripThinkContent(skill.name).trim() || slug;
    const desc = stripThinkContent(skill.description).trim() || nm;
    const body = stripThinkContent(skill.body).trim();
    fs.writeFileSync(
      this.skillFile(botId, slug),
      formatSkillMarkdown({ slug, name: nm, description: desc, body }),
      'utf8',
    );
  }

  deleteSkill(botId: string, slug: string): void {
    this.deps.assertKnownBotId(botId);
    const clean = normalizeSkillSlug(slug) || sanitizeSkillSlug(slug);
    if (!clean) return;
    this.migrateSkillDirsToCanonical(botId);
    const root = path.resolve(this.deps.botSkillsDir(botId));
    const dir = path.resolve(this.skillDir(botId, clean));
    const rel = path.relative(root, dir);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('invalid skill path');
    }
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  parseSkillMarkdown(slug: string, raw: string): BotSkill {
    return parseSkillMarkdown(slug, raw);
  }
}
