/** Stable 约定 / 决定 lines pulled out of a rolling session summary. */

const SECTION_NAME = '目标|约定|决定|路径/命令|未完成|其他';
const MARKDOWN_HEAD = new RegExp(`^(#{1,6})\\s*(${SECTION_NAME})\\s*[:：]?\\s*(.*)$`);
const PLAIN_HEAD = new RegExp(`^(${SECTION_NAME})\\s*[:：]\\s*(.*)$`);

function sectionMatch(line: string): { name: string; rest: string } | null {
  const hashed = line.match(MARKDOWN_HEAD);
  if (hashed) return { name: hashed[2]!, rest: (hashed[3] || '').trim() };
  const plain = line.match(PLAIN_HEAD);
  if (plain) return { name: plain[1]!, rest: (plain[2] || '').trim() };
  return null;
}

function pushFact(facts: string[], raw: string): void {
  const fact = raw.replace(/^[-*•]\s*/, '').trim();
  if (!fact || fact === '无' || fact === '（无）' || fact === '(无)') return;
  for (const part of fact.split(/[、；;]+/)) {
    const piece = part.trim();
    if (!piece || piece === '无' || piece === '（无）' || piece === '(无)') continue;
    facts.push(piece);
  }
}

export function extractDurableFacts(summary: string): string[] {
  const facts: string[] = [];
  let capture = false;
  for (const rawLine of summary.split('\n')) {
    const line = rawLine.trim();
    const head = sectionMatch(line);
    if (head) {
      capture = head.name === '约定' || head.name === '决定';
      if (capture && head.rest) pushFact(facts, head.rest);
      continue;
    }
    if (!capture) continue;
    pushFact(facts, line);
  }
  return facts;
}

export function normalizeMemoryKey(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

/** Exact match, or containment when both sides are long enough to be the same fact. */
export function isDuplicateMemoryFact(fact: string, existing: string[]): boolean {
  const key = normalizeMemoryKey(fact);
  if (key.length < 2) return true;
  for (const item of existing) {
    const other = normalizeMemoryKey(item);
    if (!other) continue;
    if (other === key) return true;
    if (key.length >= 8 && other.length >= 8 && (other.includes(key) || key.includes(other))) {
      return true;
    }
  }
  return false;
}

export function dedupeMemoryFacts(facts: string[], existing: string[]): string[] {
  const out: string[] = [];
  const seen = existing.slice();
  for (const fact of facts) {
    const text = fact.trim();
    if (!text || isDuplicateMemoryFact(text, seen)) continue;
    out.push(text);
    seen.push(text);
  }
  return out;
}
