import fs from 'node:fs';
import path from 'node:path';
import { createId, normalizeMeshExchange, normalizeMessageTrace, normalizeQuickChoice, normalizeTokenUsage, stripLeadingCommittedInterim, type ChatMessage, type MessagesPage } from '@okbot/shared';
import { ensureDir } from './fs';
import type { SessionRecordV2 } from './types';


function basenameOf(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) || norm : norm;
}

/** Sanitize attachments from ChatMessage / meta for persistence. */
export function normalizeMessageAttachments(
  raw: unknown,
): Array<{ kind: 'image' | 'file' | 'folder'; path: string; name: string; size?: number }> | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const out: Array<{ kind: 'image' | 'file' | 'folder'; path: string; name: string; size?: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const kind =
      o.kind === 'image' || o.kind === 'file' || o.kind === 'folder' ? o.kind : null;
    const filePath = typeof o.path === 'string' ? o.path.trim() : '';
    if (!kind || !filePath) continue;
    const name =
      typeof o.name === 'string' && o.name.trim() ? o.name.trim() : basenameOf(filePath);
    const size =
      typeof o.size === 'number' && Number.isFinite(o.size) && o.size >= 0
        ? Math.floor(o.size)
        : undefined;
    out.push({ kind, path: filePath, name, ...(size != null ? { size } : {}) });
  }
  return out.length ? out : undefined;
}

export function isSessionRecordV2(raw: unknown): raw is SessionRecordV2 {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return (
    o.v === 2 &&
    typeof o.id === 'string' &&
    typeof o.createdAt === 'string' &&
    !!o.item &&
    typeof o.item === 'object'
  );
}

export function isLegacyChatMessage(raw: unknown): raw is ChatMessage {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.role === 'string' &&
    typeof o.content === 'string' &&
    o.v !== 2
  );
}

export function legacyMessageToRecord(msg: ChatMessage): SessionRecordV2 {
  const uiRole = msg.role === 'user' || msg.role === 'assistant' ? msg.role : undefined;
  const speakerBotId =
    typeof msg.speakerBotId === 'string' && msg.speakerBotId.trim()
      ? msg.speakerBotId.trim()
      : undefined;
  const meshExchange = normalizeMeshExchange(msg.meshExchange);
  const meshInterim = msg.meshInterim === true;
  const autoContinue = msg.autoContinue === true;
  const quoteMessageId =
    typeof msg.quoteMessageId === 'string' && msg.quoteMessageId.trim()
      ? msg.quoteMessageId.trim()
      : undefined;
  const quotePreview =
    typeof msg.quotePreview === 'string' && msg.quotePreview.trim()
      ? msg.quotePreview.trim()
      : undefined;
  const attachments = normalizeMessageAttachments(msg.attachments);
  const usage = normalizeTokenUsage(msg.usage);
  const trace = normalizeMessageTrace(msg.trace);
  const choice = msg.role === 'assistant' ? normalizeQuickChoice(msg.choice) : null;
  return {
    v: 2,
    id: msg.id,
    createdAt: msg.createdAt || new Date().toISOString(),
    item: {
      type: 'message',
      role: msg.role,
      content: msg.content,
    },
    meta: {
      ...(uiRole ? { uiRole } : {}),
      ...(speakerBotId ? { speakerBotId } : {}),
      ...(meshExchange ? { meshExchange } : {}),
      ...(meshInterim ? { meshInterim: true } : {}),
      ...(autoContinue ? { autoContinue: true } : {}),
      ...(quoteMessageId ? { quoteMessageId } : {}),
      ...(quotePreview ? { quotePreview } : {}),
      ...(attachments ? { attachments } : {}),
      ...(usage ? { usage } : {}),
      ...(trace ? { trace } : {}),
      ...(choice ? { choice } : {}),
    },
  };
}


/**
 * Write UI plain text into an existing AgentInputItem without flattening
 * Responses-style array `content` into a Chat Completions string.
 */
export function applyUiTextToItem(
  item: Record<string, unknown>,
  text: string,
): Record<string, unknown> {
  const content = item.content;
  if (Array.isArray(content)) {
    let replaced = false;
    const next = content.map((part) => {
      if (replaced) return part;
      if (typeof part === 'string') {
        replaced = true;
        return text;
      }
      if (!part || typeof part !== 'object') return part;
      const p = part as Record<string, unknown>;
      if (typeof p.text === 'string' || typeof p.refusal === 'string' || p.type === 'output_text' || p.type === 'input_text' || p.type === 'text') {
        replaced = true;
        const { refusal: _r, ...rest } = p;
        return { ...rest, text };
      }
      return part;
    });
    if (!replaced) {
      const role = typeof item.role === 'string' ? item.role : '';
      const partType = role === 'user' ? 'input_text' : 'output_text';
      next.push({ type: partType, text });
    }
    return { ...item, content: next };
  }
  return { ...item, content: text };
}

/** Rebind / finalize: keep SDK item shape; only refresh id, text, and UI meta. */
export function mergeUiMessageOntoRecord(prev: SessionRecordV2, msg: ChatMessage): SessionRecordV2 {
  const fresh = legacyMessageToRecord(msg);
  return {
    v: 2,
    id: msg.id,
    createdAt: msg.createdAt || prev.createdAt,
    item: applyUiTextToItem({ ...prev.item }, msg.content ?? ''),
    meta: {
      ...prev.meta,
      ...fresh.meta,
    },
  };
}

export function extractItemText(item: Record<string, unknown>): string {
  const content = item.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === 'string') {
        parts.push(part);
        continue;
      }
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if (typeof p.text === 'string') parts.push(p.text);
      else if (typeof p.refusal === 'string') parts.push(p.refusal);
    }
    return parts.join('');
  }
  return '';
}

/** Project a v2 row to a UI bubble; tool-only rows return null. */
export function recordToUiMessage(rec: SessionRecordV2): ChatMessage | null {
  const item = rec.item;
  const roleFromMeta = rec.meta?.uiRole;
  const roleRaw = roleFromMeta ?? (typeof item.role === 'string' ? item.role : '');
  if (roleRaw !== 'user' && roleRaw !== 'assistant') return null;
  const t = typeof item.type === 'string' ? item.type : 'message';
  if (t !== 'message' && roleFromMeta == null) return null;
  const speakerBotId =
    typeof rec.meta?.speakerBotId === 'string' && rec.meta.speakerBotId.trim()
      ? rec.meta.speakerBotId.trim()
      : undefined;
  const meshExchange = normalizeMeshExchange(rec.meta?.meshExchange);
  const meshInterim = rec.meta?.meshInterim === true;
  const autoContinue = rec.meta?.autoContinue === true;
  const quoteMessageId =
    typeof rec.meta?.quoteMessageId === 'string' && rec.meta.quoteMessageId.trim()
      ? rec.meta.quoteMessageId.trim()
      : undefined;
  const quotePreview =
    typeof rec.meta?.quotePreview === 'string' && rec.meta.quotePreview.trim()
      ? rec.meta.quotePreview.trim()
      : undefined;
  const attachments = normalizeMessageAttachments(rec.meta?.attachments);
  const usage = normalizeTokenUsage(rec.meta?.usage);
  const trace = normalizeMessageTrace(rec.meta?.trace);
  const choice = roleRaw === 'assistant' ? normalizeQuickChoice(rec.meta?.choice) : null;
  return {
    id: rec.id,
    role: roleRaw,
    content: extractItemText(item),
    createdAt: rec.createdAt,
    ...(speakerBotId ? { speakerBotId } : {}),
    ...(meshExchange ? { meshExchange } : {}),
    ...(meshInterim ? { meshInterim: true } : {}),
    ...(autoContinue ? { autoContinue: true } : {}),
    ...(quoteMessageId ? { quoteMessageId } : {}),
    ...(quotePreview ? { quotePreview } : {}),
    ...(attachments ? { attachments } : {}),
    ...(usage ? { usage } : {}),
    ...(trace ? { trace } : {}),
    ...(choice ? { choice } : {}),
  };
}

export function parseSessionLine(line: string): SessionRecordV2 | null {
  try {
    const raw = JSON.parse(line) as unknown;
    if (isSessionRecordV2(raw)) return raw;
    if (isLegacyChatMessage(raw)) return legacyMessageToRecord(raw);
    return null;
  } catch {
    return null;
  }
}

export function writeSessionRecordsAtomic(file: string, records: SessionRecordV2[]): void {
  ensureDir(path.dirname(file));
  const body = records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, file);
}



/**
 * Read up to `limit` UI messages ending before `beforeMessageId` (default: EOF / newest).
 * Walks the file backwards in chunks so large sessions are not fully loaded.
 * Cursor is message id — stable across full-file rewrites that invalidate byte offsets.
 */
export function readJsonlPage(
  filePath: string,
  limit: number,
  beforeMessageId?: string | null,
): MessagesPage {
  if (limit <= 0 || !fs.existsSync(filePath)) {
    return { messages: [], nextBeforeMessageId: null, hasMore: false };
  }

  const cursor = typeof beforeMessageId === 'string' && beforeMessageId.trim()
    ? beforeMessageId.trim()
    : null;

  const fd = fs.openSync(filePath, 'r');
  try {
    const fileSize = fs.fstatSync(fd).size;
    let end = fileSize;
    while (end > 0) {
      const one = Buffer.alloc(1);
      fs.readSync(fd, one, 0, 1, end - 1);
      if (one[0] === 0x0a || one[0] === 0x0d) end -= 1;
      else break;
    }
    if (end <= 0) return { messages: [], nextBeforeMessageId: null, hasMore: false };

    type Hit = { text: string; start: number };
    // newest → older; collect limit+1 to detect hasMore
    const uiHits: ChatMessage[] = [];
    let skippingToCursor = cursor != null;
    let cursorSeen = cursor == null;
    const want = limit + 1;
    const chunkSize = 64 * 1024;
    let scanEnd = end;
    let leftover = Buffer.alloc(0);

    const pushLine = (lineText: string) => {
      if (!lineText) return;
      const rec = parseSessionLine(lineText);
      if (!rec) return;
      const msg = recordToUiMessage(rec);
      if (!msg) return;
      if (skippingToCursor) {
        if (msg.id === cursor) {
          skippingToCursor = false;
          cursorSeen = true;
        }
        return;
      }
      uiHits.push(msg);
    };

    while (scanEnd > 0 && uiHits.length < want) {
      const readStart = Math.max(0, scanEnd - chunkSize);
      const readLen = scanEnd - readStart;
      const chunk = Buffer.alloc(readLen);
      fs.readSync(fd, chunk, 0, readLen, readStart);
      const buf = Buffer.concat([chunk, leftover]);
      const linesFromChunk: Hit[] = [];
      let lineEnd = buf.length;
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i] !== 0x0a) continue;
        const relStart = i + 1;
        const relEnd = lineEnd;
        if (relEnd > relStart) {
          const lineText = buf.subarray(relStart, relEnd).toString('utf8');
          if (lineText) linesFromChunk.push({ text: lineText, start: readStart + relStart });
        }
        lineEnd = i;
      }
      for (const h of linesFromChunk) {
        pushLine(h.text);
        if (uiHits.length >= want) break;
      }

      if (uiHits.length >= want) {
        leftover = Buffer.alloc(0);
        break;
      }

      if (readStart === 0) {
        if (lineEnd > 0) {
          const lineText = buf.subarray(0, lineEnd).toString('utf8');
          if (lineText) pushLine(lineText);
        }
        leftover = Buffer.alloc(0);
        scanEnd = 0;
        break;
      }

      leftover = buf.subarray(0, lineEnd);
      scanEnd = readStart;
    }

    if (cursor != null && !cursorSeen) {
      return { messages: [], nextBeforeMessageId: null, hasMore: false };
    }

    const hasMore = uiHits.length > limit;
    const messages = uiHits.slice(0, limit).reverse(); // oldest → newest
    const oldestId = messages.length ? messages[0]!.id : null;
    return {
      messages,
      nextBeforeMessageId: hasMore && oldestId ? oldestId : null,
      hasMore,
    };
  } finally {
    fs.closeSync(fd);
  }
}


/**
 * UI-only rows that must not enter the SDK/model session window.
 * meshExchange = status chip; meshInterim = sealed ask_assistant message A.
 * Feeding A back as a tool-less assistant turn teaches the model to stop after
 * 「好的…」 without calling ask_assistant on the next user turn.
 */
export function isUiOnlyMeshSessionRecord(rec: SessionRecordV2): boolean {
  return rec.meta?.meshExchange != null || rec.meta?.meshInterim === true;
}

/** Plain UI assistant upsert (legacyMessageToRecord): string content, no SDK status. */
export function isPlainUiAssistantItem(item: Record<string, unknown>): boolean {
  if (item.role !== 'assistant') return false;
  if (typeof item.content !== 'string') return false;
  if (item.status != null) return false;
  const t = item.type;
  if (t != null && t !== 'message') return false;
  return true;
}

export function isAssistantMessageItem(item: Record<string, unknown>): boolean {
  if (item.role !== 'assistant') return false;
  const t = item.type;
  if (t != null && t !== 'message') return false;
  return true;
}

/**
 * Drop UI-only mesh rows and legacy untagged interim twins (plain assistant T
 * immediately before another assistant with the same text T) from the model view.
 */
export function filterRecordsForModelSession(records: SessionRecordV2[]): SessionRecordV2[] {
  const base = records.filter((r) => !isUiOnlyMeshSessionRecord(r));
  const out: SessionRecordV2[] = [];
  for (let i = 0; i < base.length; i++) {
    const rec = base[i]!;
    const next = base[i + 1];
    if (
      next &&
      isPlainUiAssistantItem(rec.item) &&
      isAssistantMessageItem(next.item)
    ) {
      const a = extractItemText(rec.item).trim();
      const b = extractItemText(next.item).trim();
      if (a && a === b) {
        // Legacy 42ef35d orphan: sealed A without meshInterim flag before SDK twin.
        continue;
      }
    }
    out.push(rec);
  }
  return out;
}

/**
 * After ask_assistant commit, the SDK still appends its own assistant row with the
 * same interim text. Drop those exact duplicates so reload matches live A → chip → B.
 * Also handles legacy rows (no meshInterim flag): assistant(T) → mesh chip → assistant(T).
 */
export function dedupeMeshInterimMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length < 2) return messages;
  const interimTexts = new Set<string>();
  const out: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === 'assistant' && m.meshInterim === true) {
      const key = (m.content || '').trim();
      if (key) interimTexts.add(key);
      out.push(m);
      continue;
    }
    const text = (m.content || '').trim();
    if (m.role === 'assistant' && !m.meshExchange && text && interimTexts.has(text)) {
      // Exact duplicate of a sealed mesh interim — SDK echo, hide from UI.
      continue;
    }
    // Legacy: … → interim A → mesh status → SDK echo of A → …
    if (
      m.role === 'assistant' &&
      !m.meshExchange &&
      !m.meshInterim &&
      text
    ) {
      const prev = out[out.length - 1];
      const prev2 = out[out.length - 2];
      if (
        prev?.meshExchange &&
        prev2?.role === 'assistant' &&
        !prev2.meshExchange &&
        (prev2.content || '').trim() === text
      ) {
        continue;
      }
    }
    out.push(m);
  }

  // Strip repeated interim prefix from follow-up B (A → chip → B).
  for (let i = 0; i < out.length; i++) {
    const chip = out[i]!;
    if (!chip.meshExchange) continue;
    const prev = out[i - 1];
    const next = out[i + 1];
    if (!prev || prev.role !== 'assistant' || prev.meshExchange) continue;
    if (!next || next.role !== 'assistant' || next.meshExchange || next.meshInterim) continue;
    const interim = prev.content || '';
    if (!interim.trim()) continue;
    const stripped = stripLeadingCommittedInterim(next.content || '', interim);
    if (stripped !== next.content) {
      out[i + 1] = { ...next, content: stripped };
    }
  }
  return out;
}
