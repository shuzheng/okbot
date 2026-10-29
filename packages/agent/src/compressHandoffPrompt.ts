/**
 * Codex-style handoff framing for Summary+Buffer session compression.
 * The compress model is told it is writing a handoff for another (or the same)
 * model that will continue the work — structured and complete, not a dry summary.
 * Section headings must stay stable for durableFacts parsers.
 */

/** Five fixed section titles required by durableFacts parsers — do not rename. */
export const COMPRESS_HANDOFF_SECTION_HEADINGS = [
  '目标：',
  '约定：',
  '路径/命令：',
  '未完成：',
  '其他：',
] as const;

/**
 * System prompt for the compress model: produce a clear, structured handoff
 * for whoever continues the session (possibly the same model after compression).
 */
export function buildCompressHandoffSystemPrompt(maxChars: number): string {
  return [
    '你正在为桌面助手写一份「交接文档」（handoff）。',
    '当前这段工作即将交给另一个（或同一个）模型继续处理：请把接手方继续工作所需的重点写清楚、写完整、结构化——不要写成干瘪的流水账摘要。',
    '采用 Summary+Buffer：把「旧交接文档」与「新掉出窗口的对话增量」合并成一份可滚动更新的交接文档。',
    `硬性限制：全文不超过 ${maxChars} 字（汉字+标点），不要代码围栏，不要前言。`,
    '必须使用下面五个小标题（无内容写「无」）：',
    ...COMPRESS_HANDOFF_SECTION_HEADINGS,
    '规则：保留稳定事实、决定、文件路径、命令、未完成事项；丢掉寒暄、重复确认、大段代码/日志。',
    '工具行若出现为「[工具调用]」或「[工具结果]」短摘要，保留工具名与关键参数/结果要点即可。',
    '合并时更新过时信息，不要简单把旧文档和新内容首尾拼接；以接手方可直接续作为准。',
    '稳定约定和决定写在「约定：」下，每条一行，供长期记忆。',
    '细节若被压缩掉，可提示稍后用 search_history 按关键词检索本会话。',
  ].join('\n');
}

/** User message pairing prior handoff with newly dropped-out dialogue. */
export function buildCompressHandoffUserPrompt(previous: string, dialogue: string): string {
  return [
    previous ? `旧交接文档：\n${previous}` : '旧交接文档：（无，这是首次压缩）',
    '',
    '新掉出最近窗口的对话增量：',
    dialogue,
  ].join('\n');
}

/** Strip optional title prefixes models sometimes prepend. */
export function stripCompressHandoffPreamble(raw: string): string {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  text = text
    .replace(/^(?:摘要|交接文档|handoff(?:\s+document)?)\s*[:：]\s*/iu, '')
    .trim();
  return text;
}
