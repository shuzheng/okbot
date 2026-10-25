import fs from 'node:fs';
import { plainTextFromMarkdown, stripThinkContent, type ChatMessage, type MessageSearchHit } from '@okbot/shared';
import { parseSessionLine, recordToUiMessage } from './sessionJsonl';

/** Reads a text file line by line from the end, with async I/O. */
export class ReverseLineReader {
  private fd: fs.promises.FileHandle | null = null;
  private pos = -1;
  private leftover: Buffer = Buffer.alloc(0);
  private lines: { text: string; offset: number }[] = [];
  private eof = false;
  /** Byte offset where the line last returned by `next` starts. */
  lastOffset = Number.POSITIVE_INFINITY;

  constructor(
    private readonly file: string,
    private readonly chunkSize = 64 * 1024,
  ) {}

  /** Next line toward the start of the file, or null at the start. */
  async next(): Promise<string | null> {
    while (this.lines.length === 0) {
      if (this.eof) return null;
      await this.fill();
    }
    const line = this.lines.shift()!;
    this.lastOffset = line.offset;
    return line.text;
  }

  async close(): Promise<void> {
    const fd = this.fd;
    this.fd = null;
    if (fd) await fd.close().catch(() => {});
  }

  private async fill(): Promise<void> {
    if (this.pos < 0) {
      try {
        this.fd = await fs.promises.open(this.file, 'r');
      } catch {
        this.eof = true;
        return;
      }
      this.pos = (await this.fd.stat()).size;
    }
    if (!this.fd || this.pos <= 0) {
      const last = this.leftover.toString('utf8');
      this.leftover = Buffer.alloc(0);
      if (last.trim()) this.lines.push({ text: last, offset: 0 });
      this.eof = true;
      await this.close();
      return;
    }
    const start = Math.max(0, this.pos - this.chunkSize);
    const len = this.pos - start;
    const chunk = Buffer.alloc(len);
    await this.fd.read(chunk, 0, len, start);
    this.pos = start;
    // `leftover` is the bytes right after this chunk, so `buf` starts at `start`.
    const buf = Buffer.concat([chunk, this.leftover]);
    let lineEnd = buf.length;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i] !== 0x0a) continue;
      const text = buf.subarray(i + 1, lineEnd).toString('utf8');
      if (text.trim()) this.lines.push({ text, offset: start + i + 1 });
      lineEnd = i;
    }
    // Text before the first newline in this chunk may continue in the previous chunk.
    this.leftover = buf.subarray(0, lineEnd);
  }
}

// ---------------------------------------------------------------------------
// Time index: an upper bound on createdAt of every line before an offset.
//
// Rows are not always appended in time order (an assistant bubble is created when
// the run starts and written when it ends; member replies land later), so the
// time of the row just read is not a bound for the rows above it. The index
// stores, every CHECKPOINT_BYTES, the newest createdAt seen in the file before
// that offset. Search uses it as the frontier, which makes the early stop exact.
// The index is built once per file and extended when the file only grew.
// ---------------------------------------------------------------------------

const CHECKPOINT_BYTES = 64 * 1024;
const SIGNATURE_BYTES = 256;
const CREATED_AT = /(?<!\\)"createdAt"\s*:\s*"([^"\\]{10,40})"/g;

type FileIndex = {
  ino: number;
  mtimeMs: number;
  /** Indexed bytes; always ends right after a newline. */
  size: number;
  /** File size when indexed (a last line without newline is not indexed yet). */
  fileSize: number;
  head: string;
  tail: string;
  /** Ascending offsets; `max` = newest createdAt of all lines before `offset`. */
  checkpoints: { offset: number; max: number }[];
  /** Newest createdAt of all indexed lines. */
  max: number;
  nextCheckpoint: number;
};

const indexCache = new Map<string, FileIndex>();

/** Newest createdAt in one jsonl line (0 if none). Over-estimating is safe. */
export function lineMaxTime(line: string): number {
  let best = 0;
  CREATED_AT.lastIndex = 0;
  for (let m = CREATED_AT.exec(line); m; m = CREATED_AT.exec(line)) {
    const t = Date.parse(m[1]!);
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best;
}

async function readAt(fd: fs.promises.FileHandle, start: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(Math.max(0, len));
  if (len > 0) await fd.read(buf, 0, len, start);
  return buf;
}

/** Build or extend the time index of `file`. Null when the file does not exist. */
export async function timeIndexFor(file: string): Promise<FileIndex | null> {
  let fd: fs.promises.FileHandle;
  try {
    fd = await fs.promises.open(file, 'r');
  } catch {
    indexCache.delete(file);
    return null;
  }
  try {
    const st = await fd.stat();
    let idx = indexCache.get(file);
    if (idx) {
      // Fast path: untouched since last index.
      if (idx.ino === st.ino && st.size === idx.fileSize && st.mtimeMs === idx.mtimeMs) {
        return idx;
      }
      // Reuse the indexed prefix when the file only grew (same head/tail signatures).
      const same =
        idx.ino === st.ino &&
        st.size >= idx.size &&
        (await readAt(fd, 0, Math.min(SIGNATURE_BYTES, idx.size))).toString('latin1') === idx.head &&
        (await readAt(fd, Math.max(0, idx.size - SIGNATURE_BYTES), Math.min(SIGNATURE_BYTES, idx.size))).toString(
          'latin1',
        ) === idx.tail;
      if (!same) idx = undefined;
    }
    if (!idx) {
      idx = {
        ino: st.ino,
        mtimeMs: st.mtimeMs,
        size: 0,
        fileSize: 0,
        head: '',
        tail: '',
        checkpoints: [],
        max: 0,
        nextCheckpoint: 0,
      };
    }
    idx.fileSize = st.size;
    idx.mtimeMs = st.mtimeMs;
    let pos = idx.size;
    let leftover = Buffer.alloc(0);
    const step = 1024 * 1024;
    while (pos < st.size) {
      const chunk = await readAt(fd, pos, Math.min(step, st.size - pos));
      if (chunk.length === 0) break;
      const buf = Buffer.concat([leftover, chunk]);
      const base = pos - leftover.length;
      let lineStart = 0;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== 0x0a) continue;
        const offset = base + lineStart;
        if (offset >= idx.nextCheckpoint) {
          idx.checkpoints.push({ offset, max: idx.max });
          idx.nextCheckpoint = offset + CHECKPOINT_BYTES;
        }
        const t = lineMaxTime(buf.subarray(lineStart, i).toString('utf8'));
        if (t > idx.max) idx.max = t;
        lineStart = i + 1;
        idx.size = base + lineStart;
      }
      leftover = buf.subarray(lineStart);
      pos += chunk.length;
    }
    idx.head = (await readAt(fd, 0, Math.min(SIGNATURE_BYTES, idx.size))).toString('latin1');
    idx.tail = (await readAt(fd, Math.max(0, idx.size - SIGNATURE_BYTES), Math.min(SIGNATURE_BYTES, idx.size))).toString(
      'latin1',
    );
    indexCache.set(file, idx);
    return idx;
  } finally {
    await fd.close().catch(() => {});
  }
}

/** Upper bound on createdAt of every line that starts before `offset`. */
export function timeBoundBefore(idx: FileIndex | null, offset: number): number {
  if (!idx) return Number.POSITIVE_INFINITY;
  if (offset > idx.size) return Number.POSITIVE_INFINITY; // unindexed tail before offset
  const cps = idx.checkpoints;
  // Smallest checkpoint at or after `offset`: its prefix covers every line before `offset`.
  let lo = 0;
  let hi = cps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cps[mid]!.offset >= offset) hi = mid;
    else lo = mid + 1;
  }
  return lo < cps.length ? cps[lo]!.max : idx.max;
}

export type SearchOwner = Omit<MessageSearchHit, 'message' | 'snippet'> & {
  file: string;
  /** Squad chats: only user rows and member replies are chat bubbles. */
  squad?: boolean;
  /** Squad member id → name, for `speakerName`. */
  speakerNames?: ReadonlyMap<string, string>;
};

const LINES_PER_STEP = 200;
const SNIPPET_RADIUS = 48;

function rowTime(createdAt: string | undefined): number {
  const t = Date.parse(createdAt || '');
  return Number.isFinite(t) ? t : 0;
}

function snippetFor(plain: string, idx: number, qLen: number): string {
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(plain.length, idx + qLen + SNIPPET_RADIUS);
  let snippet = plain.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < plain.length) snippet = snippet + '…';
  return snippet;
}

/**
 * Newest-first search across chats.
 *
 * Each chat file is read from the end. Its frontier is the newest createdAt that
 * any unread row can still have (from the time index, so out-of-order rows are
 * covered). The chat with the newest frontier goes next. The search stops when it
 * has `limit` hits and every frontier is at or older than the oldest kept hit.
 * A chat whose newest row is older than that is not read at all.
 */
export async function searchSessionFiles(
  owners: readonly SearchOwner[],
  query: string,
  limit: number,
): Promise<MessageSearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q || limit <= 0) return [];
  type State = {
    owner: SearchOwner;
    reader: ReverseLineReader;
    index: FileIndex | null;
    frontier: number;
    done: boolean;
  };
  const states: State[] = [];
  for (const owner of owners) {
    const index = await timeIndexFor(owner.file);
    if (!index) continue;
    states.push({
      owner,
      reader: new ReverseLineReader(owner.file),
      index,
      // Newest time in the file; an unindexed last line could be anything.
      frontier: index.fileSize > index.size ? Number.POSITIVE_INFINITY : index.max,
      done: false,
    });
  }
  const hits: MessageSearchHit[] = [];
  const kept = () => (hits.length >= limit ? rowTime(hits[limit - 1]!.message.createdAt) : -Infinity);
  /** Re-stat files not yet reverse-read so a mid-search append/rewrite cannot leave a stale frontier. */
  const refreshUnopened = async () => {
    for (const st of states) {
      if (st.done || st.reader.lastOffset !== Number.POSITIVE_INFINITY) continue;
      let info: fs.Stats;
      try {
        info = await fs.promises.stat(st.owner.file);
      } catch {
        st.done = true;
        continue;
      }
      const idx = st.index;
      if (idx && idx.ino === info.ino && info.size === idx.fileSize && info.mtimeMs === idx.mtimeMs) continue;
      // Pure growth: leave the cache so timeIndexFor extends it. Only a shrink
      // (or missing file) needs a drop; signature mismatch is handled inside.
      if (idx && (info.ino !== idx.ino || info.size < idx.fileSize)) {
        indexCache.delete(st.owner.file);
      }
      const next = await timeIndexFor(st.owner.file);
      st.index = next;
      if (!next) {
        st.done = true;
        continue;
      }
      st.frontier = next.fileSize > next.size ? Number.POSITIVE_INFINITY : next.max;
    }
  };
  try {
    for (;;) {
      await refreshUnopened();
      let pick: State | null = null;
      for (const s of states) {
        if (!s.done && (!pick || s.frontier > pick.frontier)) pick = s;
      }
      if (!pick) break;
      if (hits.length >= limit && pick.frontier <= kept()) {
        // One more refresh: a not-yet-selected file may have gained a newer hit.
        await refreshUnopened();
        pick = null;
        for (const s of states) {
          if (!s.done && (!pick || s.frontier > pick.frontier)) pick = s;
        }
        if (!pick || pick.frontier <= kept()) break;
      }
      for (let n = 0; n < LINES_PER_STEP; n++) {
        const line = await pick.reader.next();
        if (line == null) {
          pick.done = true;
          break;
        }
        pick.frontier = timeBoundBefore(pick.index, pick.reader.lastOffset);
        const rec = parseSessionLine(line);
        if (!rec) continue;
        const msg: ChatMessage | null = recordToUiMessage(rec);
        if (!msg) continue;
        if (pick.owner.squad && !(msg.role === 'user' || (msg.role === 'assistant' && msg.speakerBotId))) continue;
        const plain = plainTextFromMarkdown(stripThinkContent(msg.content || ''));
        const idx = plain.toLowerCase().indexOf(q);
        if (idx < 0) continue;
        const { file: _f, squad: _s, speakerNames, ...base } = pick.owner;
        const speakerName = msg.speakerBotId ? speakerNames?.get(msg.speakerBotId) : undefined;
        const hit: MessageSearchHit = {
          ...base,
          message: msg,
          snippet: snippetFor(plain, idx, q.length),
          ...(speakerName ? { speakerName } : {}),
        };
        // Keep `hits` sorted newest first and at most `limit` long.
        const ht = rowTime(msg.createdAt);
        let at = hits.length;
        while (at > 0 && rowTime(hits[at - 1]!.message.createdAt) < ht) at--;
        if (at < limit) {
          hits.splice(at, 0, hit);
          if (hits.length > limit) hits.length = limit;
        }
        if (hits.length >= limit && pick.frontier <= kept()) break;
      }
    }
  } finally {
    await Promise.all(states.map((s) => s.reader.close()));
  }
  return hits;
}
