/**
 * Phase 2 — global consolidation: promote by hits/pin; soft-cap Top-N durables;
 * demote forgettable (zero-hit decay + low-hit excess). Same pass as readMemoryFile.
 * Orthogonal to session handoff summary / compression.
 *
 * Physical delete is NOT done here (only expired lazy-purge + explicit forget).
 */
import { applyMemoryLifecyclePass, normalizeLifecycleFields, type MemoryEntry } from '@okbot/shared';
import type { FileStorage } from './FileStorage';

export function consolidateMemoryFile(entries: MemoryEntry[]): {
  entries: MemoryEntry[];
  changed: boolean;
} {
  const mapped = entries.map((e) => {
    const life = normalizeLifecycleFields(e);
    return {
      ...e,
      tier: life.tier,
      hits: life.hits,
      pinned: life.pinned,
      createdAt: life.createdAt,
      lastHitAt: life.lastHitAt,
    };
  });
  const { rows, changed } = applyMemoryLifecyclePass(mapped);
  return {
    changed,
    entries: rows.map((r) => ({
      id: r.id,
      bot_id: r.bot_id,
      memory: r.memory,
      expires: r.expires,
      tier: r.tier,
      hits: r.hits,
      ...(r.pinned ? { pinned: true as const } : {}),
      ...(r.lastHitAt ? { lastHitAt: r.lastHitAt } : {}),
      ...(r.createdAt ? { createdAt: r.createdAt } : {}),
    })),
  };
}

/** Run Phase 2 consolidation for global + one bot memory files. */
export function consolidateMemoriesForBot(storage: FileStorage, botId: string): void {
  const global = storage.listGlobalMemories();
  const g = consolidateMemoryFile(global);
  if (g.changed) storage.replaceMemories('global', '', g.entries);

  const bot = storage.listBotMemories(botId);
  const b = consolidateMemoryFile(bot);
  if (b.changed) storage.replaceMemories('bot', botId, b.entries);
}
