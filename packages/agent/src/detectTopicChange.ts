import OpenAI from 'openai';
import type { ChatMessage, ResolvedModelConfig } from '@okbot/shared';
import { stripThinkContent } from '@okbot/shared';
import { assertModel } from './model.js';
import {
  buildTopicChangeSystemPrompt,
  buildTopicChangeUserPrompt,
} from './topicChangePrompt.js';

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

  const system = buildTopicChangeSystemPrompt();
  const user = buildTopicChangeUserPrompt({
    summary,
    recentDialogue: recentParts.length ? recentParts.join('\n') : '',
    newUserText: text.slice(0, 1_500),
  });

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
