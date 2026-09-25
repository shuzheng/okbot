import OpenAI from 'openai';
import type { ChatMessage, ResolvedModelConfig } from '@okbot/shared';
import { CONTEXT_SUMMARY_MAX_CHARS, clampSessionSummary, stripThinkContent } from '@okbot/shared';
import { assertModel } from './model.js';

/**
 * Summary+Buffer compressor (SlimContext / ConversationSummaryBuffer style).
 * Merges `previousSummary` with ONLY the newly uncovered older turns (`deltaMessages`)
 * into a structured summary ≤ summaryMaxChars (default CONTEXT_SUMMARY_MAX_CHARS).
 */
export async function compressSessionHistory(input: {
  model: ResolvedModelConfig;
  previousSummary?: string | null;
  /** Newly dropped-out older turns only (not the whole older span). */
  deltaMessages: ChatMessage[];
  signal?: AbortSignal;
  /** Soft char budget for the rolling summary; defaults to CONTEXT_SUMMARY_MAX_CHARS. */
  summaryMaxChars?: number;
}): Promise<string> {
  assertModel(input.model);
  const maxChars =
    typeof input.summaryMaxChars === 'number' &&
    Number.isFinite(input.summaryMaxChars) &&
    input.summaryMaxChars >= 100
      ? Math.floor(input.summaryMaxChars)
      : CONTEXT_SUMMARY_MAX_CHARS;
  const prev = (input.previousSummary || '').trim();
  if (input.signal?.aborted) return clampSessionSummary(prev, maxChars);
  if (!input.deltaMessages.length) return clampSessionSummary(prev, maxChars);

  const dialogueParts: string[] = [];
  let chars = 0;
  const MAX_IN = 24_000;
  for (const m of input.deltaMessages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const raw = m.role === 'assistant' ? stripThinkContent(m.content || '') : m.content || '';
    const body = raw.trim();
    if (!body) continue;
    const who = m.role === 'user' ? '用户' : '助手';
    const piece = `${who}: ${body.slice(0, 2000)}`;
    if (chars + piece.length > MAX_IN) {
      dialogueParts.push('…(更早增量过长，已截断)');
      break;
    }
    dialogueParts.push(piece);
    chars += piece.length;
  }
  const dialogue = dialogueParts.join('\n\n');
  if (!dialogue.trim() && !prev) return '';

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

  let raw = completion.choices[0]?.message?.content?.trim() ?? '';
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  raw = raw.replace(/^摘要[:：]\s*/u, '').trim();
  if (!raw) return clampSessionSummary(prev, maxChars);
  return clampSessionSummary(raw, maxChars);
}
