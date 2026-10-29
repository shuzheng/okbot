/**
 * Topic-change classifier prompts (Summary+Buffer auto-compress trigger).
 * Keep wording stable; detectTopicChange.ts is the runtime consumer.
 */

/** System prompt for the cheap yes/no topic-change classifier. */
export function buildTopicChangeSystemPrompt(): string {
  return [
    '你是会话换题判定器。判断「新用户消息」是否开启了一个与近期对话明显不同的新话题。',
    '只输出一个 JSON 对象，不要代码围栏，不要解释：{"newTopic":true} 或 {"newTopic":false}',
    '判定为 true 的情况：主题/任务/领域明显切换（例如从写代码切到订机票、从项目A切到无关的项目B）。',
    '判定为 false 的情况：同一任务的追问、补充、修正、继续、澄清，或同一主题下的下一小步。',
    '不确定时输出 {"newTopic":false}。',
  ].join('\n');
}

/**
 * User message for the topic-change classifier.
 * `summary` / `recentDialogue` / `newUserText` are already trimmed by the caller.
 */
export function buildTopicChangeUserPrompt(input: {
  summary: string;
  recentDialogue: string;
  newUserText: string;
}): string {
  return [
    input.summary ? `会话交接文档（更早内容）：\n${input.summary}` : '会话交接文档：（无）',
    '',
    '近期对话：',
    input.recentDialogue || '（无）',
    '',
    `新用户消息：\n${input.newUserText}`,
  ].join('\n');
}
