import { stripThinkFromAgentInputItem } from '@okbot/shared';
const DEFAULT_TRUNCATE = 4_000;

function truncate(text: string, max = DEFAULT_TRUNCATE): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(已截断，共 ${text.length} 字符)`;
}

function contentToText(content: unknown): string {
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
      else if (typeof p.output === 'string') parts.push(p.output);
      else if (p.type === 'input_image' || p.type === 'image') parts.push('[image]');
      else {
        try {
          parts.push(JSON.stringify(p));
        } catch {
          parts.push(String(p));
        }
      }
    }
    return parts.join('');
  }
  if (content == null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function safeJson(value: unknown, max = DEFAULT_TRUNCATE): string {
  try {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          return truncate(JSON.stringify(JSON.parse(trimmed), null, 2), max);
        } catch {
          /* fall through */
        }
      }
      return truncate(value, max);
    }
    return truncate(JSON.stringify(value, null, 2), max);
  } catch {
    return truncate(String(value), max);
  }
}

/**
 * Normalize ATX heading spacing for prompt-context markdown:
 * blank line after each heading when the next line is non-empty;
 * blank line before a heading when it follows non-blank content;
 * collapse runs of blank lines to a single blank line.
 */
export function normalizeMarkdownHeadings(text: string): string {
  if (!text) return text;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const isHeading = (line: string) => /^#{1,6}\s+\S/.test(line);
  const isBlank = (line: string) => line.trim() === '';

  const spaced: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isHeading(line)) {
      const prev = spaced.length ? spaced[spaced.length - 1]! : undefined;
      if (prev !== undefined && !isBlank(prev)) spaced.push('');
      spaced.push(line);
      const next = lines[i + 1];
      if (next !== undefined && !isBlank(next)) spaced.push('');
      continue;
    }
    spaced.push(line);
  }

  const out: string[] = [];
  let prevBlank = false;
  for (const line of spaced) {
    if (isBlank(line)) {
      if (prevBlank) continue;
      out.push('');
      prevBlank = true;
    } else {
      out.push(line);
      prevBlank = false;
    }
  }

  let result = out.join('\n');
  if (text.endsWith('\n') && !result.endsWith('\n')) result += '\n';
  return result;
}

/** Format one AgentInputItem-like object for human-readable prompt-context display. */
export function formatAgentInputItem(item: Record<string, unknown>, index: number): string {
  // Mirror model context: assistant `<think>` spans are stripped.
  const view = stripThinkFromAgentInputItem(item);
  const type = typeof view.type === 'string' ? view.type : 'unknown';
  const role = typeof view.role === 'string' ? view.role : undefined;
  const lines: string[] = [];

  if (type === 'message' || role === 'user' || role === 'assistant' || role === 'system') {
    const who = role || 'message';
    lines.push(`### [${index}] message · ${who}`);
    const text = contentToText(view.content).trim();
    lines.push(text ? truncate(text) : '(empty)');
    return lines.join('\n');
  }

  if (type === 'function_call' || type === 'hosted_tool_call' || type === 'computer_call') {
    const name =
      typeof item.name === 'string'
        ? item.name
        : typeof item.tool_name === 'string'
          ? item.tool_name
          : 'tool';
    lines.push(`### [${index}] tool_call · ${name}`);
    if (item.call_id != null) lines.push(`call_id: ${String(item.call_id)}`);
    if (item.id != null && item.call_id == null) lines.push(`id: ${String(item.id)}`);
    const args = item.arguments ?? item.params ?? item.input;
    if (args !== undefined) {
      lines.push('arguments:');
      lines.push(safeJson(args));
    }
    return lines.join('\n');
  }

  if (
    type === 'function_call_result' ||
    type === 'function_call_output' ||
    type === 'tool_result' ||
    type === 'computer_call_output' ||
    type === 'hosted_tool_result'
  ) {
    const name =
      typeof item.name === 'string'
        ? item.name
        : typeof item.tool_name === 'string'
          ? item.tool_name
          : 'tool';
    lines.push(`### [${index}] tool_result · ${name}`);
    if (item.call_id != null) lines.push(`call_id: ${String(item.call_id)}`);
    const output = item.output ?? item.result ?? item.content;
    if (output !== undefined) {
      lines.push('output:');
      lines.push(typeof output === 'string' ? truncate(output) : safeJson(output));
    }
    return lines.join('\n');
  }

  lines.push(`### [${index}] ${type}`);
  lines.push(safeJson(item));
  return lines.join('\n');
}

export function formatAgentInputItems(items: Array<Record<string, unknown>>): string {
  if (!items.length) return '(无 session items)';
  return items.map((item, i) => formatAgentInputItem(item, i + 1)).join('\n\n');
}

export interface FormatSessionPromptContextInput {
  /** Current instructions (same builder as the run path when session owns history). */
  instructions: string;
  /** Session items chronological, already sliced through the target user message. */
  items: Array<Record<string, unknown>>;
  messageId: string;
  /** False when messageId was not found in the session store. */
  found: boolean;
  /** Summary+Buffer marker: session items are only the live tail after this id. */
  coveredThroughId?: string;
}

/**
 * Build the “本轮完整上下文” modal body from live Session + current system materials.
 * Not a historical frozen file — header states that caveat.
 */
export function formatSessionPromptContext(input: FormatSessionPromptContextInput): string {
  if (!input.found) {
    return normalizeMarkdownHeadings(
      [
        '# OkBot 本轮完整上下文（Session 投影）',
        '',
        `未找到 messageId=${input.messageId} 对应的会话项。`,
        '',
      ].join('\n'),
    );
  }

  const markerNote = input.coveredThroughId
    ? `Summary+Buffer：session items 仅含 coveredThroughId=${input.coveredThroughId} 之后的未压缩尾部（与模型本轮可见窗口一致）；更早轮次见下方 instructions 中的「更早对话摘要」，界面气泡仍保留全量历史。`
    : '无压缩标记：session items 为截断点之前的全部记录。';
  const emptyTailNote =
    input.coveredThroughId && input.items.length === 0
      ? '本条消息落在已摘要区间内，或压缩后尚未产生新的未覆盖尾部；模型侧无额外 session items（摘要见 instructions）。'
      : '';
  const header = [
    '# OkBot 本轮完整上下文（Session 投影）',
    '',
    '说明：根据当前 SDK Session 中的会话项，以及**此刻**的系统材料（AGENTS.md / skills 目录 / memories / 会话摘要 / 工具设置）实时重建，',
    '并非发送当时冻结的历史快照。Skills 正文仅在本轮 read_skill 工具结果中出现；若之后自动维护过 AGENTS.md、skills 或记忆，展示可能与当时模型所见略有差异。',
    `截断点：含用户消息 id = ${input.messageId} 及之前的 session items（与模型实际可见窗口对齐）。`,
    markerNote,
    ...(emptyTailNote ? [emptyTailNote] : []),
    '',
  ].join('\n');

  return normalizeMarkdownHeadings(
    [
      header,
      '## instructions',
      input.instructions.trim() || '(empty)',
      '',
      '## session items',
      formatAgentInputItems(input.items),
      '',
    ].join('\n'),
  );
}
