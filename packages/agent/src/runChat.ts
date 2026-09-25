import OpenAI from 'openai';
import { assertModel } from './model.js';
import type { RunChatInput, RunChatResult } from './types.js';

/**
 * V1 chat loop (no tools). Kept for smoke / fallback.
 */
export async function runChat(input: RunChatInput): Promise<RunChatResult> {
  assertModel(input.model);

  const client = new OpenAI({
    apiKey: input.model.apiKey,
    baseURL: input.model.baseURL.replace(/\/$/, ''),
  });

  const instructions = [
    `你是「${input.botName}」，一个桌面个人助手。`,
    input.botDescription?.trim() ? `简介：${input.botDescription.trim()}` : '',
    '用简洁、清楚的中文回答。不要编造你没有的工具能力。',
  ]
    .filter(Boolean)
    .join('\n');

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: instructions },
  ];
  for (const m of input.history ?? []) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: 'user', content: input.userText });

  try {
    const stream = await client.chat.completions.create(
      {
        model: input.model.model,
        messages,
        stream: true,
      },
      { signal: input.signal },
    );

    let content = '';
    for await (const chunk of stream) {
      if (input.signal?.aborted) break;
      const delta = chunk.choices?.[0]?.delta?.content ?? '';
      if (delta) {
        content += delta;
        input.onDelta?.(delta);
      }
    }

    if (!content.trim() && !input.signal?.aborted) {
      const completion = await client.chat.completions.create(
        {
          model: input.model.model,
          messages,
          stream: false,
        },
        { signal: input.signal },
      );
      content = completion.choices?.[0]?.message?.content ?? '';
      if (content) input.onDelta?.(content);
    }

    if (!content.trim() && !input.signal?.aborted) throw new Error('模型返回为空');
    return { content };
  } catch (err) {
    if (input.signal?.aborted) return { content: '' };
    throw err;
  }
}
