import OpenAI from 'openai';
import {
  DEFAULT_AGENTS_MD_RECENT_MESSAGE_LIMIT,
  DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT,
  DEFAULT_MEMORY_RECENT_MESSAGE_LIMIT,
  DEFAULT_MEMORY_SCOPE_INSTRUCTION,
  DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION,
  DEFAULT_SKILLS_RECENT_MESSAGE_LIMIT,
  normalizeMaxTurns,
  stripThinkContent,
  type BotSkill,
  type ChatMessage,
  type MemoryEntry,
  type ResolvedModelConfig,
} from '@okbot/shared';
import { assertModel } from './model.js';
import { mergeAgentsMdFromModel } from './agentsMdPatch.js';

/**
 * Silently patch AGENTS.md from recent chat. Returns updated markdown, or null if unchanged.
 * Only changed sections are applied; a full-file rewrite is ignored.
 * Caller writes the file; next chat turn reloads from disk.
 */
export async function refreshAgentsMd(input: {
  model: ResolvedModelConfig;
  botName: string;
  currentAgentsMd: string;
  recentMessages: ChatMessage[];
  /** Full system prompt; blank / missing → DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT. */
  systemPrompt?: string;
  /** Recent user/assistant window; missing / invalid → 12; clamp 1–100. */
  recentMessageLimit?: number;
  signal?: AbortSignal;
}): Promise<string | null> {
  assertModel(input.model);
  if (input.signal?.aborted) return null;

  const limit = normalizeMaxTurns(
    input.recentMessageLimit,
    DEFAULT_AGENTS_MD_RECENT_MESSAGE_LIMIT,
  );
  const dialogue = input.recentMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-limit)
    .map((m) => {
      const body =
        m.role === 'assistant' ? stripThinkContent(m.content || '') : m.content || '';
      return `${m.role === 'user' ? '用户' : '助手'}: ${body.trim()}`;
    })
    .filter((line) => line.length > 3)
    .join('\n\n');
  if (!dialogue.trim()) return null;

  const client = new OpenAI({
    apiKey: input.model.apiKey,
    baseURL: input.model.baseURL.replace(/\/$/, ''),
  });

  const system =
    (input.systemPrompt ?? '').trim() || DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT;

  const user = [
    `机器人名称：${input.botName}`,
    '',
    '当前 AGENTS.md：',
    input.currentAgentsMd.trim() || '（空）',
    '',
    '最近对话：',
    dialogue,
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

  const choice = completion.choices[0];
  // Truncated completions are unsafe to apply as section patches.
  if (choice?.finish_reason === 'length') return null;

  // Model CoT (<think>…</think>) must never land in AGENTS.md.
  const raw = stripThinkContent(choice?.message?.content ?? '').trim();
  if (!raw) return null;
  return mergeAgentsMdFromModel(input.currentAgentsMd, raw);
}

export type SkillRefreshResult =
  | { action: 'none' }
  | { action: 'upsert'; skill: BotSkill };

/**
 * Detect fixed / repeated workflows (≥2 times) and propose a skill upsert.
 * Caller writes skills/<slug>/SKILL.md; next turn reloads from disk into context.
 */
export async function refreshBotSkills(input: {
  model: ResolvedModelConfig;
  botName: string;
  existingSkills: BotSkill[];
  recentMessages: ChatMessage[];
  /** Create/update decision line; blank / missing → DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION. */
  createUpdateInstruction?: string;
  /** Recent user/assistant window; missing / invalid → 20; clamp 1–100. */
  recentMessageLimit?: number;
  signal?: AbortSignal;
}): Promise<SkillRefreshResult> {
  assertModel(input.model);
  if (input.signal?.aborted) return { action: 'none' };

  const limit = normalizeMaxTurns(
    input.recentMessageLimit,
    DEFAULT_SKILLS_RECENT_MESSAGE_LIMIT,
  );
  const dialogue = input.recentMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-limit)
    .map((m) => {
      const body =
        m.role === 'assistant' ? stripThinkContent(m.content || '') : m.content || '';
      return `${m.role === 'user' ? '用户' : '助手'}: ${body.trim()}`;
    })
    .filter((line) => line.length > 3)
    .join('\n\n');
  if (!dialogue.trim()) return { action: 'none' };

  const existing = input.existingSkills.length
    ? input.existingSkills
        .map((s) => `- ${s.slug}: ${s.name} — ${s.description}`)
        .join('\n')
    : '（暂无）';

  const client = new OpenAI({
    apiKey: input.model.apiKey,
    baseURL: input.model.baseURL.replace(/\/$/, ''),
  });

  const createUpdateLine =
    (input.createUpdateInstruction ?? '').trim() ||
    DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION;

  const system = [
    '你负责为桌面助手沉淀可复用 Skill。',
    createUpdateLine,
    '一次性闲聊、纯问答、无稳定步骤的内容不要写成 skill。',
    '若已有 skill 覆盖同一场景，应更新该 skill，而不是另起同义 slug。',
    '只输出 JSON，不要 markdown 围栏，不要解释。',
    '无更新时输出：{"action":"none"}',
    '有更新时输出：{"action":"upsert","skill":{"slug":"kebab-case-en-or-pinyin","name":"短名称","description":"何时使用（一句）","body":"Markdown 正文，含 When / Steps"}}',
    'body 用中文，步骤清晰可执行；slug 只用小写字母数字和连字符。',
  ].join('\n');

  const user = [
    `机器人：${input.botName}`,
    '',
    '已有 skills：',
    existing,
    '',
    '最近对话：',
    dialogue,
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

  const skillChoice = completion.choices[0];
  if (skillChoice?.finish_reason === 'length') return { action: 'none' };
  // Strip CoT before JSON parse so think wrappers do not break / pollute skills.
  let raw = stripThinkContent(skillChoice?.message?.content ?? '').trim();
  if (!raw) return { action: 'none' };
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  try {
    const parsed = JSON.parse(raw) as {
      action?: string;
      skill?: Partial<BotSkill>;
    };
    if (parsed.action !== 'upsert' || !parsed.skill) return { action: 'none' };
    let slug = String(parsed.skill.slug || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (slug && !slug.startsWith('okbot-')) slug = `okbot-${slug}`;
    slug = slug.slice(0, 64);
    const name = stripThinkContent(String(parsed.skill.name || slug)).trim();
    const description = stripThinkContent(String(parsed.skill.description || name)).trim();
    const body = stripThinkContent(String(parsed.skill.body || '')).trim();
    if (!slug || !body) return { action: 'none' };
    return {
      action: 'upsert',
      skill: { slug, name, description, body },
    };
  } catch {
    return { action: 'none' };
  }
}

export type MemoryRefreshResult =
  | { action: 'none' }
  | {
      action: 'upsert';
      entries: Array<{ scope: 'global' | 'bot'; memory: string; expires: string | null }>;
    };

/**
 * Extract durable memories: auto-inferred facts + explicit "请记住".
 * Caller writes memory.md (global / bot); next turn reloads into context.
 */
export async function refreshMemories(input: {
  model: ResolvedModelConfig;
  botId: string;
  botName: string;
  existingGlobal: MemoryEntry[];
  existingBot: MemoryEntry[];
  recentMessages: ChatMessage[];
  /** Scope classification line; blank / missing → DEFAULT_MEMORY_SCOPE_INSTRUCTION. */
  scopeInstruction?: string;
  /** Recent user/assistant window; missing / invalid → 20; clamp 1–100. */
  recentMessageLimit?: number;
  signal?: AbortSignal;
}): Promise<MemoryRefreshResult> {
  assertModel(input.model);
  if (input.signal?.aborted) return { action: 'none' };

  const limit = normalizeMaxTurns(
    input.recentMessageLimit,
    DEFAULT_MEMORY_RECENT_MESSAGE_LIMIT,
  );
  const dialogue = input.recentMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-limit)
    .map((m) => {
      const body =
        m.role === 'assistant' ? stripThinkContent(m.content || '') : m.content || '';
      return `${m.role === 'user' ? '用户' : '助手'}: ${body.trim()}`;
    })
    .filter((line) => line.length > 3)
    .join('\n\n');
  if (!dialogue.trim()) return { action: 'none' };

  const existing = [
    ...input.existingGlobal.map((e) => `[global/${e.id}] ${e.memory}`),
    ...input.existingBot.map((e) => `[bot/${e.id}] ${e.memory}`),
  ].join('\n') || '（暂无）';

  const client = new OpenAI({
    apiKey: input.model.apiKey,
    baseURL: input.model.baseURL.replace(/\/$/, ''),
  });

  const scopeLine =
    (input.scopeInstruction ?? '').trim() || DEFAULT_MEMORY_SCOPE_INSTRUCTION;

  const system = [
    '你负责为桌面助手抽取长期记忆。',
    '两类都要写：1) 对话中值得长期记住的稳定事实/偏好；2) 用户明确要求记住的内容。',
    '不要写一次性任务细节、密钥、临时验证码、冗长日志。',
    scopeLine,
    'expires：默认 null；若用户说「记住 N 天」等，给 ISO 时间；否则 null。',
    '与已有记忆重复则不要再输出。',
    '只输出 JSON，不要围栏：{"action":"none"} 或 {"action":"upsert","entries":[{"scope":"global"|"bot","memory":"...","expires":null}]}',
  ].join('\n');

  const user = [
    `当前机器人 id：${input.botId}`,
    `当前机器人名：${input.botName}`,
    '',
    '已有记忆：',
    existing,
    '',
    '最近对话：',
    dialogue,
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

  const memChoice = completion.choices[0];
  if (memChoice?.finish_reason === 'length') return { action: 'none' };
  let raw = stripThinkContent(memChoice?.message?.content ?? '').trim();
  if (!raw) return { action: 'none' };
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  try {
    const parsed = JSON.parse(raw) as {
      action?: string;
      entries?: Array<{ scope?: string; memory?: string; expires?: string | null }>;
    };
    if (parsed.action !== 'upsert' || !Array.isArray(parsed.entries) || !parsed.entries.length) {
      return { action: 'none' };
    }
    const entries: Array<{ scope: 'global' | 'bot'; memory: string; expires: string | null }> = [];
    for (const e of parsed.entries) {
      const memory = stripThinkContent(String(e.memory || '')).trim();
      if (!memory) continue;
      const scope = e.scope === 'global' ? 'global' : 'bot';
      let expires: string | null = null;
      if (e.expires != null && String(e.expires).trim()) {
        const ts = Date.parse(String(e.expires));
        expires = Number.isFinite(ts) ? new Date(ts).toISOString() : null;
      }
      entries.push({ scope, memory, expires });
    }
    if (!entries.length) return { action: 'none' };
    return { action: 'upsert', entries };
  } catch {
    return { action: 'none' };
  }
}
