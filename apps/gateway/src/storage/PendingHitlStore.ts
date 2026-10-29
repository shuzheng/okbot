import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, writeJson } from './fs';
import { assertSafeOwnerSegment } from './ids';
import type { OwnerLifecycle } from './ownerLifecycle';
import type { PendingHitlRecord } from './types';
import type { BotRosterEntry, Squad } from '@okbot/shared';

export type PendingHitlStoreDeps = {
  botDir(botId: string): string;
  ensureBotLayout(botId: string): void;
  listRoster(): BotRosterEntry[];
  listSquads(): Squad[];
};

/** Multi-slot pending-hitl/ + squad resume replies. */
export class PendingHitlStore {
  constructor(
    private readonly life: OwnerLifecycle,
    private readonly deps: PendingHitlStoreDeps,
  ) {}

  /** Legacy `~/.okbot/<owner>/pending-hitl.json` — one record per owner. Read-only now. */
  private legacyPendingHitlFile(botId: string): string {
    return path.join(this.deps.botDir(botId), 'pending-hitl.json');
  }

  /** `~/.okbot/<owner>/pending-hitl/<requestId>.json` — one file per pending approval. */
  private pendingHitlDir(botId: string): string {
    return path.join(this.deps.botDir(botId), 'pending-hitl');
  }

  private pendingHitlRequestFile(botId: string, requestId: string): string {
    return path.join(this.pendingHitlDir(botId), `${assertSafeOwnerSegment(requestId)}.json`);
  }

  /** Squad cold resume: member replies already collected for one captain turn. */
  private squadResumeFile(squadId: string, turnId: string): string {
    return path.join(this.deps.botDir(squadId), 'pending-hitl-replies', `${assertSafeOwnerSegment(turnId)}.json`);
  }

  isPendingHitlRecord(raw: unknown): raw is PendingHitlRecord {
    if (!raw || typeof raw !== 'object') return false;
    const o = raw as Record<string, unknown>;
    return (
      o.v === 1 &&
      typeof o.requestId === 'string' &&
      typeof o.messageId === 'string' &&
      typeof o.toolName === 'string' &&
      typeof o.serializedRunState === 'string' &&
      typeof o.createdAt === 'string'
    );
  }

  savePendingHitl(botId: string, data: PendingHitlRecord): void {
    this.deps.ensureBotLayout(botId);
    const record: PendingHitlRecord = {
      v: 1,
      requestId: data.requestId,
      messageId: data.messageId,
      toolName: data.toolName,
      ...(typeof data.callId === 'string' && data.callId.trim() ? { callId: data.callId.trim() } : {}),
      arguments: data.arguments,
      serializedRunState: data.serializedRunState,
      createdAt: data.createdAt || new Date().toISOString(),
      ...(typeof data.computerId === 'string' && data.computerId.trim()
        ? { computerId: data.computerId.trim() }
        : {}),
      ...(typeof data.userText === 'string' && data.userText
        ? { userText: data.userText }
        : {}),
      ...(data.squadMember && typeof data.squadMember.botId === 'string'
        ? {
            squadMember: {
              botId: data.squadMember.botId,
              toolName: String(data.squadMember.toolName || ''),
              task: String(data.squadMember.task || ''),
            },
          }
        : {}),
      ...(typeof data.turnId === 'string' && data.turnId ? { turnId: data.turnId } : {}),
    };
    this.life.assertOwnerAlive(botId);
    ensureDir(this.pendingHitlDir(botId));
    writeJson(this.pendingHitlRequestFile(botId, record.requestId), record);
  }

  /** Every pending approval for one owner (parallel squad members get one file each). */
  listPendingHitl(botId: string): PendingHitlRecord[] {
    const out: PendingHitlRecord[] = [];
    const seen = new Set<string>();
    const push = (raw: unknown) => {
      if (!this.isPendingHitlRecord(raw) || seen.has(raw.requestId)) return;
      seen.add(raw.requestId);
      out.push(raw);
    };
    const dir = this.pendingHitlDir(botId);
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        try {
          push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
        } catch {
          /* skip unreadable */
        }
      }
    }
    const legacy = this.legacyPendingHitlFile(botId);
    if (fs.existsSync(legacy)) {
      try {
        const raw = JSON.parse(fs.readFileSync(legacy, 'utf8')) as unknown;
        if (Array.isArray(raw)) raw.forEach(push);
        else push(raw);
      } catch {
        /* skip unreadable */
      }
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    return out;
  }

  /** Oldest pending approval for one owner, or null. */
  loadPendingHitl(botId: string): PendingHitlRecord | null {
    return this.listPendingHitl(botId)[0] ?? null;
  }

  /** Drop one approval. Other parallel approvals of the same owner stay. */
  clearPendingHitlRequest(botId: string, requestId: string): void {
    const id = (requestId || '').trim();
    if (!id) return;
    try {
      const file = this.pendingHitlRequestFile(botId, id);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
    const legacy = this.legacyPendingHitlFile(botId);
    if (fs.existsSync(legacy)) {
      try {
        const raw = JSON.parse(fs.readFileSync(legacy, 'utf8')) as { requestId?: unknown };
        if (raw && raw.requestId === id) fs.unlinkSync(legacy);
      } catch {
        /* ignore */
      }
    }
  }

  /** Drop every pending approval of one owner (stop, steer, delete, quit). */
  clearPendingHitl(botId: string): void {
    const legacy = this.legacyPendingHitlFile(botId);
    if (fs.existsSync(legacy)) {
      try {
        fs.unlinkSync(legacy);
      } catch {
        /* ignore */
      }
    }
    for (const dir of [this.pendingHitlDir(botId), path.dirname(this.squadResumeFile(botId, 'x'))]) {
      if (!fs.existsSync(dir)) continue;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  readSquadResumeReplies(
    squadId: string,
    turnId: string,
  ): Array<{ memberBotId: string; memberName: string; task: string; reply: string }> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.squadResumeFile(squadId, turnId), 'utf8')) as unknown;
      return Array.isArray(raw) ? (raw as never) : [];
    } catch {
      return [];
    }
  }

  writeSquadResumeReplies(
    squadId: string,
    turnId: string,
    replies: Array<{ memberBotId: string; memberName: string; task: string; reply: string }>,
  ): void {
    const file = this.squadResumeFile(squadId, turnId);
    if (!replies.length) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
      return;
    }
    this.life.assertOwnerAlive(squadId);
    ensureDir(path.dirname(file));
    writeJson(file, replies);
  }

  listAllPendingHitl(): Array<PendingHitlRecord & { botId: string }> {
    const out: Array<PendingHitlRecord & { botId: string }> = [];
    for (const owner of [...this.deps.listRoster(), ...this.deps.listSquads()]) {
      for (const data of this.listPendingHitl(owner.id)) out.push({ ...data, botId: owner.id });
    }
    return out;
  }
}
