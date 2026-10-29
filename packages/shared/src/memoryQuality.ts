/**
 * Legacy quality heuristics (length / bare UI·tool labels).
 * Not applied on the LLM memory write path — model owns quality; keep for
 * tests and any non-write callers (e.g. unused legacy dedupeMemoryFacts).
 */

/** Min significance units (~1 per CJK; 0.5 per Latin). 8 ≈ 「用户偏好中文回复」. */
export const MEMORY_FACT_MIN_SIGNIFICANCE = 8;

function isCjkChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x3400 && c <= 0x9fff) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0x3040 && c <= 0x30ff) ||
    (c >= 0xac00 && c <= 0xd7af)
  );
}

/**
 * Weighted length: CJK/kana/Hangul = 1; other non-whitespace = 0.5
 * (≈16 Latin letters ≈ 8 CJK).
 */
export function memorySignificanceLength(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (/\s/u.test(ch)) continue;
    n += isCjkChar(ch) ? 1 : 0.5;
  }
  return n;
}

/** Bare UI / tool crumbs that must never become durable memories alone. */
const BARE_UI_OR_TOOL_LABELS = new Set([
  '删除',
  '定时任务',
  '设置',
  '技能',
  '记忆',
  '压缩',
  '搜索',
  '附件',
  '日程',
  '助手',
  '小队',
  '工具',
  '审批',
  '托盘',
  '侧栏',
  '全局记忆',
  '系统指令',
  '上下文压缩',
  'manage_schedule',
  'manage_task_progress',
  'manage_memory',
  'send_message',
  'web_search',
  'web_fetch',
  'read_skill',
  'search_history',
]);

/**
 * Legacy predicate: empty / too-short / bare UI·tool labels fail.
 * Do not use to filter model-returned memory entries on the write path.
 */
export function isAcceptableMemoryFact(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const compact = trimmed.replace(/\s+/g, '');
  if (
    BARE_UI_OR_TOOL_LABELS.has(compact) ||
    BARE_UI_OR_TOOL_LABELS.has(compact.toLowerCase())
  ) {
    return false;
  }

  // Bare tool / slug identifiers with no sentence structure.
  if (/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(trimmed)) {
    return false;
  }

  if (memorySignificanceLength(trimmed) < MEMORY_FACT_MIN_SIGNIFICANCE) {
    return false;
  }

  return true;
}
