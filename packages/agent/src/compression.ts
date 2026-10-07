import OpenAI from 'openai';
import type { ChatMessage, ResolvedModelConfig } from '@okbot/shared';
import { CONTEXT_SUMMARY_MAX_CHARS, clampSessionSummary, stripThinkContent } from '@okbot/shared';
import { assertModel } from './model.js';

export const SUMMARY_DELTA_MAX_CHARS = 24_000;
export const SUMMARY_DELTA_PER_ITEM_CHARS = 2_000;

/** Soft cap for one tool digest line in the summarizer input. */
export const TOOL_DIGEST_MAX_CHARS = 280;

const TOOL_CALL_TYPES = new Set([
  'function_call',
  'hosted_tool_call',
  'computer_call',
  'tool_call',
]);
const TOOL_RESULT_TYPES = new Set([
  'function_call_result',
  'function_call_output',
  'tool_result',
  'computer_call_output',
  'hosted_tool_result',
]);

function digestSnippet(value: unknown, max: number): string {
  let raw: string;
  if (typeof value === 'string') raw = value;
  else {
    try {
      raw = JSON.stringify(value);
    } catch {
      raw = String(value ?? '');
    }
  }
  const one = raw.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max)}…`;
}

/**
 * Short tool call/result line for the rolling summary (not full transcripts).
 * Returns null when the row is not a tool item.
 */
export function formatToolRowDigest(
  item: Record<string, unknown>,
  maxChars = TOOL_DIGEST_MAX_CHARS,
): string | null {
  const t = typeof item.type === 'string' ? item.type : '';
  if (TOOL_CALL_TYPES.has(t)) {
    const name =
      (typeof item.name === 'string' && item.name) ||
      (typeof item.tool_name === 'string' && item.tool_name) ||
      'tool';
    const args = item.arguments ?? item.params ?? item.input;
    const argPart = args === undefined ? '' : ` args=${digestSnippet(args, 120)}`;
    return digestSnippet(`[工具调用] ${name}${argPart}`, maxChars);
  }
  if (TOOL_RESULT_TYPES.has(t)) {
    const name =
      (typeof item.name === 'string' && item.name) ||
      (typeof item.tool_name === 'string' && item.tool_name) ||
      'tool';
    const out = item.output ?? item.result ?? item.content;
    const outPart = out === undefined ? '' : ` → ${digestSnippet(out, 160)}`;
    return digestSnippet(`[工具结果] ${name}${outPart}`, maxChars);
  }
  return null;
}

export type SummaryDeltaRow =
  | { kind: 'message'; message: import('@okbot/shared').ChatMessage }
  | { kind: 'tool'; id: string; item: Record<string, unknown> };

/**
 * Interleave UI messages with session tool rows that fall in the same span,
 * so the summarizer sees tool digests instead of skipping them.
 */
export function interleaveDeltaWithToolRows(
  deltaMessages: import('@okbot/shared').ChatMessage[],
  sessionRows?: Array<{ id: string; item: Record<string, unknown> }>,
): SummaryDeltaRow[] {
  if (!sessionRows?.length) {
    return deltaMessages.map((message) => ({ kind: 'message' as const, message }));
  }
  const msgIds = new Set(deltaMessages.map((m) => m.id));
  if (!msgIds.size) return [];
  // Span: from first delta message in session order through last.
  let start = -1;
  let end = -1;
  for (let i = 0; i < sessionRows.length; i++) {
    if (msgIds.has(sessionRows[i]!.id)) {
      if (start < 0) start = i;
      end = i;
    }
  }
  if (start < 0) {
    return deltaMessages.map((message) => ({ kind: 'message' as const, message }));
  }
  const byId = new Map(deltaMessages.map((m) => [m.id, m] as const));
  const out: SummaryDeltaRow[] = [];
  const seenMsg = new Set<string>();
  for (let i = start; i <= end; i++) {
    const row = sessionRows[i]!;
    const msg = byId.get(row.id);
    if (msg) {
      out.push({ kind: 'message', message: msg });
      seenMsg.add(msg.id);
      continue;
    }
    if (formatToolRowDigest(row.item)) {
      out.push({ kind: 'tool', id: row.id, item: row.item });
    }
  }
  // Any delta messages missing from session rows (legacy) append at end.
  for (const m of deltaMessages) {
    if (!seenMsg.has(m.id)) out.push({ kind: 'message', message: m });
  }
  return out;
}

/** perItem <= 0 makes the chunk loops spin: offset never moves. */
function summaryPerItem(perItem: number | undefined): number {
  const n = perItem ?? SUMMARY_DELTA_PER_ITEM_CHARS;
  if (!Number.isFinite(n)) return SUMMARY_DELTA_PER_ITEM_CHARS;
  return Math.max(1, n);
}

export type SummaryDeltaSelection = {
  dialogue: string;
  /**
   * ChatMessage ids the summarizer input actually read in full, in order.
   * Tool row digests may appear in `dialogue` but their ids are never listed here
   * (coverage / rest slicing are message-only). Empty bodies are included.
   * An item is not included when its body was truncated or did not fit.
   */
  consumedIds: string[];
};

/**
 * Build the summarizer dialogue from delta messages.
 * Stops before an item that would exceed the input cap so callers do not mark it covered.
 */
export function selectDeltaForSummary(
  deltaMessages: ChatMessage[],
  limits?: {
    maxIn?: number;
    perItem?: number;
    /** Session rows (message + tool) for tool digests in the same span. */
    sessionRows?: Array<{ id: string; item: Record<string, unknown> }>;
  },
): SummaryDeltaSelection {
  const maxIn = limits?.maxIn ?? SUMMARY_DELTA_MAX_CHARS;
  const perItem = summaryPerItem(limits?.perItem);
  const dialogueParts: string[] = [];
  const consumedIds: string[] = [];
  let chars = 0;
  const rows = interleaveDeltaWithToolRows(deltaMessages, limits?.sessionRows);
  for (const row of rows) {
    if (row.kind === 'tool') {
      // Tool digests may enter summary text, but tool row ids must NOT enter
      // consumedIds: downstream treats those as ChatMessage ids (rest/coveredThroughId).
      const digest = formatToolRowDigest(row.item);
      if (!digest) {
        continue;
      }
      const sep = dialogueParts.length ? 2 : 0;
      if (chars + sep + digest.length > maxIn) {
        if (dialogueParts.length) dialogueParts.push('…(更早增量过长，已截断)');
        break;
      }
      dialogueParts.push(digest);
      chars += sep + digest.length;
      continue;
    }
    const m = row.message;
    if (m.role !== 'user' && m.role !== 'assistant') {
      consumedIds.push(m.id);
      continue;
    }
    const raw = m.role === 'assistant' ? stripThinkContent(m.content || '') : m.content || '';
    const body = raw.trim();
    if (!body) {
      consumedIds.push(m.id);
      continue;
    }
    const who = m.role === 'user' ? '用户' : '助手';
    const chunks: string[] = [];
    for (let offset = 0; offset < body.length; offset += perItem) {
      const part = body.slice(offset, offset + perItem);
      chunks.push(offset === 0 ? `${who}: ${part}` : `${who}（续）: ${part}`);
    }
    const addition = chunks.join('\n\n');
    const sep = dialogueParts.length ? 2 : 0;
    // A truncated prefix must not advance coverage: the unread tail would be gone for good.
    if (chars + sep + addition.length > maxIn) {
      if (dialogueParts.length) dialogueParts.push('…(更早增量过长，已截断)');
      break;
    }
    dialogueParts.push(...chunks);
    consumedIds.push(m.id);
    chars += sep + addition.length;
  }
  return { dialogue: dialogueParts.join('\n\n'), consumedIds };
}

export type SummarySlice =
  | { kind: 'batch'; dialogue: string; consumedIds: string[]; rest: ChatMessage[] }
  | { kind: 'partial'; dialogue: string; messageId: string; rest: ChatMessage[] }
  | { kind: 'stuck' };

function messageBody(m: ChatMessage): string {
  const raw = m.role === 'assistant' ? stripThinkContent(m.content || '') : m.content || '';
  return raw.trim();
}

/**
 * One summarizer input.
 * A single item larger than the cap is split: `partial` carries only a fitting prefix
 * and leaves the unread tail on that same message. The id is not consumed until a later
 * `batch` includes the remaining tail.
 */
export function nextSummarySlice(
  deltaMessages: ChatMessage[],
  limits?: {
    maxIn?: number;
    perItem?: number;
    sessionRows?: Array<{ id: string; item: Record<string, unknown> }>;
  },
): SummarySlice {
  const selected = selectDeltaForSummary(deltaMessages, limits);
  if (selected.consumedIds.length) {
    // consumedIds are message ids only (see selectDeltaForSummary). Slice rest
    // from the last fully consumed message; never treat a missing id as "all done".
    const last = selected.consumedIds[selected.consumedIds.length - 1]!;
    const idx = deltaMessages.findIndex((m) => m.id === last);
    return {
      kind: 'batch',
      dialogue: selected.dialogue,
      consumedIds: selected.consumedIds,
      rest: idx >= 0 ? deltaMessages.slice(idx + 1) : deltaMessages,
    };
  }
  const maxIn = limits?.maxIn ?? SUMMARY_DELTA_MAX_CHARS;
  const perItem = summaryPerItem(limits?.perItem);
  const headIndex = deltaMessages.findIndex((m) => {
    if (m.role !== 'user' && m.role !== 'assistant') return false;
    return messageBody(m).length > 0;
  });
  if (headIndex < 0) return { kind: 'stuck' };
  const head = deltaMessages[headIndex]!;
  const body = messageBody(head);
  const who = head.role === 'user' ? '用户' : '助手';
  const chunks: string[] = [];
  let chars = 0;
  let offset = 0;
  while (offset < body.length) {
    const part = body.slice(offset, offset + perItem);
    const line = chunks.length === 0 ? `${who}: ${part}` : `${who}（续）: ${part}`;
    const sep = chunks.length ? 2 : 0;
    if (chars + sep + line.length > maxIn) break;
    chunks.push(line);
    chars += sep + line.length;
    offset += part.length;
  }
  if (offset <= 0) {
    const label = `${who}: `;
    const room = maxIn - label.length;
    if (room <= 0) return { kind: 'stuck' };
    offset = Math.min(body.length, room);
    if (offset <= 0) return { kind: 'stuck' };
    chunks.push(label + body.slice(0, offset));
  }
  const after = () => [...deltaMessages.slice(0, headIndex), ...deltaMessages.slice(headIndex + 1)];
  if (offset >= body.length) {
    return {
      kind: 'batch',
      dialogue: chunks.join('\n\n'),
      consumedIds: [head.id],
      rest: after(),
    };
  }
  const restBody = body.slice(offset);
  const rest = deltaMessages.map((m, i) => (i === headIndex ? { ...m, content: restBody } : m));
  return {
    kind: 'partial',
    dialogue: chunks.join('\n\n'),
    messageId: head.id,
    rest,
  };
}

export type SessionHistoryCompressResult = {
  summary: string;
  /** Last delta message id fully included. An oversized item stays uncovered until its tail is included. */
  consumedThroughId: string | null;
};

/**
 * Summary+Buffer compressor (SlimContext / ConversationSummaryBuffer style).
 * Merges `previousSummary` with ONLY the newly uncovered older turns (`deltaMessages`)
 * into a structured summary ≤ summaryMaxChars (default CONTEXT_SUMMARY_MAX_CHARS).
 * `consumedThroughId` stops at the last item actually placed in the summary input.
 * One item bigger than the summarizer input is folded across calls; its id advances only
 * after the unread tail has been included.
 * A partial prefix is not part of the returned summary unless that same call consumes the item.
 * Otherwise an abort would persist the prefix and the next call would summarize it again.
 */
export async function compressSessionHistory(input: {
  model: ResolvedModelConfig;
  previousSummary?: string | null;
  /** Newly dropped-out older turns only (not the whole older span). */
  deltaMessages: ChatMessage[];
  signal?: AbortSignal;
  /** Soft char budget for the rolling summary; defaults to CONTEXT_SUMMARY_MAX_CHARS. */
  summaryMaxChars?: number;
  /** Optional session rows so tool calls/results become short digests in the summary. */
  sessionRows?: Array<{ id: string; item: Record<string, unknown> }>;
}): Promise<SessionHistoryCompressResult> {
  assertModel(input.model);
  const maxChars =
    typeof input.summaryMaxChars === 'number' &&
    Number.isFinite(input.summaryMaxChars) &&
    input.summaryMaxChars >= 100
      ? Math.floor(input.summaryMaxChars)
      : CONTEXT_SUMMARY_MAX_CHARS;
  const prev = (input.previousSummary || '').trim();
  const empty = (summary: string, consumedThroughId: string | null): SessionHistoryCompressResult => ({
    summary: clampSessionSummary(summary, maxChars),
    consumedThroughId,
  });
  if (input.signal?.aborted) return empty(prev, null);
  if (!input.deltaMessages.length) return empty(prev, null);

  const mergeSummary = async (previous: string, dialogue: string): Promise<{ summary: string; produced: boolean }> => {
    if (!dialogue.trim()) return { summary: previous, produced: false };
    const client = new OpenAI({
      apiKey: input.model.apiKey,
      baseURL: input.model.baseURL.replace(/\/$/, ''),
    });
    const system = [
      '你是桌面助手的会话摘要器，采用 Summary+Buffer：把「旧摘要」与「新掉出窗口的对话增量」合并成一份结构化滚动摘要。',
      `硬性限制：全文不超过 ${maxChars} 字（汉字+标点），不要代码围栏，不要前言。`,
      '必须使用下面五个小标题（无内容写「无」）：',
      '目标：',
      '约定：',
      '路径/命令：',
      '未完成：',
      '其他：',
      '规则：保留稳定事实、决定、文件路径、命令、未完成事项；丢掉寒暄、重复确认、大段代码/日志。',
      '工具行若出现为「[工具调用]/或「[工具结果]」短摘要，保留工具名与关键参数/结果要点即可。',
      '合并时更新过时信息，不要简单把旧摘要和新内容首尾拼接。',
      '稳定约定和决定写在「约定：」下，每条一行，供长期记忆。',
      '细节若被压缩掉，可提示稍后用 search_history 按关键词检索本会话。',
    ].join('\n');
    const user = [
      previous ? `旧摘要：\n${previous}` : '旧摘要：（无，这是首次压缩）',
      '',
      '新掉出最近窗口的对话增量：',
      dialogue,
    ].join('\n');
    const completion = await client.chat.completions.create(
      {
        model: input.model.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      input.signal ? { signal: input.signal } : undefined,
    );
    let raw = stripThinkContent(completion.choices[0]?.message?.content ?? '').trim();
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    raw = raw.replace(/^摘要[:：]\s*/u, '').trim();
    if (!raw) return { summary: previous, produced: false };
    return { summary: raw, produced: true };
  };

  let pending = input.deltaMessages.slice();
  let summary = prev;
  // Only a fully consumed item is safe to return. A partial prefix stays in `summary`
  // so later slices of that same item can fold forward, and is dropped if we stop early.
  let committed = prev;
  let consumedThroughId: string | null = null;
  for (let step = 0; step < 64 && pending.length; step++) {
    if (input.signal?.aborted) break;
    const slice = nextSummarySlice(pending, { sessionRows: input.sessionRows });
    if (slice.kind === 'stuck') break;
    let nextSummary = summary;
    if (slice.dialogue.trim()) {
      try {
        const merged = await mergeSummary(summary, slice.dialogue);
        if (!merged.produced && slice.kind === 'partial') break;
        nextSummary = merged.summary;
      } catch (err) {
        if (consumedThroughId) return empty(committed, consumedThroughId);
        throw err;
      }
    }
    if (slice.kind === 'batch') {
      const last = slice.consumedIds[slice.consumedIds.length - 1];
      if (last) consumedThroughId = last;
      summary = nextSummary;
      committed = nextSummary;
    } else {
      summary = nextSummary;
    }
    pending = slice.rest;
  }
  return empty(committed, consumedThroughId);
}
