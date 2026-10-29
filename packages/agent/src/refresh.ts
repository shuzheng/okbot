import OpenAI from 'openai';
import {
  DEFAULT_SOUL_MD_RECENT_MESSAGE_LIMIT,
  DEFAULT_SOUL_MD_REFRESH_SYSTEM_PROMPT,
  DEFAULT_MEMORY_RECENT_MESSAGE_LIMIT,
  DEFAULT_SKILLS_RECENT_MESSAGE_LIMIT,
  clampOwnerDescription,
  sanitizeOwnerDescriptionDuties,
  clampSoulMd,
  isMemoryExpired,
  normalizeMemoryExpires,
  normalizeMaxTurns,
  normalizeMemoryRecentLimit,
  normalizeSkillDescription,
  stripThinkContent,
  type BotSkill,
  type ChatMessage,
  type MemoryEntry,
  type ResolvedModelConfig,
} from '@okbot/shared';
import { assertModel } from './model.js';
import { mergeSoulMdFromModel } from './soulMdPatch.js';
import { ensureOkbotSkillName, normalizeSkillSlug } from './skills/parse.js';
import {
  buildSkillsRefreshSystemPrompt,
  buildMemoryRefreshSystemPrompt,
  buildOwnerDescriptionSystemPrompt,
} from './maintenancePrompts.js';

export {
  buildSkillsRefreshSystemPrompt,
  buildMemoryRefreshSystemPrompt,
  buildOwnerDescriptionSystemPrompt,
} from './maintenancePrompts.js';


/**
 * Silently patch SOUL.md from recent chat. Returns updated markdown, or null if unchanged.
 * Only changed sections are applied; a full-file rewrite is ignored.
 * Caller writes the file; next chat turn reloads from disk.
 */
export async function refreshSoulMd(input: {
  model: ResolvedModelConfig;
  botName: string;
  currentSoulMd: string;
  recentMessages: ChatMessage[];
  /** Full system prompt; blank / missing → DEFAULT_SOUL_MD_REFRESH_SYSTEM_PROMPT. */
  systemPrompt?: string;
  /** Recent user/assistant window; missing / invalid → DEFAULT_SOUL_MD_RECENT_MESSAGE_LIMIT (5); clamp 1–100. */
  recentMessageLimit?: number;
  signal?: AbortSignal;
}): Promise<string | null> {
  assertModel(input.model);
  if (input.signal?.aborted) return null;

  const limit = normalizeMaxTurns(
    input.recentMessageLimit,
    DEFAULT_SOUL_MD_RECENT_MESSAGE_LIMIT,
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
    (input.systemPrompt ?? '').trim() || DEFAULT_SOUL_MD_REFRESH_SYSTEM_PROMPT;

  const user = [
    `助手名称：${input.botName}`,
    '',
    '当前 SOUL.md：',
    input.currentSoulMd.trim() || '（空）',
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

  // Model CoT (<think>…</think>) must never land in SOUL.md.
  const raw = stripThinkContent(choice?.message?.content ?? '').trim();
  if (!raw) return null;
  const merged = mergeSoulMdFromModel(input.currentSoulMd, raw);
  if (!merged) return null;
  const clamped = clampSoulMd(merged);
  if (clamped.trim() === input.currentSoulMd.trim()) return null;
  return clamped;
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
  /** Recent user/assistant window; missing / invalid → maintenance-aligned default; clamp 1–100. */
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

  const system = buildSkillsRefreshSystemPrompt(input.createUpdateInstruction);

  const user = [
    `助手：${input.botName}`,
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
    const slug = normalizeSkillSlug(String(parsed.skill.slug || ''));
    let name = ensureOkbotSkillName(
      stripThinkContent(String(parsed.skill.name || '')).trim(),
      slug,
    );
    if (!name) name = slug;
    const description = normalizeSkillDescription(
      stripThinkContent(String(parsed.skill.description || '')),
      name,
    );
    let body = stripThinkContent(String(parsed.skill.body || '')).trim();
    if (!slug || !body || !description) return { action: 'none' };
    const existing = input.existingSkills.find((s) => s.slug === slug);
    // Missing source → treat as user so hand-written skills are not clobbered.
    const existingSource = existing?.source === 'model' ? 'model' : existing ? 'user' : undefined;
    if (existing && existingSource === 'user' && (existing.body || '').trim()) {
      // Keep user body; model may still refresh description/name.
      body = existing.body.trim();
    }
    return {
      action: 'upsert',
      skill: {
        slug,
        name,
        description,
        body,
        source: existingSource === 'user' ? 'user' : 'model',
      },
    };
  } catch {
    return { action: 'none' };
  }
}

export type MemoryRefreshResult =
  | { action: 'none' }
  | {
      action: 'upsert';
      entries: Array<{
        scope: 'global' | 'bot';
        memory: string;
        expires: string | null;
        /** When set, delete this existing memory id (same scope) before upsert. */
        replaceId?: string;
        tier?: 'candidate' | 'durable';
        pinned?: boolean;
      }>;
    };

/**
 * Extract durable memories: auto-inferred facts + explicit "请记住".
 * Model owns create/skip/merge/quality against the existing list in the prompt.
 * Caller persists returned entries as-is (only empty/whitespace rows are dropped).
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
  /** Recent user/assistant window; missing / invalid → maintenance-aligned default; clamp 1–500. */
  recentMessageLimit?: number;
  signal?: AbortSignal;
}): Promise<MemoryRefreshResult> {
  assertModel(input.model);
  if (input.signal?.aborted) return { action: 'none' };

  const limit = normalizeMemoryRecentLimit(
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

  const fmt = (scope: 'global' | 'bot', e: MemoryEntry) => {
    const tier = e.tier === 'candidate' ? 'candidate' : 'durable';
    const hits = typeof e.hits === 'number' ? e.hits : 0;
    const pin = e.pinned ? ' pinned' : '';
    return `[${scope}/${e.id} tier=${tier} hits=${hits}${pin}] ${e.memory}`;
  };
  const existing = [
    ...input.existingGlobal.map((e) => fmt('global', e)),
    ...input.existingBot.map((e) => fmt('bot', e)),
  ].join('\n') || '（暂无）';

  const client = new OpenAI({
    apiKey: input.model.apiKey,
    baseURL: input.model.baseURL.replace(/\/$/, ''),
  });

  const system = buildMemoryRefreshSystemPrompt(input.scopeInstruction);

  const user = [
    `当前助手 id：${input.botId}`,
    `当前助手名：${input.botName}`,
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
      entries?: Array<{
        scope?: string;
        memory?: string;
        expires?: string | null;
        replaceId?: string;
        mergeInto?: string;
        tier?: string;
        pinned?: boolean;
      }>;
    };
    if (parsed.action !== 'upsert' || !Array.isArray(parsed.entries) || !parsed.entries.length) {
      return { action: 'none' };
    }
    const entries: Array<{
      scope: 'global' | 'bot';
      memory: string;
      expires: string | null;
      replaceId?: string;
      tier?: 'candidate' | 'durable';
      pinned?: boolean;
    }> = [];
    for (const e of parsed.entries) {
      const memory = stripThinkContent(String(e.memory || '')).trim();
      // Storage invariant only: never write empty rows. Quality is the model's job.
      if (!memory) continue;
      const scope = e.scope === 'global' ? 'global' : 'bot';
      const expires = normalizeMemoryExpires(e.expires);
      // Skip already-expired rows (lazy purge would drop them on next load anyway).
      if (isMemoryExpired(expires)) continue;
      const replaceRaw = String(e.replaceId || e.mergeInto || '').trim();
      const replaceId = replaceRaw || undefined;
      const tier = e.tier === 'durable' ? 'durable' : e.tier === 'candidate' ? 'candidate' : undefined;
      const pinned = e.pinned === true ? true : undefined;
      const row: (typeof entries)[number] = { scope, memory, expires };
      if (replaceId) row.replaceId = replaceId;
      if (tier) row.tier = tier;
      if (pinned) row.pinned = true;
      entries.push(row);
    }
    if (!entries.length) return { action: 'none' };
    return { action: 'upsert', entries };
  } catch {
    return { action: 'none' };
  }
}

export type OwnerDescriptionRefreshResult =
  | { action: 'none' }
  | { action: 'upsert'; description: string };

/** Optional seed context when there is no chat yet (post-onboarding). */
export type OwnerDescriptionSeed = {
  scenarioLabel?: string;
  howLabel?: string;
  /** Fresh SOUL.md just written at onboarding (or current on disk). */
  soulMd?: string;
};


function formatOwnerDescriptionSeedBlock(seed: OwnerDescriptionSeed): string {
  const parts: string[] = [];
  const scenario = (seed.scenarioLabel || '').trim();
  const how = (seed.howLabel || '').trim();
  if (scenario) parts.push(`引导场景：${scenario}`);
  if (how) parts.push(`协作方式：${how}`);
  const soul = (seed.soulMd || '').trim();
  if (soul) {
    // Cap so the seed call stays small; identity + first sections are enough.
    const excerpt = soul.length > 1200 ? `${soul.slice(0, 1200)}…` : soul;
    parts.push('SOUL.md（刚写入的个性与边界种子）：');
    parts.push(excerpt);
  }
  return parts.join('\n');
}

/**
 * Silent roster blurb refresh (bot or squad description). Max 200 chars.
 * Caller writes bots.json / squads.json; next turn / UI reload picks it up.
 *
 * Pass `seed` (name already in ownerName) to allow a first fill with no chat yet
 * (post-onboarding). With neither recent dialogue nor seed → none.
 */
export async function refreshOwnerDescription(input: {
  model: ResolvedModelConfig;
  ownerKind: 'bot' | 'squad';
  ownerName: string;
  currentDescription: string;
  recentMessages?: ChatMessage[];
  /** When set, allows refresh with empty chat (onboarding seed). */
  seed?: OwnerDescriptionSeed;
  /** Recent user/assistant window; missing / invalid → DEFAULT_SOUL_MD_RECENT_MESSAGE_LIMIT (5); clamp 1–100. */
  recentMessageLimit?: number;
  signal?: AbortSignal;
}): Promise<OwnerDescriptionRefreshResult> {
  assertModel(input.model);
  if (input.signal?.aborted) return { action: 'none' };

  const limit = normalizeMaxTurns(
    input.recentMessageLimit,
    DEFAULT_SOUL_MD_RECENT_MESSAGE_LIMIT,
  );
  const dialogue = (input.recentMessages || [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-limit)
    .map((m) => {
      const body =
        m.role === 'assistant' ? stripThinkContent(m.content || '') : m.content || '';
      return `${m.role === 'user' ? '用户' : '助手'}: ${body.trim()}`;
    })
    .filter((line) => line.length > 3)
    .join('\n\n');
  const seedBlock = input.seed ? formatOwnerDescriptionSeedBlock(input.seed) : '';
  if (!dialogue.trim() && !seedBlock.trim()) return { action: 'none' };

  const kindLabel = input.ownerKind === 'squad' ? '小队' : '助手';
  const prev = sanitizeOwnerDescriptionDuties(input.currentDescription);
  const forceUpsert = !prev && Boolean(seedBlock.trim());
  const client = new OpenAI({
    apiKey: input.model.apiKey,
    baseURL: input.model.baseURL.replace(/\/$/, ''),
  });

  const system = buildOwnerDescriptionSystemPrompt(kindLabel, { forceUpsert });

  const userParts = [
    `${kindLabel}名称：${input.ownerName}`,
    '',
    '当前简介：',
    prev || '（空）',
  ];
  if (seedBlock.trim()) {
    userParts.push('', '引导 / 种子：', seedBlock);
  }
  if (dialogue.trim()) {
    userParts.push('', '最近对话：', dialogue);
  }
  const user = userParts.join('\n');

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
  if (choice?.finish_reason === 'length') return { action: 'none' };
  let raw = stripThinkContent(choice?.message?.content ?? '').trim();
  if (!raw) return { action: 'none' };
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  try {
    const parsed = JSON.parse(raw) as { action?: string; description?: string };
    if (parsed.action !== 'upsert') return { action: 'none' };
    const description = sanitizeOwnerDescriptionDuties(
      stripThinkContent(String(parsed.description || '')),
    );
    if (!description) return { action: 'none' };
    if (description === prev) return { action: 'none' };
    return { action: 'upsert', description };
  } catch {
    return { action: 'none' };
  }
}

