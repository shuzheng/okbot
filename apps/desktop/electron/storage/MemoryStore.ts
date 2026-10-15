import fs from 'node:fs';
import path from 'node:path';
import {
  type MemoryEntry,
  type SessionSummary,
  normalizeContextCompression,
  clampSessionSummary,
  stripThinkContent,
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
          '# 每行一条 JSON：id / bot_id / memory / expires（ISO 或 null）',
          '',
        ].join('\n'),
        'utf8',
      );
    }
  }

  readMemoryFile(file: string): MemoryEntry[] {
    this.ensureMemoryFile(file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const out: MemoryEntry[] = [];
    const now = Date.now();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.startsWith('{')) continue;
      try {
        const row = JSON.parse(trimmed) as Partial<MemoryEntry>;
        if (!row.id || !row.bot_id || typeof row.memory !== 'string' || !row.memory.trim()) continue;
        const expires = row.expires == null || row.expires === '' ? null : String(row.expires);
        if (expires) {
          const ts = Date.parse(expires);
          if (Number.isFinite(ts) && ts <= now) continue;
        }
        out.push({
          id: String(row.id),
          bot_id: String(row.bot_id),
          memory: row.memory.trim(),
          expires,
          ...(row.pinned === true ? { pinned: true } : {}),
        });
      } catch {
        /* skip */
      }
    }
    return out;
  }

  writeMemoryFile(file: string, entries: MemoryEntry[]): void {
    this.ensureMemoryFile(file);
    const header = [
      '# OkBot Memory',
      '# 每行一条 JSON：id / bot_id / memory / expires（ISO 或 null）',
      '',
    ];
    const body = entries.map((e) =>
      JSON.stringify({
        id: e.id,
        bot_id: e.bot_id,
        memory: e.memory,
        expires: e.expires,
        ...(e.pinned === true ? { pinned: true } : {}),
      }),
    );
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
    const next: MemoryEntry = {
      id: entry.id,
      bot_id: entry.bot_id,
      memory: stripThinkContent(entry.memory).trim(),
      expires: entry.expires,
      ...(entry.pinned === true ? { pinned: true } : {}),
    };
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


  sessionSummaryPath(botId: string): string {
    return path.join(this.deps.botDir(botId), 'session-summary.json');
  }

  readSessionSummary(botId: string): SessionSummary | null {
    const file = this.sessionSummaryPath(botId);
    if (!fs.existsSync(file)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SessionSummary>;
      const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
      const coveredThroughId = typeof raw.coveredThroughId === 'string' ? raw.coveredThroughId : '';
      if (!summary || !coveredThroughId) return null;
      return {
        summary,
        coveredThroughId,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  writeSessionSummary(botId: string, entry: SessionSummary): void {
    this.deps.ensureBotLayout(botId);
    const maxChars = normalizeContextCompression(
      this.deps.getSettings().contextCompression,
    ).summaryMaxChars;
    const next: SessionSummary = {
      summary: clampSessionSummary(stripThinkContent(entry.summary), maxChars),
      coveredThroughId: entry.coveredThroughId,
      updatedAt: entry.updatedAt || new Date().toISOString(),
    };
    writeJson(this.sessionSummaryPath(botId), next);
  }

  formatMemoriesForPrompt(botId: string): string {
    const mem = this.deps.getSettings().memory;
    return formatCappedMemoriesForPrompt(
      this.listGlobalMemories(),
      this.listBotMemories(botId),
      { maxEntries: mem.promptMaxEntries, maxChars: mem.promptMaxChars },
    );
  }
}
