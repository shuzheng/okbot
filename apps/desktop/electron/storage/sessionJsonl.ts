import fs from 'node:fs';
import path from 'node:path';
import { createId, normalizeTokenUsage, type ChatMessage, type MessagesPage } from '@okbot/shared';
import { ensureDir } from './fs';
import type { SessionRecordV2 } from './types';

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
  const quoteMessageId =
    typeof msg.quoteMessageId === 'string' && msg.quoteMessageId.trim()
      ? msg.quoteMessageId.trim()
      : undefined;
  const quotePreview =
    typeof msg.quotePreview === 'string' && msg.quotePreview.trim()
      ? msg.quotePreview.trim()
      : undefined;
  const usage = normalizeTokenUsage(msg.usage);
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
      ...(quoteMessageId ? { quoteMessageId } : {}),
      ...(quotePreview ? { quotePreview } : {}),
      ...(usage ? { usage } : {}),
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
  const quoteMessageId =
    typeof rec.meta?.quoteMessageId === 'string' && rec.meta.quoteMessageId.trim()
      ? rec.meta.quoteMessageId.trim()
      : undefined;
  const quotePreview =
    typeof rec.meta?.quotePreview === 'string' && rec.meta.quotePreview.trim()
      ? rec.meta.quotePreview.trim()
      : undefined;
  const usage = normalizeTokenUsage(rec.meta?.usage);
  return {
    id: rec.id,
    role: roleRaw,
    content: extractItemText(item),
    createdAt: rec.createdAt,
    ...(speakerBotId ? { speakerBotId } : {}),
    ...(quoteMessageId ? { quoteMessageId } : {}),
    ...(quotePreview ? { quotePreview } : {}),
    ...(usage ? { usage } : {}),
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
