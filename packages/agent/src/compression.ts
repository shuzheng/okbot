import OpenAI from 'openai';
import type { ChatMessage, ResolvedModelConfig } from '@okbot/shared';
import { CONTEXT_SUMMARY_MAX_CHARS, clampSessionSummary, stripThinkContent } from '@okbot/shared';
import { assertModel } from './model.js';

export const SUMMARY_DELTA_MAX_CHARS = 24_000;
export const SUMMARY_DELTA_PER_ITEM_CHARS = 2_000;

export type SummaryDeltaSelection = {
  dialogue: string;
  /**
   * Message ids the summarizer input actually read in full, in order.
   * Empty bodies are included (nothing unread). An item is not included when its
   * body was truncated or did not fit in the remaining char cap.
   */
  consumedIds: string[];
};

/**
 * Build the summarizer dialogue from delta messages.
 * Stops before an item that would exceed the input cap so callers do not mark it covered.
 */
export function selectDeltaForSummary(
  deltaMessages: ChatMessage[],
  limits?: { maxIn?: number; perItem?: number },
): SummaryDeltaSelection {
  const maxIn = limits?.maxIn ?? SUMMARY_DELTA_MAX_CHARS;
  const perItem = limits?.perItem ?? SUMMARY_DELTA_PER_ITEM_CHARS;
  const dialogueParts: string[] = [];
  const consumedIds: string[] = [];
  let chars = 0;
  for (const m of deltaMessages) {
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

export type SessionHistoryCompressResult = {
  summary: string;
  /** Last delta message id included in the summarizer input. Null if none were read. */
  consumedThroughId: string | null;
};

/**
 * Summary+Buffer compressor (SlimContext / ConversationSummaryBuffer style).
 * Merges `previousSummary` with ONLY the newly uncovered older turns (`deltaMessages`)
 * into a structured summary ≤ summaryMaxChars (default CONTEXT_SUMMARY_MAX_CHARS).
 * `consumedThroughId` stops at the last item actually placed in the summary input.
 */
export async function compressSessionHistory(input: {
  model: ResolvedModelConfig;
  previousSummary?: string | null;
  /** Newly dropped-out older turns only (not the whole older span). */
  deltaMessages: ChatMessage[];
  signal?: AbortSignal;
  /** Soft char budget for the rolling summary; defaults to CONTEXT_SUMMARY_MAX_CHARS. */
  summaryMaxChars?: number;
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

  const selected = selectDeltaForSummary(input.deltaMessages);
  const consumedThroughId = selected.consumedIds.length
    ? selected.consumedIds[selected.consumedIds.length - 1]!
    : null;
  // Cap cut the increment off before any item was read — do not pretend it was summarized.
  if (!selected.consumedIds.length) return empty(prev, null);

  const dialogue = selected.dialogue;
  if (!dialogue.trim() && !prev) return empty('', consumedThroughId);

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
    '规则：保留稳定事实、决定、文件路径、命令、未完成事项；丢掉寒暄、重复确认、大段代码/日志/工具逐条输出。',
    '合并时更新过时信息，不要简单把旧摘要和新内容首尾拼接。',
    '稳定约定和决定写在「约定：」下，每条一行，供长期记忆。',
  ].join('\n');

  const user = [
    prev ? `旧摘要：\n${prev}` : '旧摘要：（无，这是首次压缩）',
    '',
    '新掉出最近窗口的对话增量：',
    dialogue || '（无）',
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

  // Strip CoT so rolling session summaries never persist model thinking.
  let raw = stripThinkContent(completion.choices[0]?.message?.content ?? '').trim();
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  raw = raw.replace(/^摘要[:：]\s*/u, '').trim();
  if (!raw) return empty(prev, consumedThroughId);
  return empty(raw, consumedThroughId);
}
