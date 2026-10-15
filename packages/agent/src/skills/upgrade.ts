import { normalizeSkillDescription, type BotSkill } from '@okbot/shared';
import { ensureOkbotSkillName, normalizeSkillSlug } from './parse.js';

/** Heading that marks a trigger/"when" section (must leave description, not body). */
const WHEN_HEADING_RE =
  /^(#{1,6}\s*)?(何时使用|When(?:\s+to\s+use)?|Use\s+when)\s*:?\s*$/i;

/** Optional Steps heading — kept if present; not required. */
const STEPS_HEADING_RE =
  /^(#{1,6}\s*)?(步骤|Steps|做法|执行步骤)\s*:?\s*$/i;

export type SkillFormatUpgrade = {
  skill: BotSkill;
  changed: boolean;
  /** True when a When/何时使用 section was moved out of body. */
  movedWhenFromBody: boolean;
};

/**
 * Split markdown body into leading prose + ##/# sections.
 * Returns sections in order; leading has heading "".
 */
function splitBodySections(body: string): Array<{ heading: string; text: string }> {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const sections: Array<{ heading: string; text: string }> = [];
  let heading = '';
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (heading || text) sections.push({ heading, text });
    buf = [];
  };
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) {
      flush();
      heading = line.trim();
      continue;
    }
    buf.push(line);
  }
  flush();
  return sections;
}

function isWhenHeading(heading: string): boolean {
  if (!heading) return false;
  const title = heading.replace(/^#{1,6}\s+/, '').trim();
  return WHEN_HEADING_RE.test(title) || WHEN_HEADING_RE.test(heading);
}

function descriptionHasWhenMarker(desc: string): boolean {
  return /何时使用|Use\s+when|When\s+to\s+use|勿用于|Do\s+NOT\s+use/i.test(desc);
}

/**
 * Trigger-only Chinese: 「用户…时使用。」→ keep as when-clause (no capability yet).
 */
function isTriggerOnlyZh(desc: string): boolean {
  const s = desc.trim();
  return /^用户.+时使用。?$/.test(s) && !descriptionHasWhenMarker(s);
}

/** Trigger-only English: 「Use when …」with no prior capability sentence. */
function isTriggerOnlyEn(desc: string): boolean {
  const s = desc.trim();
  return /^Use\s+when\b/i.test(s) && !/[.!?。]\s+Use\s+when/i.test(s);
}

/**
 * Infer a short verb-led capability from the first numbered/bulleted step,
 * or fall back to the skill slug (okbot-foo-bar → foo bar).
 */
function inferCapability(skill: BotSkill, lang: 'zh' | 'en'): string {
  const first = skill.body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^(\d+[\.\)、]|[-*])\s+/.test(l));
  if (first) {
    const step = first.replace(/^(\d+[\.\)、]|[-*])\s+/, '').trim();
    // Take up to first period / clause for a short capability line.
    const cut = step.split(/[。.!?;；]/)[0]?.trim() || step;
    if (cut.length >= 4 && cut.length <= 80) return cut.replace(/[。.!]+$/, '');
  }
  const bare = normalizeSkillSlug(skill.slug).replace(/^okbot-/, '').replace(/-/g, ' ');
  return lang === 'zh' ? `执行「${bare}」相关固定流程` : `Runs the ${bare} workflow`;
}

/**
 * Rewrite a trigger-only description into capability + 何时使用 / Use when.
 * Does not invent negative triggers.
 */
function rewriteTriggerOnlyDescription(desc: string, skill: BotSkill): string {
  if (isTriggerOnlyZh(desc)) {
    const when = desc.replace(/时使用。?$/, '').trim();
    const cap = inferCapability(skill, 'zh');
    return `${cap}。何时使用：${when}。`;
  }
  if (isTriggerOnlyEn(desc)) {
    const when = desc.replace(/^Use\s+when\s+/i, '').replace(/\.?\s*$/, '').trim();
    const cap = inferCapability(skill, 'en');
    return `${cap}. Use when ${when}.`;
  }
  return desc;
}

/**
 * Upgrade one skill to Cursor-style format:
 * - description = capability + when (+ optional negative); ≤1024
 * - body = steps only (no dedicated When/何时使用 section)
 *
 * Deterministic: moves body When sections into description; rewrites
 * trigger-only descriptions into capability + when. Leaves already-good
 * descriptions alone (aside from clamp / when-merge).
 */
export function upgradeSkillFormat(input: BotSkill): SkillFormatUpgrade {
  const slug = normalizeSkillSlug(input.slug) || input.slug.trim();
  const name = ensureOkbotSkillName(input.name, slug) || slug;
  let description = (input.description || '').trim();
  let body = (input.body || '').trim();
  let movedWhenFromBody = false;

  const sections = splitBodySections(body);
  const whenParts: string[] = [];
  const kept: Array<{ heading: string; text: string }> = [];
  for (const sec of sections) {
    if (isWhenHeading(sec.heading)) {
      if (sec.text) whenParts.push(sec.text);
      movedWhenFromBody = true;
      continue;
    }
    kept.push(sec);
  }

  if (movedWhenFromBody) {
    body = kept
      .map((s) => {
        if (!s.heading) return s.text;
        // Drop a lone top-level title that only repeats the skill name.
        if (/^#\s+/.test(s.heading) && !/^##/.test(s.heading)) {
          const title = s.heading.replace(/^#\s+/, '').trim();
          if (
            title === name ||
            title === slug ||
            title.toLowerCase() === slug.toLowerCase()
          ) {
            return s.text;
          }
        }
        return s.text ? `${s.heading}\n\n${s.text}` : s.heading;
      })
      .filter(Boolean)
      .join('\n\n')
      .trim();
    // Prefer keeping a Steps heading body as plain steps if the only structure
    // left is ## Steps / ## 步骤 wrapping the whole remainder.
    if (kept.length === 1 && STEPS_HEADING_RE.test(kept[0]!.heading.replace(/^#{1,6}\s+/, ''))) {
      body = kept[0]!.text;
    }
  }

  if (whenParts.length) {
    const whenBlob = whenParts.join('\n').replace(/\s+/g, ' ').trim();
    const langZh = /[\u4e00-\u9fff]/.test(description + whenBlob);
    if (!descriptionHasWhenMarker(description)) {
      description = description
        ? langZh
          ? `${description.replace(/[。.\s]+$/, '')}。何时使用：${whenBlob}`
          : `${description.replace(/[.!\s]+$/, '')}. Use when: ${whenBlob}`
        : langZh
          ? `执行固定流程。何时使用：${whenBlob}`
          : `Runs a fixed workflow. Use when: ${whenBlob}`;
    } else if (whenBlob && !description.includes(whenBlob.slice(0, Math.min(40, whenBlob.length)))) {
      // Description already has a when marker; append extracted detail if new.
      description = langZh
        ? `${description.replace(/[。.\s]+$/, '')}。补充：${whenBlob}`
        : `${description.replace(/[.!\s]+$/, '')}. Also: ${whenBlob}`;
    }
  }

  const beforeRewrite = description;
  description = rewriteTriggerOnlyDescription(description, {
    slug,
    name,
    description,
    body,
  });

  description = normalizeSkillDescription(description, name);

  const changed =
    movedWhenFromBody ||
    description !== (input.description || '').trim() ||
    body !== (input.body || '').trim() ||
    description !== beforeRewrite;

  return {
    skill: { slug, name, description, body },
    changed:
      changed ||
      slug !== input.slug ||
      name !== (input.name || '').trim() ||
      description !== (input.description || '').trim() ||
      body !== (input.body || '').trim(),
    movedWhenFromBody,
  };
}
