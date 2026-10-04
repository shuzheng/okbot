import { estimateTokensFromText, stripThinkFromAgentInputItem } from '@okbot/shared';

/** One session.jsonl row used only to estimate what the model will actually see. */
export type BudgetSessionRow = {
  id: string;
  item: Record<string, unknown>;
};

const TOOL_RESULT_TYPES = new Set([
  'function_call_result',
  'function_call_output',
  'tool_result',
  'computer_call_output',
  'hosted_tool_result',
]);

const TOOL_CALL_TYPES = new Set([
  'function_call',
  'hosted_tool_call',
  'computer_call',
  'tool_call',
]);

/** Low-res image parts are not in the text heuristic. Count them so a vision turn is not under-budgeted. */
const IMAGE_PART_TOKENS = 800;

export function isToolResultItem(item: Record<string, unknown>): boolean {
  const t = typeof item.type === 'string' ? item.type : '';
  return TOOL_RESULT_TYPES.has(t);
}

function isToolCallItem(item: Record<string, unknown>): boolean {
  const t = typeof item.type === 'string' ? item.type : '';
  return TOOL_CALL_TYPES.has(t);
}

function toolPairKey(item: Record<string, unknown>): string | null {
  const raw = item.call_id ?? item.tool_call_id ?? (isToolCallItem(item) ? item.id : undefined);
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
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
      else if (typeof p.output === 'string') parts.push(p.output);
      else if (typeof p.refusal === 'string') parts.push(p.refusal);
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

function imagePartCount(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    const t = typeof p.type === 'string' ? p.type : '';
    if (t.includes('image') || p.image_url != null || p.image != null) n += 1;
  }
  return n;
}

function imageOnlyContent(content: unknown): unknown[] {
  if (!Array.isArray(content)) return [];
  return content.filter((part) => {
    if (!part || typeof part !== 'object') return false;
    const p = part as Record<string, unknown>;
    const t = typeof p.type === 'string' ? p.type : '';
    return t.includes('image') || p.image_url != null || p.image != null;
  });
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Text the model is charged for: message body, tool arguments, and tool output.
 * Assistant think spans are stripped first, matching the session the model receives.
 * Tool results are counted once (output/result/content), not doubled.
 */
export function sessionItemBudgetText(item: Record<string, unknown>): string {
  const view = stripThinkFromAgentInputItem(item);
  const toolResult = isToolResultItem(view);
  const chunks: string[] = [];
  if (!toolResult) {
    const contentText = contentToText(view.content);
    if (contentText) chunks.push(contentText);
    const args = view.arguments ?? view.params;
    if (args !== undefined) chunks.push(safeStringify(args));
  }
  const output = toolResult
    ? (view.output ?? view.result ?? view.content)
    : (view.output ?? view.result);
  if (output !== undefined) chunks.push(safeStringify(output));
  return chunks.join('\n');
}

export function estimatePackedSessionTokens(
  staticText: string,
  summary: string,
  rows: BudgetSessionRow[],
): number {
  const history = rows.map((r) => sessionItemBudgetText(r.item)).join('\n');
  const images = rows.reduce((n, r) => n + imagePartCount(r.item.content), 0);
  return estimateTokensFromText(`${staticText || ''}${summary || ''}${history}`) + images * IMAGE_PART_TOKENS;
}

/**
 * Rows the budget should charge for the prior transcript, plus tool rows the
 * model still receives after the last prior message (interrupted tool calls).
 * The new user message body stays out (it is already in staticText); its image
 * parts are kept so vision input is not invisible to the estimate.
 */
export function rowsForPriorBudget(
  rows: BudgetSessionRow[],
  prior: Array<{ id: string }>,
  coveredThroughId: string | null | undefined,
): BudgetSessionRow[] {
  if (!rows.length) return [];
  const priorIds = new Set(prior.map((m) => m.id));
  let start = 0;
  if (coveredThroughId) {
    const idx = rows.findIndex((r) => r.id === coveredThroughId);
    if (idx >= 0) start = idx + 1;
  }
  let end = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (priorIds.has(rows[i]!.id)) {
      end = i + 1;
      break;
    }
  }
  const head = end > start ? rows.slice(start, end) : [];
  const from = end >= 0 ? Math.max(end, start) : start;
  const tail: BudgetSessionRow[] = [];
  for (let i = from; i < rows.length; i++) {
    const row = rows[i]!;
    if (priorIds.has(row.id)) continue;
    if (isToolResultItem(row.item) || isToolCallItem(row.item)) {
      tail.push(row);
      continue;
    }
    const images = imageOnlyContent(row.item.content);
    if (images.length) {
      tail.push({
        id: `${row.id}:images`,
        item: { type: 'message', role: 'user', content: images },
      });
    }
  }
  return head.concat(tail);
}

function dropIndexesForToolResult(rows: BudgetSessionRow[], idx: number): Set<number> {
  const drop = new Set<number>([idx]);
  const key = toolPairKey(rows[idx]!.item);
  if (key) {
    rows.forEach((row, i) => {
      if (toolPairKey(row.item) === key) drop.add(i);
    });
    return drop;
  }
  for (let i = idx - 1; i >= 0; i--) {
    if (isToolCallItem(rows[i]!.item)) {
      drop.add(i);
      break;
    }
    if (isToolResultItem(rows[i]!.item)) break;
  }
  return drop;
}

/** Drop oldest tool-result rows, together with the paired call, until the estimate fits. */
export function omitOldestToolResultsUntilFit(input: {
  staticText: string;
  summary: string;
  rows: BudgetSessionRow[];
  threshold: number;
}): { rows: BudgetSessionRow[]; omitRecordIds: string[] } {
  const omitRecordIds: string[] = [];
  let rows = input.rows.slice();
  let estimated = estimatePackedSessionTokens(input.staticText, input.summary, rows);
  while (estimated >= input.threshold) {
    const idx = rows.findIndex((r) => isToolResultItem(r.item));
    if (idx < 0) break;
    const drop = dropIndexesForToolResult(rows, idx);
    const ordered = [...drop].sort((a, b) => a - b);
    for (const i of ordered) omitRecordIds.push(rows[i]!.id);
    rows = rows.filter((_, i) => !drop.has(i));
    estimated = estimatePackedSessionTokens(input.staticText, input.summary, rows);
  }
  return { rows, omitRecordIds };
}

/** Send-path failure: do not dispatch an over-long model request. */
export class ContextWindowExceededError extends Error {
  readonly code = 'context_window_exceeded' as const;
  constructor() {
    super(
      '上下文仍然超出模型窗口：已压缩到只保留摘要和新消息，并丢掉较早的工具结果，还是放不下。请缩短这条消息，或换一个上下文更大的模型。',
    );
    this.name = 'ContextWindowExceededError';
  }
}
