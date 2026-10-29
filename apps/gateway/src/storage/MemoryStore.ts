import fs from 'node:fs';
import path from 'node:path';
import {
  type MemoryEntry,
  type SessionSummary,
  normalizeContextCompression,
  clampSessionSummary,
  stripThinkContent,
  normalizeMemoryExpires,
  isMemoryExpired,
  normalizeLifecycleFields,
  applyMemoryLifecyclePass,
  desensitizeMemoryText,
  selectMemoriesForPrompt,
} from '@okbot/shared';
import { ensureDir, writeJson, writeText } from './fs';
import { formatCappedMemoriesForPrompt } from './memoryPrompt';
import type { OwnerLifecycle } from './ownerLifecycle';

export type MemoryStoreDeps = {
  root: string;
  botDir(botId: string): string;
  ensureBotLayout(botId: string): void;
  assertKnownBotId(botId: string): void;
  getSettings(): { memory: { promptMaxEntries: number; promptMaxChars: number }; contextCompression: unknown };
};

function serializeEntry(e: MemoryEntry): Record<string, unknown> {
  const life = normalizeLifecycleFields(e);
  return {
    id: e.id,
    bot_id: e.bot_id,
    memory: e.memory,
    expires: e.expires,
    tier: life.tier,
    hits: life.hits,
    ...(life.pinned ? { pinned: true } : {}),
    ...(life.lastHitAt ? { lastHitAt: life.lastHitAt } : {}),
    ...(life.createdAt ? { createdAt: life.createdAt } : {}),
  };
}

function parseEntry(row: Partial<MemoryEntry>): MemoryEntry | null {
  if (!row.id || !row.bot_id || typeof row.memory !== 'string' || !row.memory.trim()) return null;
  const expires = normalizeMemoryExpires(row.expires);
  const life = normalizeLifecycleFields(row);
  return {
    id: String(row.id),
    bot_id: String(row.bot_id),
    memory: row.memory.trim(),
    expires,
    tier: life.tier,
    hits: life.hits,
    ...(life.pinned ? { pinned: true } : {}),
    ...(life.lastHitAt ? { lastHitAt: life.lastHitAt } : {}),
    ...(life.createdAt ? { createdAt: life.createdAt } : {}),
  };
}

/** Global + per-bot memory.md and session-summary.json. */
export class MemoryStore {
  constructor(
    private readonly life: OwnerLifecycle,
    private readonly deps: MemoryStoreDeps,
  ) {}

  globalMemoryPath(): string {
    return path.join(this.deps.root, 'memory.md');
  }

  botMemoryPath(botId: string): string {
    return path.join(this.deps.botDir(botId), 'memory.md');
  }

  ensureMemoryFile(file: string): void {
    ensureDir(path.dirname(file));
    if (!fs.existsSync(file)) {
      fs.writeFileSync(
        file,
        [
          '# OkBot Memory',
          '# 每行一条 JSON：id / bot_id / memory / expires / tier / hits / pinned',
          '',
        ].join('\n'),
        'utf8',
      );
    }
  }

  /**
   * Load memory.md JSONL. Lazy cleanup: expired rows dropped; lifecycle pass
   * promotes high-hit/pinned candidates, demotes stale zero-hit durables, and
   * soft-caps Top-N (only low-hit unpinned excess — see memoryLifecycle.ts).
   */
  readMemoryFile(file: string): MemoryEntry[] {
    this.ensureMemoryFile(file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const out: MemoryEntry[] = [];
    let purged = 0;
    const now = Date.now();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith('{')) continue;
      try {
        const row = JSON.parse(trimmed) as Partial<MemoryEntry>;
        const entry = parseEntry(row);
        if (!entry) continue;
        if (isMemoryExpired(entry.expires, now)) {
          purged += 1;
          continue;
        }
        out.push(entry);
      } catch {
        /* skip */
      }
    }
    const { rows, changed } = applyMemoryLifecyclePass(
      out.map((e) => {
        const life = normalizeLifecycleFields(e);
        return {
          ...e,
          tier: life.tier,
          hits: life.hits,
          pinned: life.pinned,
          createdAt: life.createdAt,
          lastHitAt: life.lastHitAt,
        };
      }),
      now,
    );
    const next: MemoryEntry[] = rows.map((r) => ({
      id: r.id,
      bot_id: r.bot_id,
      memory: r.memory,
      expires: r.expires,
      tier: r.tier,
      hits: r.hits,
      ...(r.pinned ? { pinned: true } : {}),
      ...(r.lastHitAt ? { lastHitAt: r.lastHitAt } : {}),
      ...(r.createdAt ? { createdAt: r.createdAt } : {}),
    }));
    if (purged > 0 || changed) {
      this.writeMemoryFile(file, next);
    }
    return next;
  }

  writeMemoryFile(file: string, entries: MemoryEntry[]): void {
    this.ensureMemoryFile(file);
    const header = [
      '# OkBot Memory',
      '# 每行一条 JSON：id / bot_id / memory / expires / tier / hits / pinned',
      '',
    ];
    const body = entries.map((e) => JSON.stringify(serializeEntry(e)));
    writeText(file, `${header.join('\n')}${body.join('\n')}${body.length ? '\n' : ''}`);
  }

  listGlobalMemories(): MemoryEntry[] {
    return this.readMemoryFile(this.globalMemoryPath());
  }

  listBotMemories(botId: string): MemoryEntry[] {
    this.deps.assertKnownBotId(botId);
    this.deps.ensureBotLayout(botId);
    return this.readMemoryFile(this.botMemoryPath(botId));
  }

  /** Upsert by id into global or bot memory.md */
  upsertMemory(scope: 'global' | 'bot', entry: MemoryEntry): void {
    if (scope === 'bot') this.deps.assertKnownBotId(entry.bot_id);
    const file = scope === 'global' ? this.globalMemoryPath() : this.botMemoryPath(entry.bot_id);
    if (scope === 'bot') this.deps.ensureBotLayout(entry.bot_id);
    const list = this.readMemoryFile(file);
    const idx = list.findIndex((e) => e.id === entry.id);
    const prev = idx >= 0 ? list[idx] : undefined;
    const life = normalizeLifecycleFields(entry);
    const prevLife = prev ? normalizeLifecycleFields(prev) : null;
    const memory = desensitizeMemoryText(stripThinkContent(entry.memory));
    const next: MemoryEntry = {
      id: entry.id,
      bot_id: entry.bot_id,
      memory,
      expires: normalizeMemoryExpires(entry.expires),
      tier: entry.tier != null ? life.tier : prevLife?.tier ?? life.tier,
      hits: entry.hits != null ? life.hits : prevLife?.hits ?? 0,
      ...(life.pinned || (entry.pinned === undefined && prevLife?.pinned)
        ? { pinned: true }
        : {}),
      lastHitAt:
        entry.lastHitAt !== undefined
          ? life.lastHitAt
          : prevLife?.lastHitAt ?? null,
      createdAt:
        entry.createdAt !== undefined
          ? life.createdAt
          : prevLife?.createdAt ?? new Date().toISOString(),
    };
    // Explicit unpin: pinned:false on entry clears pin.
    if (entry.pinned === false) {
      delete next.pinned;
    } else if (life.pinned) {
      next.pinned = true;
      if (next.tier === 'candidate') next.tier = 'durable';
    }
    if (!next.memory) {
      if (idx >= 0) {
        list.splice(idx, 1);
        this.writeMemoryFile(file, list);
      }
      return;
    }
    if (isMemoryExpired(next.expires)) {
      if (idx >= 0) {
        list.splice(idx, 1);
        this.writeMemoryFile(file, list);
      }
      return;
    }
    if (idx >= 0) list[idx] = next;
    else list.push(next);
    this.writeMemoryFile(file, list);
  }

  /** Delete a memory row by id from global or bot memory.md. */
  deleteMemory(scope: 'global' | 'bot', botId: string, memoryId: string): void {
    if (scope === 'bot') this.deps.assertKnownBotId(botId);
    const file = scope === 'global' ? this.globalMemoryPath() : this.botMemoryPath(botId);
    if (scope === 'bot') this.deps.ensureBotLayout(botId);
    const list = this.readMemoryFile(file).filter((e) => e.id !== memoryId);
    this.writeMemoryFile(file, list);
  }

  /**
   * Pin / unpin / promote / forget helpers for manage_memory tool.
   * forget = physical delete (explicit user/model action).
   */
  setMemoryPinned(
    scope: 'global' | 'bot',
    botId: string,
    memoryId: string,
    pinned: boolean,
  ): MemoryEntry | null {
    const list = scope === 'global' ? this.listGlobalMemories() : this.listBotMemories(botId);
    const row = list.find((e) => e.id === memoryId);
    if (!row) return null;
    const next: MemoryEntry = {
      ...row,
      pinned: pinned ? true : false,
      tier: pinned ? 'durable' : row.tier,
    };
    this.upsertMemory(scope, next);
    return this.readMemoryFile(
      scope === 'global' ? this.globalMemoryPath() : this.botMemoryPath(botId),
    ).find((e) => e.id === memoryId) || null;
  }

  promoteMemory(scope: 'global' | 'bot', botId: string, memoryId: string): MemoryEntry | null {
    const list = scope === 'global' ? this.listGlobalMemories() : this.listBotMemories(botId);
    const row = list.find((e) => e.id === memoryId);
    if (!row) return null;
    this.upsertMemory(scope, { ...row, tier: 'durable' });
    return (scope === 'global' ? this.listGlobalMemories() : this.listBotMemories(botId)).find(
      (e) => e.id === memoryId,
    ) || null;
  }

  /**
   * Bump hits + lastHitAt for selected ids in both scopes (prompt citation).
   *
   * No dedicated memory.md write lock: this RMW (and every other MemoryStore
   * mutator) is fully synchronous — Node/Electron main cannot interleave two
   * callers mid-read/write. Parallel turns (DEFAULT_MAX_PARALLEL_RUNS=3) only
   * overlap at await points outside these methods, so hit bumps cannot lose
   * updates to each other the way async session.jsonl RMW can. Session write
   * locks and withOwnerMaintenanceLock exist for those async gaps, not for
   * sync memory.md. See MemoryStore.hitsConcurrent.test.ts.
   */
  recordMemoryHits(botId: string, ids: string[], now: number = Date.now()): void {
    if (!ids.length) return;
    const idSet = new Set(ids);
    const iso = new Date(now).toISOString();
    const bump = (scope: 'global' | 'bot', fileBotId: string) => {
      const file = scope === 'global' ? this.globalMemoryPath() : this.botMemoryPath(fileBotId);
      if (scope === 'bot') {
        try {
          this.deps.assertKnownBotId(fileBotId);
        } catch {
          return;
        }
        this.deps.ensureBotLayout(fileBotId);
      }
      const list = this.readMemoryFile(file);
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        const row = list[i]!;
        if (!idSet.has(row.id)) continue;
        const hits = (row.hits || 0) + 1;
        list[i] = { ...row, hits, lastHitAt: iso };
        changed = true;
      }
      if (changed) this.writeMemoryFile(file, list);
    };
    bump('global', botId);
    bump('bot', botId);
  }


  /** Replace entire memory file contents (Phase 2 consolidation). */
  replaceAllMemories(scope: 'global' | 'bot', botId: string, entries: MemoryEntry[]): void {
    if (scope === 'bot') {
      this.deps.assertKnownBotId(botId);
      this.deps.ensureBotLayout(botId);
    }
    const file = scope === 'global' ? this.globalMemoryPath() : this.botMemoryPath(botId);
    const nowIso = new Date().toISOString();
    this.writeMemoryFile(
      file,
      entries.map((e) => {
        const life = normalizeLifecycleFields(e);
        return {
          id: e.id,
          bot_id: e.bot_id || (scope === 'bot' ? botId : 'global'),
          memory: desensitizeMemoryText(e.memory),
          expires: normalizeMemoryExpires(e.expires),
          tier: life.tier,
          hits: life.hits,
          ...(life.pinned ? { pinned: true as const } : {}),
          ...(life.lastHitAt ? { lastHitAt: life.lastHitAt } : {}),
          createdAt: life.createdAt || nowIso,
        };
      }),
    );
  }

  sessionSummaryPath(botId: string): string {
    return path.join(this.deps.botDir(botId), 'session-summary.json');
  }

  /** Raw session-summary.json (may lack summary — e.g. lastEffectiveModel only). */
  private readSessionSummaryRaw(botId: string): Partial<SessionSummary> | null {
    const file = this.sessionSummaryPath(botId);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SessionSummary>;
    } catch {
      return null;
    }
  }

  readSessionSummary(botId: string): SessionSummary | null {
    const raw = this.readSessionSummaryRaw(botId);
    if (!raw) return null;
    const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
    const coveredThroughId = typeof raw.coveredThroughId === 'string' ? raw.coveredThroughId : '';
    if (!summary || !coveredThroughId) return null;
    const lastEffectiveModel =
      typeof raw.lastEffectiveModel === 'string' ? raw.lastEffectiveModel.trim() : '';
    return {
      summary,
      coveredThroughId,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
      ...(lastEffectiveModel ? { lastEffectiveModel } : {}),
    };
  }

  /**
   * Last resolved model key for this owner (`effectiveModelKey`), or null if never recorded.
   * Readable even when summary/coveredThroughId are not yet set.
   */
  readLastEffectiveModel(botId: string): string | null {
    const raw = this.readSessionSummaryRaw(botId);
    if (!raw) return null;
    const key = typeof raw.lastEffectiveModel === 'string' ? raw.lastEffectiveModel.trim() : '';
    return key || null;
  }

  /**
   * Persist last effective model key without clobbering an existing summary.
   * Creates a minimal session-summary.json when none exists yet.
   */
  writeLastEffectiveModel(botId: string, modelKey: string): void {
    const key = (modelKey || '').trim();
    if (!key) return;
    this.deps.ensureBotLayout(botId);
    const existing = this.readSessionSummaryRaw(botId) || {};
    const summary = typeof existing.summary === 'string' ? existing.summary.trim() : '';
    const coveredThroughId =
      typeof existing.coveredThroughId === 'string' ? existing.coveredThroughId : '';
    const next: Record<string, string> = {
      lastEffectiveModel: key,
      updatedAt: new Date().toISOString(),
    };
    if (summary && coveredThroughId) {
      next.summary = summary;
      next.coveredThroughId = coveredThroughId;
    }
    writeJson(this.sessionSummaryPath(botId), next);
  }

  writeSessionSummary(botId: string, entry: SessionSummary): void {
    this.deps.ensureBotLayout(botId);
    const maxChars = normalizeContextCompression(
      this.deps.getSettings().contextCompression,
    ).summaryMaxChars;
    const existingKey =
      typeof entry.lastEffectiveModel === 'string' && entry.lastEffectiveModel.trim()
        ? entry.lastEffectiveModel.trim()
        : this.readLastEffectiveModel(botId);
    const next: SessionSummary = {
      summary: clampSessionSummary(stripThinkContent(entry.summary), maxChars),
      coveredThroughId: entry.coveredThroughId,
      updatedAt: entry.updatedAt || new Date().toISOString(),
      ...(existingKey ? { lastEffectiveModel: existingKey } : {}),
    };
    writeJson(this.sessionSummaryPath(botId), next);
  }

  /**
   * Inject pin + relevant/high-weight durable subset only.
   * When `recordHits`, bump citation counts for injected rows and soft-hit
   * keyword-matching unpinned candidates (chat turns; candidates stay off prompt).
   * Call sites (startBotTurn etc.) run this outside withOwnerMaintenanceLock;
   * that is intentional — the hit RMW is sync-atomic (see recordMemoryHits).
   */
  formatMemoriesForPrompt(
    botId: string,
    opts?: { query?: string; recordHits?: boolean },
  ): string {
    const mem = this.deps.getSettings().memory;
    const global = this.listGlobalMemories();
    const local = this.listBotMemories(botId);
    const selected = selectMemoriesForPrompt(global, local, {
      maxEntries: mem.promptMaxEntries,
      maxChars: mem.promptMaxChars,
      query: opts?.query,
    });
    if (opts?.recordHits) {
      const hitIds = [...selected.selectedIds, ...selected.softHitIds];
      if (hitIds.length) this.recordMemoryHits(botId, hitIds);
    }
    // Formatter still applies a safety cap; selection already ranked/subsetted.
    return formatCappedMemoriesForPrompt(selected.global, selected.local, {
      maxEntries: mem.promptMaxEntries,
      maxChars: mem.promptMaxChars,
    });
  }
}
