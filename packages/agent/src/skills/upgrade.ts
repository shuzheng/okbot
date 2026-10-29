import { normalizeSkillDescription, type BotSkill } from '@okbot/shared';
import { ensureOkbotSkillName, normalizeSkillSlug } from './parse.js';

/** Professional skill-template section headings (Zhihu / create-skills). */
const WHEN_SECTION_RE =
  /^(#{1,6}\s*)?(何时使用此技能|何时使用|When(?:\s+to\s+use(?:\s+this\s+skill)?)?|Use\s+when)\s*:?\s*$/i;
const HOW_SECTION_RE =
  /^(#{1,6}\s*)?(工作原理|步骤|Steps|做法|执行步骤|How\s+it\s+works)\s*:?\s*$/i;
const EXAMPLE_SECTION_RE =
  /^(#{1,6}\s*)?(示例|例子|Examples?)\s*:?\s*$/i;
const NOTES_SECTION_RE =
  /^(#{1,6}\s*)?(注意事项|注意|Notes?|Caveats?)\s*:?\s*$/i;

export type SkillFormatUpgrade = {
  skill: BotSkill;
  changed: boolean;
  /** True when body was reshaped into the professional template sections. */
  reshapedBody: boolean;
};

function splitBodySections(body: string): Array<{ heading: string; text: string }> {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const sections: Array<{ heading: string; text: string }> = [];
  let heading = '';
  let buf: string[] = [];
  /** Inside a fenced code block (` ``` ` / `~~~`); do not treat `#` lines as headings. */
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  const flush = () => {
    const text = buf.join('\n').trim();
    if (heading || text) sections.push({ heading, text });
    buf = [];
  };
  for (const line of lines) {
    const fence = line.match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const marker = fence[2]!;
      const ch = marker[0]!;
      const info = fence[3] ?? '';
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
        fenceLen = marker.length;
        buf.push(line);
        continue;
      }
      // Closing fence: same char, length >= open, info string empty/whitespace only.
      if (ch === fenceChar && marker.length >= fenceLen && /^\s*$/.test(info)) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
        buf.push(line);
        continue;
      }
    }
    if (!inFence) {
      const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (h) {
        flush();
        heading = line.trim();
        continue;
      }
    }
    buf.push(line);
  }
  flush();
  return sections;
}

function headingTitle(heading: string): string {
  return heading.replace(/^#{1,6}\s+/, '').trim();
}

function isH1(heading: string): boolean {
  return /^#\s+/.test(heading) && !/^##/.test(heading);
}

function matchSection(
  heading: string,
  re: RegExp,
): boolean {
  if (!heading) return false;
  const title = headingTitle(heading);
  return re.test(title) || re.test(heading);
}

/** Title-case a kebab slug for the H1, e.g. okbot-fix-bug → Okbot-fix-bug. */
function titleCaseSlug(slug: string): string {
  const s = (slug || '').trim();
  if (!s) return 'Skill';
  return s
    .split('-')
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join('-');
}

function skillH1(name: string, slug: string, lang: 'zh' | 'en'): string {
  const base = titleCaseSlug(slug || name);
  return lang === 'zh' ? `# ${base} 技能` : `# ${base} skill`;
}

function descriptionHasWhenMarker(desc: string): boolean {
  return /何时使用|Use\s+when|When\s+to\s+use/i.test(desc);
}

function isTriggerOnlyZh(desc: string): boolean {
  const s = desc.trim();
  return /^用户.+时使用。?$/.test(s) && !descriptionHasWhenMarker(s);
}

function isTriggerOnlyEn(desc: string): boolean {
  const s = desc.trim();
  return /^Use\s+when\b/i.test(s) && !/[.!?。]\s+Use\s+when/i.test(s);
}

function inferCapability(skill: BotSkill, lang: 'zh' | 'en'): string {
  const first = skill.body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^(\d+[\.\)、]|[-*])\s+/.test(l));
  if (first) {
    const step = first.replace(/^(\d+[\.\)、]|[-*])\s+/, '').trim();
    const cut = step.split(/[。.!?;；]/)[0]?.trim() || step;
    if (cut.length >= 4 && cut.length <= 80) return cut.replace(/[。.!]+$/, '');
  }
  const bare = normalizeSkillSlug(skill.slug).replace(/^okbot-/, '').replace(/-/g, ' ');
  return lang === 'zh' ? `执行「${bare}」相关固定流程` : `Runs the ${bare} workflow`;
}

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

function detectLang(text: string): 'zh' | 'en' {
  return /[\u4e00-\u9fff]/.test(text) ? 'zh' : 'en';
}

function whenBlurbFromDescription(desc: string, lang: 'zh' | 'en'): string {
  const s = desc.trim();
  if (!s) {
    return lang === 'zh' ? '当需要执行本技能的固定流程时使用。' : 'Use when this skill’s fixed workflow applies.';
  }
  // Prefer the clause after 何时使用： / Use when
  const zh = s.match(/何时使用[：:]\s*(.+?)(?:。\s*勿用于[：:].*)?$/);
  if (zh?.[1]) return `当需要${zh[1].replace(/^当需要/, '').replace(/。$/, '')}时使用此技能。`.replace(/时时/, '时');
  const en = s.match(/Use\s+when\s+(.+?)(?:\.\s*Do\s+NOT\s+use.*)?$/i);
  if (en?.[1]) return `Use when ${en[1].replace(/\.$/, '')}.`;
  // Strip trailing 勿用于 / Do NOT use from a capability+when one-liner.
  const stripped = s
    .replace(/。?\s*勿用于[：:].*$/u, '')
    .replace(/\.\s*Do\s+NOT\s+use.*/i, '')
    .trim();
  if (lang === 'zh') {
    if (/时使用/.test(stripped)) return stripped.endsWith('。') ? stripped : `${stripped}。`;
    return `当需要${stripped.replace(/。$/, '')}时使用此技能。`;
  }
  if (/^Use\s+when\b/i.test(stripped)) return stripped.endsWith('.') ? stripped : `${stripped}.`;
  return `Use when: ${stripped.replace(/\.$/, '')}.`;
}


function isCanonicalHeading(heading: string, kind: 'when' | 'how' | 'example' | 'notes', lang: 'zh' | 'en'): boolean {
  const title = headingTitle(heading);
  if (kind === 'when') {
    return lang === 'zh'
      ? title === '何时使用此技能'
      : /^When to use this skill$/i.test(title);
  }
  if (kind === 'how') {
    return lang === 'zh' ? title === '工作原理' : /^How it works$/i.test(title);
  }
  if (kind === 'example') {
    return lang === 'zh' ? title === '示例' : /^Examples?$/i.test(title);
  }
  return lang === 'zh' ? title === '注意事项' : /^Notes?$/i.test(title);
}

function hasProfessionalTemplate(sections: Array<{ heading: string; text: string }>): boolean {
  let when = false;
  let how = false;
  for (const sec of sections) {
    if (matchSection(sec.heading, WHEN_SECTION_RE)) when = true;
    if (matchSection(sec.heading, HOW_SECTION_RE)) how = true;
  }
  return when && how;
}

/**
 * Upgrade one skill to the professional Agent Skills template:
 * - description = when to use (≤1024); okbot- slug/name
 * - body = H1 + 何时使用此技能 / 工作原理 / 示例 / 注意事项
 *
 * Does NOT strip when-sections from body (unlike the prior Cursor-style pass).
 * Does NOT invent a do-not-use section.
 */
export function upgradeSkillFormat(input: BotSkill): SkillFormatUpgrade {
  const slug = normalizeSkillSlug(input.slug) || input.slug.trim();
  const name = ensureOkbotSkillName(input.name, slug) || slug;
  let description = (input.description || '').trim();
  let body = (input.body || '').trim();
  let reshapedBody = false;

  const lang = detectLang(`${description}\n${body}\n${name}`);
  description = rewriteTriggerOnlyDescription(description, {
    slug,
    name,
    description,
    body,
  });
  description = normalizeSkillDescription(description, name);

  const sections = splitBodySections(body);

  if (!body) {
    // Keep empty body empty — caller/refresh requires non-empty on upsert.
  } else if (hasProfessionalTemplate(sections)) {
    const whenH = lang === 'zh' ? '## 何时使用此技能' : '## When to use this skill';
    const howH = lang === 'zh' ? '## 工作原理' : '## How it works';
    const exH = lang === 'zh' ? '## 示例' : '## Examples';
    const notesH = lang === 'zh' ? '## 注意事项' : '## Notes';
    let sawH1 = false;
    let sawExample = false;
    let sawNotes = false;
    let needsCanon = false;
    for (const sec of sections) {
      if (isH1(sec.heading)) sawH1 = true;
      if (matchSection(sec.heading, EXAMPLE_SECTION_RE)) {
        sawExample = true;
        if (!isCanonicalHeading(sec.heading, 'example', lang)) needsCanon = true;
      }
      if (matchSection(sec.heading, NOTES_SECTION_RE)) {
        sawNotes = true;
        if (!isCanonicalHeading(sec.heading, 'notes', lang)) needsCanon = true;
      }
      if (matchSection(sec.heading, WHEN_SECTION_RE) && !isCanonicalHeading(sec.heading, 'when', lang)) {
        needsCanon = true;
      }
      if (matchSection(sec.heading, HOW_SECTION_RE) && !isCanonicalHeading(sec.heading, 'how', lang)) {
        needsCanon = true;
      }
    }
    if (sawH1 && sawExample && sawNotes && !needsCanon) {
      // Already on the professional template — leave body bytes alone.
    } else {
    const out: string[] = [];
    sawH1 = false;
    sawExample = false;
    sawNotes = false;
    for (const sec of sections) {
      if (!sec.heading) {
        if (sec.text) out.push(sec.text);
        continue;
      }
      if (isH1(sec.heading)) {
        sawH1 = true;
        out.push(skillH1(name, slug, lang));
        if (sec.text) out.push(sec.text);
        continue;
      }
      let h = sec.heading;
      if (matchSection(sec.heading, WHEN_SECTION_RE)) h = whenH;
      else if (matchSection(sec.heading, HOW_SECTION_RE)) h = howH;
      else if (matchSection(sec.heading, EXAMPLE_SECTION_RE)) {
        h = exH;
        sawExample = true;
      } else if (matchSection(sec.heading, NOTES_SECTION_RE)) {
        h = notesH;
        sawNotes = true;
      }
      out.push(sec.text ? `${h}\n\n${sec.text}` : h);
    }
    if (!sawH1) out.unshift(skillH1(name, slug, lang));
    if (!sawExample) out.push(`${exH}\n\n${lang === 'zh' ? '按实际调用场景补充示例。' : 'Add examples from real invocations.'}`);
    if (!sawNotes) out.push(`${notesH}\n\n${lang === 'zh' ? '按需补充边界与注意事项。' : 'Add caveats and boundaries as needed.'}`);
    const next = out.join('\n\n').trim();
    if (next !== body) {
      body = next;
      reshapedBody = true;
    }
    } // end needsCanon rebuild
  } else {
    // Reshape legacy step-only / mixed bodies into the professional template.
    let whenText = '';
    let howText = '';
    let exampleText = '';
    let notesText = '';
    const leading: string[] = [];

    for (const sec of sections) {
      if (!sec.heading) {
        if (sec.text) leading.push(sec.text);
        continue;
      }
      if (isH1(sec.heading)) {
        if (sec.text) leading.push(sec.text);
        continue;
      }
      if (matchSection(sec.heading, WHEN_SECTION_RE)) {
        if (sec.text) whenText = whenText ? `${whenText}\n\n${sec.text}` : sec.text;
        continue;
      }
      if (matchSection(sec.heading, HOW_SECTION_RE)) {
        if (sec.text) howText = howText ? `${howText}\n\n${sec.text}` : sec.text;
        continue;
      }
      if (matchSection(sec.heading, EXAMPLE_SECTION_RE)) {
        if (sec.text) exampleText = exampleText ? `${exampleText}\n\n${sec.text}` : sec.text;
        continue;
      }
      if (matchSection(sec.heading, NOTES_SECTION_RE)) {
        if (sec.text) notesText = notesText ? `${notesText}\n\n${sec.text}` : sec.text;
        continue;
      }
      // Unknown ## section: fold into 工作原理 to avoid dropping content.
      const block = sec.text ? `${sec.heading}\n\n${sec.text}` : sec.heading;
      howText = howText ? `${howText}\n\n${block}` : block;
    }

    if (!howText && leading.length) {
      howText = leading.join('\n\n').trim();
    } else if (leading.length) {
      howText = `${leading.join('\n\n').trim()}\n\n${howText}`.trim();
    }

    if (!whenText) whenText = whenBlurbFromDescription(description, lang);
    if (!howText) {
      howText =
        lang === 'zh'
          ? '1. 按对话中的固定步骤执行。'
          : '1. Follow the fixed steps from the conversation.';
    }
    if (!exampleText) {
      exampleText =
        lang === 'zh' ? '按实际调用场景补充示例。' : 'Add examples from real invocations.';
    }
    if (!notesText) {
      notesText =
        lang === 'zh' ? '按需补充边界与注意事项。' : 'Add caveats and boundaries as needed.';
    }

    const whenH = lang === 'zh' ? '## 何时使用此技能' : '## When to use this skill';
    const howH = lang === 'zh' ? '## 工作原理' : '## How it works';
    const exH = lang === 'zh' ? '## 示例' : '## Examples';
    const notesH = lang === 'zh' ? '## 注意事项' : '## Notes';

    body = [
      skillH1(name, slug, lang),
      '',
      whenH,
      whenText,
      '',
      howH,
      howText,
      '',
      exH,
      exampleText,
      '',
      notesH,
      notesText,
    ].join('\n').trim();
    reshapedBody = true;
  }

  const changed =
    reshapedBody ||
    slug !== input.slug ||
    name !== (input.name || '').trim() ||
    description !== (input.description || '').trim() ||
    body !== (input.body || '').trim();

  return {
    skill: { slug, name, description, body },
    changed,
    reshapedBody,
  };
}
