/**
 * Browser-safe maintenance / refresh system prompts (no OpenAI client / fs).
 * refresh.ts calls these when talking to the model; developer-mode catalog imports here.
 */

import {
  DEFAULT_MEMORY_SCOPE_INSTRUCTION,
  DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION,
  DEFAULT_SKILLS_DESCRIPTION_FORMAT_INSTRUCTION,
  MEMORY_EXPIRES_INSTRUCTION_LINES,
} from '@okbot/shared';

/**
 * Hardcoded wrapper around the editable skills create/update line.
 * Used by refreshBotSkills and the developer-mode 系统指令 catalog.
 */
export function buildSkillsRefreshSystemPrompt(createUpdateInstruction?: string): string {
  const createUpdateLine =
    (createUpdateInstruction ?? '').trim() || DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION;
  return [
    '你负责为桌面助手沉淀可复用 Skill。',
    createUpdateLine,
    DEFAULT_SKILLS_DESCRIPTION_FORMAT_INSTRUCTION,
    '一次性闲聊、纯问答、无稳定步骤的内容不要写成 skill。',
    '若已有 skill 覆盖同一场景，应更新该 skill，而不是另起同义 slug。',
    '只输出 JSON，不要 markdown 围栏，不要解释。',
    '无更新时输出：{"action":"none"}',
    '有更新时输出：{"action":"upsert","skill":{"slug":"okbot-kebab-case","name":"okbot-kebab-case","description":"从…提取…（描述何时使用）。","body":"# Okbot-kebab-case 技能\n\n## 何时使用此技能\n当需要…时使用此技能。\n\n## 工作原理\n1. …\n2. …\n\n## 示例\n…\n\n## 注意事项\n…"}}',
    'slug / name 均须以 okbot- 开头，只用小写字母数字和连字符；技能落盘为 skills/<slug>/SKILL.md。',
  ].join('\n');
}

/**
 * Hardcoded wrapper around the editable memory scope line.
 * Used by refreshMemories and the developer-mode 系统指令 catalog.
 */
export function buildMemoryRefreshSystemPrompt(scopeInstruction?: string): string {
  const scopeLine =
    (scopeInstruction ?? '').trim() || DEFAULT_MEMORY_SCOPE_INSTRUCTION;
  return [
    '你负责为桌面助手抽取长期记忆（两阶段：候选 → 耐久）。',
    '是否写入、写什么、质量与去重/合并，全部由你决定；程序会原样持久化你返回的非空 entries，不做长度/碎屑/工具名等质量过滤，也不做字符串包含去重。',
    '两类都要写：1) 对话中值得长期记住的稳定事实/偏好；2) 用户明确要求记住的内容（如「记住」「别忘了」「remember」）。',
    '每条 memory 必须是完整、可独立理解的持久事实（含对象与偏好/约定，例如「用户偏好中文回复」）。',
    '禁止只写单词、裸 UI 标签、单独工具名、任务碎屑（如「删除」「定时任务」「设置」「web_search」）。',
    '不要写一次性任务细节、密钥、临时验证码、冗长日志；敏感值请改写为脱敏描述。',
    'tier：默认 candidate（候选，默认不注入提示词，可遗忘）；用户明确要求记住、或极其稳定的身份/偏好 → durable；需要置顶常驻 → pinned=true（同时视为 durable）。',
    'pin/forget 请用 manage_memory 工具；本抽取接口只负责 upsert 候选/耐久事实。',
    scopeLine,
    ...MEMORY_EXPIRES_INSTRUCTION_LINES,
    '对照「已有记忆」（标注 tier/hits/pinned）：完全重复或已被覆盖则不要再输出；若需合并成更完整的一条，输出合并后的新条目并带上 replaceId（已有记忆的 id，见 [global/id] / [bot/id]）。',
    '无新内容时输出 {"action":"none"}。',
    '只输出 JSON，不要围栏：{"action":"none"} 或 {"action":"upsert","entries":[{"scope":"global"|"bot","memory":"...","expires":null,"tier":"candidate"|"durable","pinned":false,"replaceId":"mem_xxx?"}]}',
  ].join('\n');
}


/**
 * System rules for roster description: duties / work boundaries for handoff only.
 * Shared by post-turn refresh and post-onboarding seed.
 */
export function buildOwnerDescriptionSystemPrompt(kindLabel: string, opts?: { forceUpsert?: boolean }): string {
  const lines = [
    `你负责维护桌面${kindLabel}的对外简介（花名册 description）。`,
    '写成一句或两句短介绍：职责与工作边界——这个助手/小队做什么、不做什么，方便其他助手判断是否应把任务转交给它。',
    '只写职责与边界；不要写产品通用能力或安全套话。',
    '禁止写入例如：也可查资料、读写本机文件、执行命令、设定时提醒、生成图片；涉及删除/覆盖/推送/安装等破坏性操作前先征得同意；不写、不传密钥和验证码等敏感信息。这些属于 SOUL.md（约束/安全），不属于 description。',
    '不要写密钥、一次性任务细节、冗长列表或聊天记录摘要。',
    '只输出 JSON，不要 markdown 围栏，不要解释。',
  ];
  if (opts?.forceUpsert) {
    lines.push('当前简介为空或仅有引导信息：必须输出 upsert，根据名称与引导写一句职责边界简介。');
    lines.push('需要写入：{"action":"upsert","description":"……"}');
  } else {
    lines.push('根据最近对话演进简介；若现有简介仍准确则不要改。');
    lines.push('无更新：{"action":"none"}');
    lines.push('需要更新：{"action":"upsert","description":"……"}');
  }
  lines.push('description 纯文本，最多 200 字（含标点），中文优先。');
  return lines.join('\n');
}

