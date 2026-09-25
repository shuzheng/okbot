import OpenAI from 'openai';
import type { ChatMessage, ResolvedModelConfig } from '@okbot/shared';
import { stripThinkContent } from '@okbot/shared';
import { assertModel } from './model.js';

/**
 * Cheap yes/no: does `newUserText` start a new topic vs recent turns / session summary?
 * Fail-open: any error / unparseable answer → false (do not force compress).
 */
export async function detectTopicChange(input: {
  model: ResolvedModelConfig;
  sessionSummary?: string | null;
  /** Recent live-buffer turns (already after coveredThroughId). */
  recentMessages: ChatMessage[];
  newUserText: string;
  signal?: AbortSignal;
}): Promise<boolean> {
  const text = (input.newUserText || '').trim();
  if (!text) return false;
  if (input.signal?.aborted) return false;

  try {
    assertModel(input.model);
  } catch {
    return false;
  }

  const recentParts: string[] = [];
  let chars = 0;
  const MAX_IN = 6_000;
  // Prefer the last ~12 turns for latency; topic judgment does not need the full buffer.
  const slice = input.recentMessages.slice(-12);
  for (const m of slice) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const raw = m.role === 'assistant' ? stripThinkContent(m.content || '') : m.content || '';
    const body = raw.trim();
    if (!body) continue;
    const who = m.role === 'user' ? '用户' : '助手';
    const piece = `${who}: ${body.slice(0, 400)}`;
    if (chars + piece.length > MAX_IN) break;
    recentParts.push(piece);
    chars += piece.length;
  }

  const summary = (input.sessionSummary || '').trim().slice(0, 1_200);
  if (!recentParts.length && !summary) return false;

  const client = new OpenAI({
    apiKey: input.model.apiKey,
    baseURL: input.model.baseURL.replace(/\/$/, ''),
  });

  const system = [
    '你是会话换题判定器。判断「新用户消息」是否开启了一个与近期对话明显不同的新话题。',
    '只输出一个 JSON 对象，不要代码围栏，不要解释：{"newTopic":true} 或 {"newTopic":false}',
    '判定为 true 的情况：主题/任务/领域明显切换（例如从写代码切到订机票、从项目A切到无关的项目B）。',
    '判定为 false 的情况：同一任务的追问、补充、修正、继续、澄清，或同一主题下的下一小步。',
    '不确定时输出 {"newTopic":false}。',
  ].join('\n');

  const user = [
    summary ? `会话摘要（更早内容）：\n${summary}` : '会话摘要：（无）',
    '',
    '近期对话：',
    recentParts.length ? recentParts.join('\n') : '（无）',
    '',
    `新用户消息：\n${text.slice(0, 1_500)}`,
  ].join('\n');

  try {
    const completion = await client.chat.completions.create(
      {
        model: input.model.model,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      input.signal ? { signal: input.signal } : undefined,
    );

    let raw = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!raw) return false;
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    // Prefer JSON; also accept bare true/false / 中文 是/否.
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { newTopic?: unknown };
        return parsed.newTopic === true;
      } catch {
        /* fall through */
      }
    }
    const lower = raw.toLowerCase();
    if (/\bnewtopic\s*[:=]\s*true\b/.test(lower) || lower === 'true' || raw === '是') {
      return true;
    }
    return false;
  } catch (err) {
    if (input.signal?.aborted) return false;
    console.error('[okbot] detectTopicChange failed', err);
    return false;
  }
}
