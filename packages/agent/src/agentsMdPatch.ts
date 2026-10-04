import { stripThinkContent } from '@okbot/shared';

export type AgentsMdSectionPatch = { heading: string; body: string };

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

export function parseMarkdownSections(markdown: string): {
  preamble: string;
  sections: Array<{ level: number; heading: string; body: string }>;
} {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const preamble: string[] = [];
  const sections: Array<{ level: number; heading: string; body: string[] }> = [];
  let current: { level: number; heading: string; body: string[] } | null = null;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      if (!current) preamble.push(line);
      else current.body.push(line);
      continue;
    }
    const match = !inFence ? line.match(HEADING_RE) : null;
    if (match) {
      if (current) sections.push(current);
      current = { level: match[1]!.length, heading: match[2]!.trim(), body: [] };
      continue;
    }
    if (!current) preamble.push(line);
    else current.body.push(line);
  }
  if (current) sections.push(current);
  return {
    preamble: preamble.join('\n').replace(/\n+$/, ''),
    sections: sections.map((s) => ({
      level: s.level,
      heading: s.heading,
      body: s.body.join('\n').replace(/^\n+|\n+$/g, ''),
    })),
  };
}

function normHeading(heading: string): string {
  return heading.trim().replace(/^#+\s*/, '').replace(/\s+/g, '').toLowerCase();
}

function parseAgentsJson(text: string):
  | { action: 'none' }
  | { action: 'patch'; sections: AgentsMdSectionPatch[] }
  | null {
  let candidate = text.trim();
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    candidate = candidate.slice(start, end + 1);
  }
  try {
    const parsed = JSON.parse(candidate) as {
      action?: string;
      sections?: Array<{ heading?: string; body?: string }>;
    };
    if (parsed.action === 'none') return { action: 'none' };
    if (parsed.action === 'patch' && Array.isArray(parsed.sections)) {
      const sections = parsed.sections
        .map((s) => ({
          heading: String(s.heading || '').trim().replace(/^#+\s*/, ''),
          body: String(s.body ?? '').trim(),
        }))
        .filter((s) => s.heading && s.body);
      if (!sections.length) return { action: 'none' };
      return { action: 'patch', sections };
    }
  } catch {
    return null;
  }
  return null;
}

export function parseAgentsMdModelOutput(
  raw: string,
): { action: 'none' } | { action: 'patch'; sections: AgentsMdSectionPatch[] } | { action: 'reject' } {
  let text = stripThinkContent(raw).trim();
  if (!text || text === 'NO_CHANGE' || /^NO_CHANGE\b/i.test(text)) return { action: 'none' };
  const fenced = text.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1]!.trim();
  if (!text || text === 'NO_CHANGE' || /^NO_CHANGE\b/i.test(text)) return { action: 'none' };
  const fromJson = parseAgentsJson(text);
  if (fromJson) return fromJson;
  const parsed = parseMarkdownSections(text);
  if (!parsed.sections.length) return { action: 'reject' };
  const sections = parsed.sections
    .map((s) => ({ heading: s.heading, body: s.body.trim() }))
    .filter((s) => s.heading && s.body);
  if (!sections.length) return { action: 'none' };
  return { action: 'patch', sections };
}

/** True when the model tried to rewrite every existing section (full-file replace). */
export function isWholeFileReplacement(current: string, patches: AgentsMdSectionPatch[]): boolean {
  const existing = parseMarkdownSections(current).sections;
  // A one-section file cannot be distinguished from a full rewrite, and refusing
  // it makes every update a silent no-op. Only refuse when two or more sections
  // are all replaced.
  if (existing.length < 2) return false;
  const have = new Set(existing.map((s) => normHeading(s.heading)));
  const got = new Set(patches.map((p) => normHeading(p.heading)));
  if (got.size < have.size) return false;
  for (const heading of have) {
    if (!got.has(heading)) return false;
  }
  return true;
}

export function applyAgentsMdSectionPatches(current: string, patches: AgentsMdSectionPatch[]): string {
  const parsed = parseMarkdownSections(current);
  for (const patch of patches) {
    const key = normHeading(patch.heading);
    const idx = parsed.sections.findIndex((s) => normHeading(s.heading) === key);
    if (idx >= 0) {
      parsed.sections[idx] = { ...parsed.sections[idx]!, body: patch.body.trim() };
    } else {
      parsed.sections.push({
        level: 1,
        heading: patch.heading.replace(/^#+\s*/, '').trim(),
        body: patch.body.trim(),
      });
    }
  }
  const lines: string[] = [];
  if (parsed.preamble.trim()) {
    lines.push(parsed.preamble.trimEnd(), '');
  }
  for (const section of parsed.sections) {
    lines.push(`${'#'.repeat(section.level)} ${section.heading}`, '');
    if (section.body.trim()) lines.push(section.body.trim(), '');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`;
}

/**
 * Patch or append sections from a model update.
 * A full-file rewrite (every current heading replaced) is refused.
 * Unmentioned sections stay as they are.
 */
export function mergeAgentsMdFromModel(current: string, modelOutput: string): string | null {
  const parsed = parseAgentsMdModelOutput(modelOutput);
  if (parsed.action === 'reject') {
    console.warn('[okbot] AGENTS.md update was not applied: model output was not a section patch');
    return null;
  }
  if (parsed.action !== 'patch') return null;
  if (isWholeFileReplacement(current, parsed.sections)) return null;
  const next = applyAgentsMdSectionPatches(current, parsed.sections);
  if (next.trim() === current.trim()) return null;
  return next;
}
