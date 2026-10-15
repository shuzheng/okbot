import fs from 'node:fs';
import {
  MESSAGE_PAGE_SIZE,
  createId,
  plainTextFromMarkdown,
  type ChatMessage,
  type MessagesPage,
  type MessageSearchHit,
  normalizeBotAvatarKind,
  normalizeBotAvatarType,
  type Bot,
  type Squad,
} from '@okbot/shared';
import { appendText, writeText } from './fs';
import {
  mergeUiMessageOntoRecord,
  recordToUiMessage,
  parseSessionLine,
  writeSessionRecordsAtomic,
  readJsonlPage,
  legacyMessageToRecord,
  isSessionRecordV2,
  dedupeMeshInterimMessages,
  filterRecordsForModelSession,
} from './sessionJsonl';
import { isSquadOwnerId } from './ids';
import type { SessionRecordV2 } from './types';
import type { OwnerLifecycle } from './ownerLifecycle';
import { searchSessionFiles, type SearchOwner } from './messageSearch';

/** Squad avatar in search hits (matches the sidebar / search squad rows). */
const SQUAD_SEARCH_EMOJI = '👥';
const SQUAD_SEARCH_COLOR = '#6366F1';

export type SessionStoreDeps = {
  ensureBotLayout(botId: string): void;
  sessionFile(botId: string): string;
  noteSessionsChanged(ownerId: string, reason: import('@okbot/shared').SessionsChangedReason): void;
  listBots(): Bot[];
  listSquads(): Squad[];
};

/** session.jsonl RMW + UI messages + search. Session write lock lives on OwnerLifecycle. */
export class SessionStore {
  constructor(
    private readonly life: OwnerLifecycle,
    private readonly deps: SessionStoreDeps,
  ) {}

  ensureSessionV2(botId: string): void {
    const file = this.deps.sessionFile(botId);
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return;
    const lines = raw.split('\n').filter(Boolean);
    let needsUpgrade = false;
    const records: SessionRecordV2[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!isSessionRecordV2(parsed)) needsUpgrade = true;
        const rec = parseSessionLine(line);
        if (rec) records.push(rec);
      } catch {
        needsUpgrade = true;
      }
    }
    if (needsUpgrade) writeSessionRecordsAtomic(file, records);
  }

  readSessionRecords(botId: string): SessionRecordV2[] {
    this.deps.ensureBotLayout(botId);
    this.ensureSessionV2(botId);
    const file = this.deps.sessionFile(botId);
    if (!fs.existsSync(file)) return [];
    const out: SessionRecordV2[] = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const rec = parseSessionLine(line);
      if (rec) out.push(rec);
    }
    return out;
  }

  writeSessionRecords(botId: string, records: SessionRecordV2[]): void {
    this.deps.ensureBotLayout(botId);
    writeSessionRecordsAtomic(this.deps.sessionFile(botId), records);
  }

  /** Full chronological AgentInputItem list (no Summary+Buffer filter). */
  readSessionItems(botId: string, limit?: number): Record<string, unknown>[] {
    return this.readSessionItemsAfter(botId, null, limit);
  }

  /** SDK Session.addItems — append items as v2 envelopes. */
  appendSessionItems(
    botId: string,
    items: Record<string, unknown>[],
    meta?: SessionRecordV2['meta'],
  ): void {
    if (!items.length) return;
    this.deps.ensureBotLayout(botId);
    this.ensureSessionV2(botId);
    const file = this.deps.sessionFile(botId);
    const chunks: string[] = [];
    for (const item of items) {
      const role = typeof item.role === 'string' ? item.role : undefined;
      const uiRole = role === 'user' || role === 'assistant' ? role : meta?.uiRole;
      const rec: SessionRecordV2 = {
        v: 2,
        id: createId('evt'),
        createdAt: new Date().toISOString(),
        item,
        meta: {
          ...(uiRole ? { uiRole } : {}),
          ...(meta?.runId ? { runId: meta.runId } : {}),
          ...(meta?.speakerBotId ? { speakerBotId: meta.speakerBotId } : {}),
        },
      };
      chunks.push(`${JSON.stringify(rec)}\n`);
    }
    appendText(file, chunks.join(''));
  }

  popSessionItem(botId: string): Record<string, unknown> | undefined {
    const records = this.readSessionRecords(botId);
    if (!records.length) return undefined;
    const last = records[records.length - 1]!;
    this.writeSessionRecords(botId, records.slice(0, -1));
    return last.item;
  }

  clearSessionItems(botId: string): void {
    this.deps.ensureBotLayout(botId);
    writeText(this.deps.sessionFile(botId), '');
  }

  /** Full rewrite used by Session.replaceHistoryWithCompaction. Does not trim for Summary+Buffer. */
  replaceSessionItems(botId: string, items: Record<string, unknown>[]): void {
    // Preserve squad exchange bubbles — SDK compaction must not wipe UI transcript rows.
    const preserved = this.readSessionRecords(botId).filter(
      (r) =>
        (typeof r.meta?.speakerBotId === 'string' && !!r.meta.speakerBotId.trim()) ||
        !!r.meta?.meshExchange ||
        r.meta?.meshInterim === true,
    );
    const records: SessionRecordV2[] = items.map((item) => {
      const role = typeof item.role === 'string' ? item.role : undefined;
      const uiRole = role === 'user' || role === 'assistant' ? role : undefined;
      return {
        v: 2,
        id: createId('evt'),
        createdAt: new Date().toISOString(),
        item,
        meta: uiRole ? { uiRole } : undefined,
      };
    });
    if (!preserved.length) {
      this.writeSessionRecords(botId, records);
      return;
    }
    const used = new Set(records.map((r) => r.id));
    const merged = [...records];
    for (const row of preserved) {
      if (used.has(row.id)) continue;
      merged.push(row);
      used.add(row.id);
    }
    merged.sort((a, b) => {
      const t = a.createdAt.localeCompare(b.createdAt);
      return t !== 0 ? t : a.id.localeCompare(b.id);
    });
    this.writeSessionRecords(botId, merged);
  }

  /**
   * SDK/model view of session items: optionally skip everything through `afterMessageId`
   * (Summary+Buffer `coveredThroughId`). Appends still go to the full jsonl; only reads
   * for the model are filtered. If the marker id is missing (legacy trimmed file), the
   * remaining file is treated as the live buffer (start at 0).
   */
  /** Ids + items for send-path token estimates (includes tool rows). */
  listSessionBudgetRows(botId: string): Array<{ id: string; item: Record<string, unknown> }> {
    return this.readSessionRecords(botId).map((r) => ({ id: r.id, item: r.item }));
  }

  readSessionItemsAfter(
    botId: string,
    afterMessageId?: string | null,
    limit?: number,
    omitRecordIds?: ReadonlySet<string> | null,
    parallel?: {
      runId?: string | null;
      baselineIds?: ReadonlySet<string> | null;
    } | null,
  ): Record<string, unknown>[] {
    const records = this.readSessionRecords(botId);
    let start = 0;
    if (afterMessageId) {
      const idx = records.findIndex((r) => r.id === afterMessageId);
      if (idx >= 0) start = idx + 1;
    }
    let slice = filterRecordsForModelSession(records.slice(start));
    // meshExchange chips + sealed meshInterim A stay UI-only (see filterRecordsForModelSession).
    if (omitRecordIds && omitRecordIds.size) {
      slice = slice.filter((r) => !omitRecordIds.has(r.id));
    }
    const runId = (parallel?.runId || '').trim();
    const baselineIds = parallel?.baselineIds;
    if (runId && baselineIds) {
      slice = slice.filter((r) => {
        const rowRun = typeof r.meta?.runId === 'string' ? r.meta.runId.trim() : '';
        if (rowRun === runId) return true;
        if (rowRun && rowRun !== runId) {
          // Sibling tagged row: only if it already existed when this turn started.
          return baselineIds.has(r.id);
        }
        // Untagged (e.g. user rows from appendMessage): baseline only — otherwise
        // a sibling parallel user message leaks into this turn's model window.
        return baselineIds.has(r.id);
      });
    }
    const items = slice.map((r) => r.item);
    if (limit == null || limit <= 0 || limit >= items.length) return items;
    return items.slice(items.length - limit);
  }

  /**
   * Adapter for OkbotFileSession (packages/agent).
   * Pass `afterMessageId` (= SessionSummary.coveredThroughId) so getItems returns only
   * the yet-uncompressed tail; writes always target the full session.jsonl.
   */
  createSessionStore(
    botId: string,
    opts?: {
      afterMessageId?: string | null;
      omitRecordIds?: string[] | null;
      /** Parallel-turn isolation: hide sibling in-flight rows from the model. */
      runId?: string | null;
    },
  ): {
    getSessionId: () => string;
    readItems: (limit?: number) => Record<string, unknown>[];
    appendItems: (items: Record<string, unknown>[]) => void | Promise<void>;
    popItem: () => Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>;
    clearItems: () => void | Promise<void>;
    replaceItems: (items: Record<string, unknown>[]) => void | Promise<void>;
  } {
    this.ensureSessionV2(botId);
    const afterMessageId = opts?.afterMessageId ?? null;
    const omitRecordIds =
      opts?.omitRecordIds && opts.omitRecordIds.length ? new Set(opts.omitRecordIds) : null;
    const runId = (opts?.runId || '').trim() || null;
    // Snapshot ids present when this turn starts so later sibling appends stay invisible.
    const baselineIds = runId
      ? new Set(this.readSessionRecords(botId).map((r) => r.id))
      : null;
    return {
      getSessionId: () => botId,
      readItems: (limit?: number) =>
        this.readSessionItemsAfter(botId, afterMessageId, limit, omitRecordIds, {
          runId,
          baselineIds,
        }),
      appendItems: (items: Record<string, unknown>[]) =>
        this.life.withSessionWriteLock(botId, () =>
          this.appendSessionItems(botId, items, runId ? { runId } : undefined),
        ),
      popItem: () => this.life.withSessionWriteLock(botId, () => this.popSessionItem(botId)),
      clearItems: () => this.life.withSessionWriteLock(botId, () => this.clearSessionItems(botId)),
      replaceItems: (items: Record<string, unknown>[]) =>
        this.life.withSessionWriteLock(botId, () => this.replaceSessionItems(botId, items)),
    };
  }

  /**
   * Squad UI transcript is only user rows + assistant rows tagged with speakerBotId.
   * Runner/SDK assistant fragments without speakerBotId stay in jsonl for the model
   * but must not appear as chat bubbles (they reorder after exchange append).
   */
  toSquadUiMessages(botId: string, messages: ChatMessage[]): ChatMessage[] {
    if (!isSquadOwnerId(botId)) return messages;
    return messages.filter(
      (m) => m.role === 'user' || (m.role === 'assistant' && !!m.speakerBotId?.trim()),
    );
  }

  getMessages(botId: string): ChatMessage[] {
    const all = this.readSessionRecords(botId)
      .map(recordToUiMessage)
      .filter((m): m is ChatMessage => m != null);
    return this.toSquadUiMessages(botId, dedupeMeshInterimMessages(all));
  }

  /**
   * Page through a bot session without reading the whole jsonl when it is large.
   * Omit beforeMessageId (or pass null) for the newest page.
   * Returns UI-projected bubbles only (tool-only rows are skipped).
   */
  getMessagesPage(
    botId: string,
    opts?: { limit?: number; beforeMessageId?: string | null },
  ): MessagesPage {
    this.ensureSessionV2(botId);
    const file = this.deps.sessionFile(botId);
    const limit = opts?.limit ?? MESSAGE_PAGE_SIZE;
    if (!isSquadOwnerId(botId)) {
      const page = readJsonlPage(file, limit, opts?.beforeMessageId);
      return {
        ...page,
        messages: dedupeMeshInterimMessages(page.messages),
      };
    }
    // Over-fetch raw rows so filtering SDK plumbing still fills a UI page.
    // Return all filtered rows from this window (may exceed `limit` slightly) so
    // nextBeforeMessageId stays aligned with the raw page cursor.
    const fetchLimit = Math.min(Math.max(limit * 5, limit), 250);
    const page = readJsonlPage(file, fetchLimit, opts?.beforeMessageId);
    return {
      messages: this.toSquadUiMessages(botId, dedupeMeshInterimMessages(page.messages)),
      hasMore: page.hasMore,
      nextBeforeMessageId: page.nextBeforeMessageId,
    };
  }

  /**
   * Search one chat owner only (bot or squad). Used by the `search_history` tool.
   * Does not cross owners. Empty query → [].
   */
  async searchMessagesForOwner(
    ownerId: string,
    query: string,
    opts?: { limit?: number },
  ): Promise<MessageSearchHit[]> {
    const q = query.trim();
    if (!q || !ownerId.trim()) return [];
    const limit = Math.min(40, Math.max(1, opts?.limit ?? 12));
    const owners: SearchOwner[] = [];
    if (isSquadOwnerId(ownerId)) {
      const squad = this.deps.listSquads().find((s) => s.id === ownerId);
      if (!squad) return [];
      const botNames = new Map(this.deps.listBots().map((b) => [b.id, b.name] as const));
      owners.push({
        file: this.deps.sessionFile(squad.id),
        squad: true,
        speakerNames: botNames,
        botId: squad.id,
        ownerKind: 'squad',
        botName: squad.name,
        botEmoji: SQUAD_SEARCH_EMOJI,
        botColor: SQUAD_SEARCH_COLOR,
        botAvatarKind: 'emoji',
      });
    } else {
      const bot = this.deps.listBots().find((b) => b.id === ownerId);
      if (!bot || isSquadOwnerId(bot.id)) return [];
      const avatarKind = normalizeBotAvatarKind(bot.avatarKind);
      owners.push({
        file: this.deps.sessionFile(bot.id),
        botId: bot.id,
        ownerKind: 'bot',
        botName: bot.name,
        botEmoji: bot.emoji,
        botColor: bot.color,
        botAvatarKind: avatarKind,
        ...(avatarKind === 'bot-avatar'
          ? { botAvatarType: normalizeBotAvatarType(bot.botAvatarType) }
          : {}),
      });
    }
    return searchSessionFiles(owners, q, limit);
  }

  /**
   * Search UI chat bubbles across bot and squad sessions (case-insensitive substring).
   * Async, newest first, with a global early stop (see `searchSessionFiles`).
   * Empty query → [].
   */
  async searchMessages(query: string, opts?: { limit?: number }): Promise<MessageSearchHit[]> {
    const q = query.trim();
    if (!q) return [];
    const limit = Math.min(100, Math.max(1, opts?.limit ?? 40));
    const owners: SearchOwner[] = [];
    const bots = this.deps.listBots();
    const botNames = new Map(bots.map((b) => [b.id, b.name] as const));
    for (const bot of bots) {
      // Defensive: never index squad owner session files as bot hits.
      if (isSquadOwnerId(bot.id)) continue;
      const avatarKind = normalizeBotAvatarKind(bot.avatarKind);
      owners.push({
        file: this.deps.sessionFile(bot.id),
        botId: bot.id,
        ownerKind: 'bot',
        botName: bot.name,
        botEmoji: bot.emoji,
        botColor: bot.color,
        botAvatarKind: avatarKind,
        ...(avatarKind === 'bot-avatar'
          ? { botAvatarType: normalizeBotAvatarType(bot.botAvatarType) }
          : {}),
      });
    }
    for (const squad of this.deps.listSquads()) {
      owners.push({
        file: this.deps.sessionFile(squad.id),
        squad: true,
        speakerNames: botNames,
        botId: squad.id,
        ownerKind: 'squad',
        botName: squad.name,
        botEmoji: SQUAD_SEARCH_EMOJI,
        botColor: SQUAD_SEARCH_COLOR,
        botAvatarKind: 'emoji',
      });
    }
    return searchSessionFiles(owners, q, limit);
  }

  /** Newest assistant message text for sidebar subtitle; empty if none. */
  getLastReplyPreview(ownerId: string): string {
    const page = this.getMessagesPage(ownerId, { limit: 30 });
    for (let i = page.messages.length - 1; i >= 0; i--) {
      const m = page.messages[i]!;
      if (m.role !== 'assistant') continue;
      const text = plainTextFromMarkdown(m.content || '');
      if (text) return text;
    }
    return '';
  }

  withReplyPreviews<T extends { id: string }>(owners: T[]): Array<T & { lastReplyPreview?: string }> {
    return owners.map((owner) => ({
      ...owner,
      lastReplyPreview: this.getLastReplyPreview(owner.id),
    }));
  }


  /** Lookup one UI message by id (scans session records). */
  getMessageById(ownerId: string, messageId: string): ChatMessage | null {
    const id = (messageId || '').trim();
    if (!id) return null;
    for (const rec of this.readSessionRecords(ownerId)) {
      if (rec.id !== id) continue;
      return recordToUiMessage(rec);
    }
    return null;
  }

  /**
   * Session items chronological through and including the envelope whose id
   * equals `messageId` (typically a user bubble id).
   * When `afterMessageId` is set (Summary+Buffer coveredThroughId), only the
   * yet-uncompressed tail after that marker is returned — same projection the
   * model sees (summary lives in instructions, not as session items).
   */
  getSessionItemsThroughMessage(
    botId: string,
    messageId: string,
    opts?: { afterMessageId?: string | null },
  ): { items: Record<string, unknown>[]; found: boolean } {
    const records = this.readSessionRecords(botId);
    const idx = records.findIndex((r) => r.id === messageId);
    if (idx < 0) return { items: [], found: false };
    let start = 0;
    const afterId = opts?.afterMessageId;
    if (afterId) {
      const markerIdx = records.findIndex((r) => r.id === afterId);
      if (markerIdx >= 0) start = markerIdx + 1;
    }
    if (start > idx) {
      // Target bubble sits inside the already-summarized span.
      return { items: [], found: true };
    }
    return {
      items: records.slice(start, idx + 1).map((r) => r.item),
      found: true,
    };
  }

  /** Patch fields on an existing UI message (matched by envelope id). */
  patchMessage(botId: string, messageId: string, patch: Partial<ChatMessage>): ChatMessage | null {
    const records = this.readSessionRecords(botId);
    const idx = records.findIndex((r) => r.id === messageId);
    if (idx < 0) return null;
    const prev = records[idx]!;
    const prevUi = recordToUiMessage(prev);
    if (!prevUi) return null;
    const nextMsg: ChatMessage = {
      ...prevUi,
      ...patch,
      id: prevUi.id,
      role: prevUi.role,
    };
    // Always merge onto the existing SDK item so Responses array content survives.
    const nextRec = mergeUiMessageOntoRecord(prev, nextMsg);
    if (patch.content === undefined && prev.item) {
      nextRec.item = prev.item;
    }
    records[idx] = nextRec;
    this.writeSessionRecords(botId, records);
    return nextMsg;
  }

  appendMessage(botId: string, message: ChatMessage): void {
    this.deps.ensureBotLayout(botId);
    this.ensureSessionV2(botId);
    const rec = legacyMessageToRecord(message);
    appendText(this.deps.sessionFile(botId), `${JSON.stringify(rec)}\n`);
    this.deps.noteSessionsChanged(botId, 'message');
  }

  /**
   * Finalize assistant bubble content.
   * Prefer updating the last assistant row (possibly just written by Runner.addItems)
   * so we do not double-append the same reply.
   * Error paths must pass `{ allowRebind: false }` so a fresh "错误：…" row never
   * rebind-scans onto the previous assistant turn.
   */
  async upsertAssistantMessage(
    botId: string,
    message: ChatMessage,
    opts?: { allowRebind?: boolean; runId?: string | null },
  ): Promise<void> {
    await this.life.withSessionWriteLock(botId, () => {
    const allowRebind = opts?.allowRebind !== false;
    const runId = (opts?.runId || '').trim();
    const stampRun = (rec: SessionRecordV2): SessionRecordV2 =>
      runId ? { ...rec, meta: { ...(rec.meta || {}), runId } } : rec;
    const records = this.readSessionRecords(botId);
    const byId = records.findIndex((r) => r.id === message.id);
    if (byId >= 0) {
      records[byId] = stampRun(mergeUiMessageOntoRecord(records[byId]!, message));
      this.writeSessionRecords(botId, records);
      this.deps.noteSessionsChanged(botId, 'message');
      return;
    }
    // Abort during tool approval clears streamed content then still called upsert
    // with an empty ephemeral assistant id. Rebinding would replace the previous
    // turn's assistant row — refuse empty orphan upserts (no id match).
    if (!(message.content || '').trim()) {
      return;
    }
    // Squad UI transcript rows always carry speakerBotId. Never rebind an SDK
    // history assistant onto them — that corrupts model session items and can
    // park the captain bubble after exchange rows.
    // Error paths also skip rebind-scan (append a new row instead).
    if (
      !allowRebind ||
      (typeof message.speakerBotId === 'string' && message.speakerBotId.trim()) ||
      !!message.meshExchange ||
      message.meshInterim === true
    ) {
      records.push(stampRun(legacyMessageToRecord(message)));
      this.writeSessionRecords(botId, records);
      this.deps.noteSessionsChanged(botId, 'message');
      return;
    }
    for (let i = records.length - 1; i >= 0; i--) {
      const rec = records[i]!;
      // Never clobber squad ask/reply bubbles (they carry speakerBotId).
      if (typeof rec.meta?.speakerBotId === 'string' && rec.meta.speakerBotId.trim()) {
        continue;
      }
      // Never clobber 1:1 mesh status rows.
      if (rec.meta?.meshExchange) {
        continue;
      }
      // Never clobber sealed ask_assistant interim (message A).
      if (rec.meta?.meshInterim === true) {
        continue;
      }
      // Parallel turns: only rebind rows from this run (or untagged legacy rows).
      if (runId) {
        const rowRun = typeof rec.meta?.runId === 'string' ? rec.meta.runId.trim() : '';
        if (rowRun && rowRun !== runId) continue;
      }
      const ui = recordToUiMessage(rec);
      if (ui?.role === 'assistant') {
        // Rebind Runner-persisted row to the streaming UI id and final text,
        // keeping Responses array-shaped content (do not flatten via legacyMessageToRecord).
        records[i] = stampRun(mergeUiMessageOntoRecord(rec, message));
        this.writeSessionRecords(botId, records);
        this.deps.noteSessionsChanged(botId, 'message');
        return;
      }
    }
    records.push(stampRun(legacyMessageToRecord(message)));
    this.writeSessionRecords(botId, records);
    this.deps.noteSessionsChanged(botId, 'message');
    });
  }
}
