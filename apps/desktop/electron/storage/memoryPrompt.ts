/**
 * Cap memories injected into the system prompt so the static block cannot fill the window.
 *
 * Priority (keep first):
 * 1. pinned rows (any scope)
 * 2. global rows (newest first)
 * 3. bot-local rows (newest first)
 *
 * Over the entry/char cap: drop or fold oldest unpinned first. Globals are preferred
 * over locals — never wipe all globals while only newest locals remain.
 */
export const MEMORY_PROMPT_MAX_ENTRIES = 40;
export const MEMORY_PROMPT_MAX_CHARS = 4_000;

export type MemoryPromptRow = {
  id: string;
  memory: string;
  expires?: string | null;
  pinned?: boolean;
};

function bullet(entry: MemoryPromptRow): string {
  const pin = entry.pinned ? '📌 ' : '';
  return `- [${entry.id}] ${pin}${entry.memory}${entry.expires ? `（过期 ${entry.expires}）` : ''}`;
}

type Tagged = {
  scope: 'global' | 'bot';
  pinned: boolean;
  id: string;
  line: string;
  memory: string;
};

function toTagged(scope: 'global' | 'bot', entries: MemoryPromptRow[]): Tagged[] {
  // Newest first within scope (file order is append order).
  return entries
    .slice()
    .reverse()
    .map((e) => ({
      scope,
      pinned: e.pinned === true,
      id: e.id,
      line: bullet(e),
      memory: e.memory,
    }));
}

function totalChars(rows: Tagged[]): number {
  return rows.reduce((sum, row) => sum + row.line.length + 1, 0);
}

/** Index of the oldest drop candidate (unpinned preferred; pinned only if nothing else). */
function dropIndex(rows: Tagged[]): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!rows[i]!.pinned && rows[i]!.id !== '__fold__') return i;
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.id !== '__fold__') return i;
  }
  return rows.length - 1;
}

/** Hard-drop one row (entry-cap path). Always shrinks length by 1. */
function dropOldest(rows: Tagged[]): Tagged[] {
  if (rows.length <= 1) return rows;
  const at = dropIndex(rows);
  return rows.filter((_, i) => i !== at);
}

/**
 * Char-cap path: fold the oldest unpinned into a single summary line.
 * Net length stays the same or shrinks; char count should fall.
 */
function foldOldest(rows: Tagged[], label: string): Tagged[] {
  if (rows.length <= 1) return rows;
  const at = dropIndex(rows);
  const dropped = rows[at]!;
  const kept = rows.filter((_, i) => i !== at);
  const piece = dropped.memory.trim().slice(0, 80);
  const foldIdx = kept.findIndex((r) => r.id === '__fold__');
  if (foldIdx >= 0) {
    const prev = kept[foldIdx]!;
    const mergedMem = `${prev.memory}；${piece}`;
    kept[foldIdx] = {
      ...prev,
      memory: mergedMem,
      line: `- （${label}：${mergedMem.slice(0, 120)}${mergedMem.length > 120 ? '…' : ''}）`,
    };
    return kept;
  }
  kept.push({
    scope: dropped.scope,
    pinned: false,
    id: '__fold__',
    memory: piece,
    line: `- （${label}：${piece}${dropped.memory.trim().length > 80 ? '…' : ''}）`,
  });
  return kept;
}

export function formatCappedMemoriesForPrompt(
  globalEntries: MemoryPromptRow[],
  localEntries: MemoryPromptRow[],
  limits?: { maxEntries?: number; maxChars?: number },
): string {
  const maxEntries = limits?.maxEntries ?? MEMORY_PROMPT_MAX_ENTRIES;
  const maxChars = limits?.maxChars ?? MEMORY_PROMPT_MAX_CHARS;

  const pinnedGlobal = toTagged(
    'global',
    globalEntries.filter((e) => e.pinned),
  );
  const pinnedLocal = toTagged(
    'bot',
    localEntries.filter((e) => e.pinned),
  );
  const plainGlobal = toTagged(
    'global',
    globalEntries.filter((e) => !e.pinned),
  );
  const plainLocal = toTagged(
    'bot',
    localEntries.filter((e) => !e.pinned),
  );

  let kept: Tagged[] = [...pinnedGlobal, ...pinnedLocal, ...plainGlobal, ...plainLocal];

  // Entry cap: hard-drop from the tail (oldest unpinned). Prefer dropping locals
  // that sit after globals in the preference list.
  let guard = 0;
  while (kept.length > maxEntries && guard++ < 10_000) {
    kept = dropOldest(kept);
  }

  // Char cap: fold oldest into one line before further hard drops.
  guard = 0;
  while (kept.length > 1 && totalChars(kept) > maxChars && guard++ < 10_000) {
    const before = totalChars(kept);
    const next = foldOldest(kept, '更早记忆已折叠');
    if (totalChars(next) >= before) {
      kept = dropOldest(kept);
    } else {
      kept = next;
    }
  }
  if (kept.length === 1 && kept[0]!.line.length > maxChars) {
    kept = [{ ...kept[0]!, line: kept[0]!.line.slice(0, maxChars) }];
  }

  const globalLines = kept.filter((row) => row.scope === 'global').map((row) => row.line);
  const localLines = kept.filter((row) => row.scope === 'bot').map((row) => row.line);
  const parts: string[] = [];
  if (globalLines.length) parts.push(['### 全局记忆', '', ...globalLines].join('\n'));
  if (localLines.length) parts.push(['### 本助手记忆', '', ...localLines].join('\n'));
  return parts.join('\n\n');
}
