/**
 * Relevant-subset recall for prompt injection.
 * Inject pin + high-weight / relevant durables only — never dump the whole file.
 */

import {
  isMemoryInjectable,
  MEMORY_RECALL_DEFAULT_MAX_ENTRIES,
  type MemoryTier,
} from './memoryLifecycle.js';

/** Max unpinned candidates that may earn a soft hit per recall (keyword match, not injected). */
export const MEMORY_SOFT_HIT_MAX_PER_TURN = 8;

export type MemoryRecallRow = {
  id: string;
  memory: string;
  expires?: string | null;
  pinned?: boolean;
  tier?: MemoryTier;
  hits?: number;
  lastHitAt?: string | null;
  createdAt?: string | null;
};

export type MemoryRecallLimits = {
  maxEntries?: number;
  maxChars?: number;
  /** Recent user text (or turn query) for lightweight relevance. */
  query?: string;
};

type Scored = MemoryRecallRow & {
  scope: 'global' | 'bot';
  score: number;
  pinned: boolean;
  lineLen: number;
};

function tokenize(text: string): string[] {
  const raw = (text || '').toLowerCase();
  const parts = raw
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1);
  const out: string[] = [];
  for (const p of parts) {
    if (p.length >= 2) out.push(p);
    // CJK has no spaces: also emit overlapping bigrams for denser match.
    if (/[\u3400-\u9fff]/.test(p) && p.length >= 2) {
      for (let i = 0; i < p.length - 1; i++) out.push(p.slice(i, i + 2));
    }
  }
  return out;
}

/** Cheap lexical overlap score in [0, 1]. Empty query → 0. */
export function scoreMemoryRelevance(memoryText: string, query: string | undefined): number {
  const q = tokenize(query || '');
  if (!q.length) return 0;
  const mem = (memoryText || '').toLowerCase();
  const memTokens = new Set(tokenize(mem));
  let hit = 0;
  for (const t of q) {
    if (memTokens.has(t) || mem.includes(t)) hit += 1;
  }
  return hit / q.length;
}

function bulletLen(row: MemoryRecallRow): number {
  const pin = row.pinned ? 2 : 0;
  const exp = row.expires ? 20 : 0;
  return 8 + pin + row.id.length + row.memory.length + exp;
}

function toScored(
  scope: 'global' | 'bot',
  entries: MemoryRecallRow[],
  query: string | undefined,
): Scored[] {
  const out: Scored[] = [];
  for (const e of entries) {
    const pinned = e.pinned === true;
    const tier: MemoryTier = e.tier === 'candidate' ? 'candidate' : 'durable';
    if (!isMemoryInjectable(tier, pinned)) continue;
    const hits = typeof e.hits === 'number' && Number.isFinite(e.hits) ? e.hits : 0;
    const rel = scoreMemoryRelevance(e.memory, query);
    // Prefer: pin >> relevance >> hits >> global slightly >> recency via lastHitAt.
    const last = Date.parse(e.lastHitAt || e.createdAt || '') || 0;
    const recency = last > 0 ? Math.min(1, last / 1e13) : 0;
    const score =
      (pinned ? 1_000_000 : 0) +
      rel * 100 +
      hits * 3 +
      (scope === 'global' ? 1 : 0) +
      recency;
    out.push({
      ...e,
      scope,
      pinned,
      score,
      lineLen: bulletLen(e),
    });
  }
  return out;
}

export type MemoryRecallResult = {
  global: MemoryRecallRow[];
  local: MemoryRecallRow[];
  /** Ids selected for injection (both scopes) — for citation hit accounting. */
  selectedIds: string[];
  /**
   * Unpinned candidates that matched the query (keyword soft hits).
   * Not injected; bumps hits so Phase-2 auto-promote (hits>=PROMOTE_MIN) is reachable.
   */
  softHitIds: string[];
};

/**
 * Select pin + relevant/high-weight durable subset for the system prompt.
 * Candidates (unpinned) are excluded from injection. Caps by entry count then
 * char budget (hard-drop lowest score first).
 * When `query` is set, also returns softHitIds: top keyword-matching unpinned
 * candidates (not injected) so citation-path hits can accumulate toward promote.
 */
export function selectMemoriesForPrompt(
  globalEntries: MemoryRecallRow[],
  localEntries: MemoryRecallRow[],
  limits?: MemoryRecallLimits,
): MemoryRecallResult {
  const maxEntries = limits?.maxEntries ?? MEMORY_RECALL_DEFAULT_MAX_ENTRIES;
  const maxChars = limits?.maxChars ?? 4_000;
  const query = limits?.query;

  let scored = [
    ...toScored('global', globalEntries, query),
    ...toScored('bot', localEntries, query),
  ].sort((a, b) => b.score - a.score);

  // When query present, prefer relevant non-pinned over irrelevant high-hit noise:
  // already reflected in score via rel*100. Keep pinned always if under cap.

  while (scored.length > maxEntries) {
    // Drop lowest-score unpinned first; only drop pinned if nothing else.
    let at = -1;
    for (let i = scored.length - 1; i >= 0; i--) {
      if (!scored[i]!.pinned) {
        at = i;
        break;
      }
    }
    if (at < 0) at = scored.length - 1;
    scored.splice(at, 1);
  }

  let guard = 0;
  while (scored.length > 1 && scored.reduce((s, r) => s + r.lineLen + 1, 0) > maxChars && guard++ < 10_000) {
    let at = -1;
    for (let i = scored.length - 1; i >= 0; i--) {
      if (!scored[i]!.pinned) {
        at = i;
        break;
      }
    }
    if (at < 0) at = scored.length - 1;
    scored.splice(at, 1);
  }

  const global: MemoryRecallRow[] = [];
  const local: MemoryRecallRow[] = [];
  const selectedIds: string[] = [];
  for (const row of scored) {
    const slim: MemoryRecallRow = {
      id: row.id,
      memory: row.memory,
      expires: row.expires,
      ...(row.pinned ? { pinned: true } : {}),
      tier: row.tier,
      hits: row.hits,
      lastHitAt: row.lastHitAt,
      createdAt: row.createdAt,
    };
    if (row.scope === 'global') global.push(slim);
    else local.push(slim);
    selectedIds.push(row.id);
  }

  const softHitIds: string[] = [];
  if (query && query.trim()) {
    const selected = new Set(selectedIds);
    type Soft = { id: string; rel: number };
    const soft: Soft[] = [];
    for (const e of [...globalEntries, ...localEntries]) {
      if (selected.has(e.id)) continue;
      const pinned = e.pinned === true;
      const tier: MemoryTier = e.tier === 'candidate' ? 'candidate' : 'durable';
      // Soft hits only for unpinned candidates (durables already have citation path).
      if (pinned || tier !== 'candidate') continue;
      const rel = scoreMemoryRelevance(e.memory, query);
      if (rel <= 0) continue;
      soft.push({ id: e.id, rel });
    }
    soft.sort((a, b) => b.rel - a.rel);
    for (const s of soft.slice(0, MEMORY_SOFT_HIT_MAX_PER_TURN)) {
      softHitIds.push(s.id);
    }
  }

  return { global, local, selectedIds, softHitIds };
}
