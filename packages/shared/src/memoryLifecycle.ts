/**
 * Two-phase memory lifecycle (candidate → durable) + forgettable decay.
 *
 * Policy (documented):
 * - Phase 1 extraction writes `tier: 'candidate'` by default (not auto-injected).
 * - Phase 2 consolidation promotes by hits / pin; soft-caps durable Top-N.
 * - Hits: prompt citation bumps injectable rows; keyword soft-hits bump
 *   matching unpinned candidates (no injection) so hits>=PROMOTE_MIN is reachable.
 * - Top-N demote only demotes unpinned durables with hits < PROMOTE_MIN
 *   (soft over-cap when all excess are high-hit — avoids promote↔demote thrash).
 * - Forgettable: unpinned candidates stay off the prompt; long zero-hit
 *   unpinned durables are **demoted** to candidate (not physically deleted).
 * - Physical delete remains only for expired rows (lazy purge on load) or
 *   explicit forget/delete (UI / manage_memory).
 * - Legacy rows without `tier` migrate as `durable` so existing memories keep working.
 */

import { redactSensitiveText } from './text.js';

export type MemoryTier = 'candidate' | 'durable';

/** Hits needed for auto-promote candidate → durable (pin also promotes). */
export const MEMORY_PROMOTE_MIN_HITS = 2;

/** Unpinned durable with 0 hits older than this → demote to candidate. */
export const MEMORY_DECAY_ZERO_HIT_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Soft cap of durable rows per file.
 * Excess unpinned durables with hits < MEMORY_PROMOTE_MIN_HITS are demoted;
 * high-hit excess may temporarily exceed the cap (avoids thrash).
 */
export const MEMORY_DURABLE_TOP_N = 80;

/** Default recall injection cap (replaces dumping up to 40). */
export const MEMORY_RECALL_DEFAULT_MAX_ENTRIES = 16;

export type MemoryLifecycleFields = {
  tier: MemoryTier;
  hits: number;
  lastHitAt: string | null;
  createdAt: string | null;
  pinned: boolean;
};

/** Missing tier on disk → durable (backward compatible). */
export function normalizeMemoryTier(raw: unknown): MemoryTier {
  return raw === 'candidate' ? 'candidate' : 'durable';
}

export function normalizeMemoryHits(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Math.min(1_000_000, Math.floor(raw));
  }
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.min(1_000_000, Math.floor(n));
  }
  return 0;
}

export function normalizeMemoryIso(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (!s) return null;
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

export function normalizeLifecycleFields(
  row: Partial<{
    tier?: unknown;
    hits?: unknown;
    lastHitAt?: unknown;
    createdAt?: unknown;
    pinned?: unknown;
  }>,
): MemoryLifecycleFields {
  return {
    tier: normalizeMemoryTier(row.tier),
    hits: normalizeMemoryHits(row.hits),
    lastHitAt: normalizeMemoryIso(row.lastHitAt),
    createdAt: normalizeMemoryIso(row.createdAt),
    pinned: row.pinned === true,
  };
}

/**
 * Strip common secrets before persisting a memory fact.
 * Uses redactSensitiveText without a length cap so long facts stay intact.
 */
export function desensitizeMemoryText(text: string): string {
  return redactSensitiveText(text || '', undefined, Number.MAX_SAFE_INTEGER).trim();
}

/** Eligible for default prompt injection (pinned always; else durable only). */
export function isMemoryInjectable(tier: MemoryTier, pinned: boolean): boolean {
  if (pinned) return true;
  return tier === 'durable';
}

export function shouldPromoteToDurable(input: {
  tier: MemoryTier;
  hits: number;
  pinned: boolean;
}): boolean {
  if (input.tier === 'durable') return false;
  if (input.pinned) return true;
  return input.hits >= MEMORY_PROMOTE_MIN_HITS;
}

/**
 * Demote unpinned zero-hit durables that are older than MEMORY_DECAY_ZERO_HIT_MS.
 * Prefer demotion over delete. Missing createdAt → use lastHitAt, else treat as
 * old enough only when both timestamps missing and hits===0 after a long idle —
 * if both missing, skip demote (unknown age; safer).
 */
export function shouldDemoteToCandidate(
  input: {
    tier: MemoryTier;
    hits: number;
    pinned: boolean;
    createdAt: string | null;
    lastHitAt: string | null;
  },
  now: number = Date.now(),
): boolean {
  if (input.tier !== 'durable') return false;
  if (input.pinned) return false;
  if (input.hits > 0) return false;
  const anchor = input.lastHitAt || input.createdAt;
  if (!anchor) return false;
  const ts = Date.parse(anchor);
  if (!Number.isFinite(ts)) return false;
  return now - ts >= MEMORY_DECAY_ZERO_HIT_MS;
}

export type LifecycleRow = {
  id: string;
  tier: MemoryTier;
  hits: number;
  pinned: boolean;
  createdAt: string | null;
  lastHitAt: string | null;
};

/**
 * In-place lifecycle pass: promote candidates, demote stale durables, then
 * soft-cap Top-N by demoting excess unpinned durables with hits < PROMOTE_MIN
 * (lowest hits / oldest first). High-hit excess is kept (no promote↔demote thrash).
 * Does not physically delete.
 */
export function applyMemoryLifecyclePass<T extends LifecycleRow>(
  rows: T[],
  now: number = Date.now(),
  durableTopN: number = MEMORY_DURABLE_TOP_N,
): { rows: T[]; changed: boolean } {
  let changed = false;
  const next = rows.map((r) => {
    let tier = r.tier;
    if (shouldPromoteToDurable(r)) {
      tier = 'durable';
      changed = true;
    } else if (shouldDemoteToCandidate(r, now)) {
      tier = 'candidate';
      changed = true;
    }
    return tier === r.tier ? r : { ...r, tier };
  });

  const durables = next
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.tier === 'durable');
  if (durables.length > durableTopN) {
    const excess = durables.length - durableTopN;
    // Only demote low-hit unpinned durables. Demoting hits>=PROMOTE_MIN would
    // re-promote on the next pass → infinite changed:true rewrites on every read.
    const demotable = durables
      .filter(({ r }) => !r.pinned && r.hits < MEMORY_PROMOTE_MIN_HITS)
      .slice()
      .sort((a, b) => {
        if (a.r.hits !== b.r.hits) return a.r.hits - b.r.hits;
        const at = Date.parse(a.r.lastHitAt || a.r.createdAt || '') || 0;
        const bt = Date.parse(b.r.lastHitAt || b.r.createdAt || '') || 0;
        return at - bt;
      });
    const drop = new Set(demotable.slice(0, excess).map((x) => x.i));
    if (drop.size) {
      changed = true;
      for (const i of drop) {
        next[i] = { ...next[i]!, tier: 'candidate' };
      }
    }
  }

  return { rows: next, changed };
}
