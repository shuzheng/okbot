import OpenAI from 'openai';
import type { ChatMessage, ResolvedModelConfig } from '@okbot/shared';
import { stripThinkContent } from '@okbot/shared';
import { assertModel } from './model.js';

/** Busy-send router: same-task supplement vs a distinct parallel task. */
export type BusyIntent = 'supplement' | 'new_task';

const SUPPLEMENT_RE =
  /^(继续|接着|然后|还有[：:]?|另外[，,]?(?:说|补|加|一点)|补充|改成|改一下|不对|不是这样|等等|稍等|先这样|wait\.?$|actually[,:]|instead[,:]|also[,:]|btw\b|顺便(?!问)|修正|更新一下|加上|去掉|换成)/i;

const NEW_TASK_RE =
  /(另一个问题|另外一个问题|换个话题|新问题|无关的|问个无关|another question|new (?:topic|question)|different (?:topic|question)|unrelated)/i;

/**
 * Cheap sync classifier. Returns null when ambiguous (caller may ask the model).
 */
export function classifyBusyIntentHeuristic(input: {
  newUserText: string;
  activeRunCount: number;
  hasQuote?: boolean;
}): BusyIntent | null {
  const text = (input.newUserText || '').trim();
  if (!text) return 'supplement';
  if (NEW_TASK_RE.test(text)) return 'new_task';
  if (input.hasQuote) return 'supplement';
  if (SUPPLEMENT_RE.test(text)) return 'supplement';
  // Very short follow-ups without a question mark are usually steers.
  // Keep the threshold low so a short Chinese request is not misread as a steer.
  if (text.length <= 12 && !/[?？]/.test(text)) return 'supplement';
  return null;
}

/**
 * Fail-open when the model is unavailable or unclear:
 * one active run → supplement (avoid a racing sibling bubble);
 * several → new_task (preserve parallelism).
 */
export function classifyBusyIntentFallback(activeRunCount: number): BusyIntent {
  return activeRunCount <= 1 ? 'supplement' : 'new_task';
}

/**
 * Router for sends while the owner is busy.
 * Heuristic first; optional cheap LLM when ambiguous.
 */
export async function classifyBusyIntent(input: {
  model?: ResolvedModelConfig | null;
  /** Labels / recent user lines of in-flight tasks (optional). */
  activeTaskHints?: string[];
  recentMessages?: ChatMessage[];
  newUserText: string;
  activeRunCount: number;
  hasQuote?: boolean;
  signal?: AbortSignal;
}): Promise<BusyIntent> {
  const heuristic = classifyBusyIntentHeuristic({
    newUserText: input.newUserText,
    activeRunCount: input.activeRunCount,
    hasQuote: input.hasQuote,
  });
  if (heuristic) return heuristic;

  if (input.signal?.aborted) {
    return classifyBusyIntentFallback(input.activeRunCount);
  }

  const model = input.model;
  if (!model) return classifyBusyIntentFallback(input.activeRunCount);

  try {
    assertModel(model);
  } catch {
    return classifyBusyIntentFallback(input.activeRunCount);
  }

  const recentParts: string[] = [];
  let chars = 0;
  const MAX_IN = 4_000;
  const slice = (input.recentMessages ?? []).slice(-8);
  for (const m of slice) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const raw = m.role === 'assistant' ? stripThinkContent(m.content || '') : m.content || '';
    const body = raw.trim();
    if (!body) continue;
    const who = m.role === 'user' ? '用户' : '助手';
    const piece = `${who}: ${body.slice(0, 280)}`;
    if (chars + piece.length > MAX_IN) break;
    recentParts.push(piece);
    chars += piece.length;
  }

  const hints = (input.activeTaskHints ?? [])
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((h, i) => `${i + 1}. ${h.slice(0, 120)}`);

  const client = new OpenAI({
    apiKey: model.apiKey,
    baseURL: model.baseURL.replace(/\/$/, ''),
  });

  const system = [
    '你是忙碌会话路由判定器。用户在助手仍在处理任务时又发了一条消息。',
    '判断新消息是对当前在途任务的「补充/追问/改向」(supplement)，还是「另一个独立问题/任务」(new_task)。',
    '只输出一个 JSON 对象，不要代码围栏，不要解释：{"intent":"supplement"} 或 {"intent":"new_task"}',
    'supplement：同一任务的继续、补充材料、修正要求、澄清、改参数、催促。',
    'new_task：明显不同的主题/目标，或用户明确说另起一个问题。',
    '不确定时输出 {"intent":"supplement"}（避免拆成两条互不相关的回复流）。',
  ].join('\n');

  const user = [
    hints.length ? `在途任务提示：\n${hints.join('\n')}` : '在途任务提示：（无）',
    '',
    '近期对话：',
    recentParts.length ? recentParts.join('\n') : '（无）',
    '',
    `新用户消息：\n${(input.newUserText || '').trim().slice(0, 1_500)}`,
  ].join('\n');

  try {
    const completion = await client.chat.completions.create(
      {
        model: model.model,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      input.signal ? { signal: input.signal } : undefined,
    );

    let raw = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!raw) return classifyBusyIntentFallback(input.activeRunCount);
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { intent?: unknown };
        if (parsed.intent === 'new_task') return 'new_task';
        if (parsed.intent === 'supplement') return 'supplement';
      } catch {
        /* fall through */
      }
    }
    const lower = raw.toLowerCase();
    if (/\bnew_task\b/.test(lower) || lower.includes('new_task')) return 'new_task';
    if (/\bsupplement\b/.test(lower)) return 'supplement';
    return classifyBusyIntentFallback(input.activeRunCount);
  } catch (err) {
    if (input.signal?.aborted) return classifyBusyIntentFallback(input.activeRunCount);
    console.error('[okbot] classifyBusyIntent failed', err);
    return classifyBusyIntentFallback(input.activeRunCount);
  }
}
