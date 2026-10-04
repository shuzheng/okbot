/**
 * Cap memories injected into the system prompt so the static block cannot fill the window.
 * Keeps the newest rows (file order is append order). Over the char cap, oldest rows are dropped,
 * then a single remaining row is trimmed.
 */
export const MEMORY_PROMPT_MAX_ENTRIES = 40;
export const MEMORY_PROMPT_MAX_CHARS = 4_000;

export type MemoryPromptRow = {
  id: string;
  memory: string;
  expires?: string | null;
};

function bullet(entry: MemoryPromptRow): string {
  return `- [${entry.id}] ${entry.memory}${entry.expires ? `（过期 ${entry.expires}）` : ''}`;
}

export function formatCappedMemoriesForPrompt(
  globalEntries: MemoryPromptRow[],
  localEntries: MemoryPromptRow[],
  limits?: { maxEntries?: number; maxChars?: number },
): string {
  const maxEntries = limits?.maxEntries ?? MEMORY_PROMPT_MAX_ENTRIES;
  const maxChars = limits?.maxChars ?? MEMORY_PROMPT_MAX_CHARS;
  type Tagged = { scope: 'global' | 'bot'; line: string };
  let kept: Tagged[] = [
    ...globalEntries.map((e) => ({ scope: 'global' as const, line: bullet(e) })),
    ...localEntries.map((e) => ({ scope: 'bot' as const, line: bullet(e) })),
  ];
  if (kept.length > maxEntries) kept = kept.slice(kept.length - maxEntries);
  const size = () => kept.reduce((sum, row) => sum + row.line.length + 1, 0);
  while (kept.length > 1 && size() > maxChars) kept.shift();
  if (kept.length === 1 && kept[0]!.line.length > maxChars) {
    kept = [{ ...kept[0]!, line: kept[0]!.line.slice(0, maxChars) }];
  }
  const globalLines = kept.filter((row) => row.scope === 'global').map((row) => row.line);
  const localLines = kept.filter((row) => row.scope === 'bot').map((row) => row.line);
  const parts: string[] = [];
  if (globalLines.length) parts.push(['### 全局记忆', '', ...globalLines].join('\n'));
  if (localLines.length) parts.push(['### 本机器人记忆', '', ...localLines].join('\n'));
  return parts.join('\n\n');
}
