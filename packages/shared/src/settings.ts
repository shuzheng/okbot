/** App settings schema (client chrome + gateway host), normalize helpers, bots/squads, defaults.
 * Domain slices live in settingsSecurity.ts / settingsComputers.ts / settingsModel.ts /
 * settingsGatewayHttpApi.ts and are re-exported here. */

import type { McpSettings } from './mcp.js';
import type { WebSettings } from './web.js';
import type { AutoApprovalRule } from './approval.js';
import { createId } from './text.js';
import {
  type ToolPreferences,
  DEFAULT_TOOL_PREFERENCES,
} from './toolIds.js';
import {
  type SecuritySettings,
  DEFAULT_SECURITY,
  DEFAULT_DENIED_PATH_PREFIXES,
  DEFAULT_SECURITY_AGENT,
} from './settingsSecurity.js';
import {
  type ComputerEntry,
  LOCAL_COMPUTER_ID,
} from './settingsComputers.js';
import {
  type ModelSettings,
  type ContextCompressionSettings,
  type MeshSettings,
  DEFAULT_CONTEXT_COMPRESSION,
  DEFAULT_MESH_SETTINGS,
} from './settingsModel.js';
import {
  type GatewayHttpApiSettings,
  DEFAULT_GATEWAY_HTTP_API,
} from './settingsGatewayHttpApi.js';

export * from './settingsSecurity.js';
export * from './settingsComputers.js';
export * from './settingsModel.js';
export * from './settingsGatewayHttpApi.js';

// Re-exported via barrel from toolIds.ts (avoid duplicate export * names).

export type ThemeMode = 'system' | 'light' | 'dark';
export type LanguageCode = 'system' | 'zh' | 'en';

/**
 * Window close button behavior (Electron desktop).
 * - `ask`: first close (or until remembered) shows Quit vs tray/hide dialog
 * - `quit`: close quits the app
 * - `tray`: close hides to system tray / macOS menu bar
 *
 * Cmd+Q / tray Quit still request quit; if work is in flight, `before-quit` may
 * move the app to the background instead of exiting immediately.
 */
export type CloseAction = 'ask' | 'quit' | 'tray';

export function normalizeCloseAction(raw: unknown): CloseAction {
  if (raw === 'quit' || raw === 'tray' || raw === 'ask') return raw;
  return 'ask';
}

/** UI / IPC snapshot of one timed wakeup (desktop settings + gateway RPC). */
export type ScheduledJobInfo = {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerKind: 'bot' | 'squad';
  title: string;
  prompt: string;
  enabled: boolean;
  timezone: string;
  /** Human schedule label, e.g. daily 09:00 */
  scheduleLabel: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  once: boolean;
  /** ISO create time (for edit-UI sort newest→oldest). */
  createdAt: string;
};
/**
 * Global squad defaults (`settings.json` → `squad`).
 * Built-in virtual captain uses persona + playbook.
 * Captain/member per-run maxTurns settings were removed; runs use
 * {@link DEFAULT_RUNNER_MAX_TURNS}. Older JSON may still carry
 * `captainMaxTurns` / `memberMaxTurns` — ignored on load.
 */
export interface SquadSettings {
  /** Captain persona / profession instructions (Chinese by default). */
  captainPersona: string;
  /** Collaboration playbook injected into the captain. */
  playbook: string;
}

export const DEFAULT_SQUAD_CAPTAIN_PERSONA = `你是小队的虚拟队长与编排者。你负责理解目标、拆解任务、选择队员、传递上下文、校验结果、汇总结论，并简洁清楚的回复用户。
你的价值在于编排与把关，而不是替队员输出其专业细节。

原则：
1. 目标与约束优先：先确认用户目标、范围、验收标准、格式与限制。
2. 角色边界：只把队员明确回报的内容当作其结论；不编造、不夸大、不把自己的推断伪装成队员结论。
3. 中立务实：不确定时，涉及专业事实先问对应队员；涉及用户偏好、目标或取舍，先问用户。
4. 效率可控：独立且无依赖的子任务应并行调用多名队员；有依赖时再串行；控制轮次、调用次数与成本。
5. 结果负责：最终答复要可执行、可追溯，并说明依据、风险与未尽事项。`;

export const DEFAULT_SQUAD_PLAYBOOK = `0. 准备：读取队员名册、能力边界、工具权限与输出格式；建立任务清单：目标/约束/子任务/负责人/依赖/状态/结果/未决。
1. 澄清：若关键信息缺失且影响结果，先向用户提不超过3个关键问题；否则做最小合理假设并明确标注。
2. 拆解：把目标拆成可执行子任务。每个子任务写明：输入、期望输出、验收标准、依赖、优先级。
3. 路由：按能力选择最合适队员。多个无依赖子任务应在同一轮并行调用对应队员；有依赖时再串行。
   分派时必须携带：总目标、子任务、已知输入、约束、期望格式、验收标准、不要做什么。
4. 校验：队员回报后检查完整性、一致性、事实依据与验收标准。不合格则追问、重试、换人或降级。
5. 冲突：队员结论冲突时，列出来源、证据、假设、置信度，按领域权威、数据新鲜度、可验证性裁决；不能裁决则请用户决定。
6. 汇总：去重、校对、统一术语与格式。最终答复包含：结论/交付物、关键依据、风险与限制、下一步建议。不要暴露冗长内部推理。
7. 异常：队员超时/失败/空结果时，记录原因，尝试一次修复；仍失败则换人或降级，并明确告知用户。
8. 边界：不越权调用工具或访问数据；不泄露隐私与密钥；不把未确认信息写成事实。
9. 队员之间默认不互通，所有跨队员信息由你传递，并标注来源。`;

export const DEFAULT_SQUAD_SETTINGS: SquadSettings = {
  captainPersona: DEFAULT_SQUAD_CAPTAIN_PERSONA,
  playbook: DEFAULT_SQUAD_PLAYBOOK,
};

/**
 * Pre-parallel-star captain persona (exact text). Persisted settings still storing this
 * exact default are upgraded to DEFAULT_SQUAD_CAPTAIN_PERSONA (parallel-first wording).
 */
export const LEGACY_DEFAULT_SQUAD_CAPTAIN_PERSONA = `你是小队的虚拟队长与编排者。你负责理解目标、拆解任务、选择队员、传递上下文、校验结果、汇总结论，并简洁清楚的回复用户。
你的价值在于编排与把关，而不是替队员输出其专业细节。

原则：
1. 目标与约束优先：先确认用户目标、范围、验收标准、格式与限制。
2. 角色边界：只把队员明确回报的内容当作其结论；不编造、不夸大、不把自己的推断伪装成队员结论。
3. 中立务实：不确定时，涉及专业事实先问对应队员；涉及用户偏好、目标或取舍，先问用户。
4. 效率可控：默认串行调用；独立且无依赖的子任务可并行；控制轮次、调用次数与成本。
5. 结果负责：最终答复要可执行、可追溯，并说明依据、风险与未尽事项。`;

/**
 * Pre-parallel-star playbook (exact text). Exact match → upgrade to DEFAULT_SQUAD_PLAYBOOK.
 */
export const LEGACY_DEFAULT_SQUAD_PLAYBOOK = `0. 准备：读取队员名册、能力边界、工具权限与输出格式；建立任务清单：目标/约束/子任务/负责人/依赖/状态/结果/未决。
1. 澄清：若关键信息缺失且影响结果，先向用户提不超过3个关键问题；否则做最小合理假设并明确标注。
2. 拆解：把目标拆成可执行子任务。每个子任务写明：输入、期望输出、验收标准、依赖、优先级。
3. 路由：按能力选择最合适队员。默认一次调用一名队员；若多个子任务无依赖且系统支持并行，可并行。
   分派时必须携带：总目标、子任务、已知输入、约束、期望格式、验收标准、不要做什么。
4. 校验：队员回报后检查完整性、一致性、事实依据与验收标准。不合格则追问、重试、换人或降级。
5. 冲突：队员结论冲突时，列出来源、证据、假设、置信度，按领域权威、数据新鲜度、可验证性裁决；不能裁决则请用户决定。
6. 汇总：去重、校对、统一术语与格式。最终答复包含：结论/交付物、关键依据、风险与限制、下一步建议。不要暴露冗长内部推理。
7. 异常：队员超时/失败/空结果时，记录原因，尝试一次修复；仍失败则换人或降级，并明确告知用户。
8. 边界：不越权调用工具或访问数据；不泄露隐私与密钥；不把未确认信息写成事实。
9. 队员之间默认不互通，所有跨队员信息由你传递，并标注来源。`;

/** Clamp / fill squad settings. Empty / legacy serial-only defaults → parallel-star defaults. */
export function normalizeSquadSettings(raw: unknown): SquadSettings {
  const src =
    raw && typeof raw === 'object' ? (raw as Partial<Record<keyof SquadSettings, unknown>>) : {};
  const personaRaw =
    typeof src.captainPersona === 'string' ? src.captainPersona.trim() : '';
  const playbookRaw = typeof src.playbook === 'string' ? src.playbook.trim() : '';
  const persona =
    !personaRaw || personaRaw === LEGACY_DEFAULT_SQUAD_CAPTAIN_PERSONA ? '' : personaRaw;
  const playbook =
    !playbookRaw || playbookRaw === LEGACY_DEFAULT_SQUAD_PLAYBOOK ? '' : playbookRaw;

  return {
    captainPersona: persona || DEFAULT_SQUAD_CAPTAIN_PERSONA,
    playbook: playbook || DEFAULT_SQUAD_PLAYBOOK,
  };
}

/**
 * Global 1:1 instruction templates (`settings.json` → `instructions`).
 * `{name}` is replaced with botName || 'OkBot' when building the system prompt.
 * Also holds SOUL.md / skills silent-refresh prompt templates (UI under 设置 → 指令).
 * Analysis window sizes follow `settings.maintenance.*EveryTurns` (not separate limit knobs).
 * Older JSON may still carry `soulMdRecentMessageLimit` / `skillsRecentMessageLimit` — ignored on load.
 */
export interface InstructionsSettings {
  /** Opening role sentence for 1:1 assistants. Empty / whitespace → default. */
  assistantRoleTemplate: string;
  /**
   * Full system prompt for refreshSoulMd. Empty → default.
   * Settings JSON key: `soulMdRefreshSystemPrompt` (migrates from legacy `agentsMdRefreshSystemPrompt` on load).
   */
  soulMdRefreshSystemPrompt: string;
  /** The create/update decision line injected into refreshBotSkills system prompt. Empty → default. */
  skillsCreateUpdateInstruction: string;
}

export const DEFAULT_ASSISTANT_ROLE_TEMPLATE =
  '你是「{name}」，一个可使用授权工具在已连接电脑上工作的个人助手。';

/** Exact prior default; persisted copies upgrade to DEFAULT_ASSISTANT_ROLE_TEMPLATE. */
export const LEGACY_DEFAULT_ASSISTANT_ROLE_TEMPLATE =
  '你是「{name}」，一个可使用本机工具的桌面个人助手。';

/**
 * Older AGENTS.md / SOUL.md refresh system prompts (exact text). Persisted settings that
 * still store any of these exact defaults are upgraded to DEFAULT_SOUL_MD_REFRESH_SYSTEM_PROMPT.
 * Bodies keep historical AGENTS.md wording so on-disk custom-or-default matching still works.
 */
export const LEGACY_DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT = [
  '你负责维护桌面助手机器人的 AGENTS.md（系统提示词）。',
  '只写入值得跨会话记住的内容：用户偏好、长期目标、项目路径/技术栈、反复出现的约束。',
  '不要写入一次性任务细节、密钥、冗长日志或与助手无关的闲聊。',
  '保持 Markdown，保留原有章节结构（角色与目标 / 用户偏好 / 项目与环境 / 工作备注），可增删条目。',
  '若无需更新，只输出一行：NO_CHANGE',
  '若需更新，只输出完整的新 AGENTS.md 正文（不要代码围栏，不要解释）。',
].join('\n');

/** Prior default that added the no-absolute-capability-denial clause + NO_CHANGE sentinel. */
export const LEGACY_AGENTS_MD_REFRESH_WITH_VISION_GUARD = [
  '你负责维护桌面助手机器人的 AGENTS.md（系统提示词）。',
  '只写入值得跨会话记住的内容：用户偏好、长期目标、项目路径/技术栈、反复出现的约束。',
  '不要写入一次性任务细节、密钥、冗长日志或与助手无关的闲聊。',
  '不要写入绝对的能力否定（例如「无图像处理能力」「不能看图」「只支持文本」）：视觉取决于当前模型与用户是否附带图片，本机工具列表以系统注入为准，勿在 AGENTS.md 里写死。',
  '保持 Markdown，保留原有章节结构（角色与目标 / 用户偏好 / 项目与环境 / 工作备注），可增删条目。',
  '若无需更新，只输出一行：NO_CHANGE',
  '若需更新，只输出完整的新 AGENTS.md 正文（不要代码围栏，不要解释）。',
].join('\n');

/**
 * Previous default that asked the model to emit a full AGENTS.md replacement.
 * Exact persisted copies upgrade to the section-patch default.
 */
export const LEGACY_AGENTS_MD_REFRESH_FULL_FILE = [
  '你负责维护桌面助手机器人的 AGENTS.md（系统提示词）。',
  '只写入值得跨会话记住的内容：用户偏好、长期目标、项目路径/技术栈、反复出现的约束。',
  '不要写入一次性任务细节、密钥、冗长日志或与助手无关的闲聊。',
  '保持 Markdown，保留原有章节结构（角色与目标 / 用户偏好 / 项目与环境 / 工作备注），可增删条目。',
  '若需更新，只输出完整的新 AGENTS.md 正文（不要代码围栏，不要解释）。否则不要输出任何正文。',
].join('\n');

/** Prior section-patch default that still said「桌面助手机器人」; upgrade to assistant wording. */
export const LEGACY_AGENTS_MD_REFRESH_WITH_ROBOT = [
  '你负责维护桌面助手机器人的 AGENTS.md（系统提示词）。',
  '只写入值得跨会话记住的内容：用户偏好、长期目标、项目路径/技术栈、反复出现的约束。',
  '不要写入一次性任务细节、密钥、冗长日志或与助手无关的闲聊。',
  '不要重写整份文件，不要删除未提到的章节。',
  '只输出有改动的章节。新约定可以追加为新章节。',
  '只输出 JSON，不要代码围栏，不要解释。',
  '无需更新：{"action":"none"}',
  '需要更新：{"action":"patch","sections":[{"heading":"用户偏好","body":"该章节的新正文（Markdown，不含标题行）"}]}',
  'heading 用现有章节名（不要带 #）。只列有变化的章节。',
].join('\n');

/**
 * Pre-SOUL section-patch default (AGENTS.md product name + old section themes).
 * Exact persisted copies upgrade to DEFAULT_SOUL_MD_REFRESH_SYSTEM_PROMPT.
 */
export const LEGACY_AGENTS_MD_REFRESH_SECTION_PATCH = [
  '你负责维护桌面助手的 AGENTS.md（系统提示词）。',
  '只写入值得跨会话记住的内容：用户偏好、长期目标、项目路径/技术栈、反复出现的约束。',
  '不要写入一次性任务细节、密钥、冗长日志或与助手无关的闲聊。',
  '不要重写整份文件，不要删除未提到的章节。',
  '只输出有改动的章节。新约定可以追加为新章节。',
  '只输出 JSON，不要代码围栏，不要解释。',
  '无需更新：{"action":"none"}',
  '需要更新：{"action":"patch","sections":[{"heading":"用户偏好","body":"该章节的新正文（Markdown，不含标题行）"}]}',
  'heading 用现有章节名（不要带 #）。只列有变化的章节。',
].join('\n');

/** Full default system prompt for silent SOUL.md maintenance (section patches only). */
export const DEFAULT_SOUL_MD_REFRESH_SYSTEM_PROMPT = [
  '你负责维护桌面助手的 SOUL.md（个性、边界、语气、约束、安全红线与输入输出习惯）。',
  '只写入跨会话仍成立的内容：个性与边界、语气与表达、长期约束、安全红线、稳定的输入/输出习惯。',
  '不要写入一次性任务细节、密钥、冗长日志或与助手无关的闲聊。',
  '不要重写整份文件，不要删除未提到的章节。',
  '只输出有改动的章节。新约定可以追加为新章节。',
  '合并后全文不超过 2000 字。',
  '只输出 JSON，不要代码围栏，不要解释。',
  '无需更新：{"action":"none"}',
  '需要更新：{"action":"patch","sections":[{"heading":"个性与边界","body":"该章节的新正文（Markdown，不含标题行）"}]}',
  'heading 用现有章节名（不要带 #），常见章节：个性与边界 / 语气与表达 / 约束 / 安全红线 / 输入输出习惯。只列有变化的章节。',
].join('\n');

/**
 * Fallback recent-message window for refreshSoulMd when callers omit the limit.
 * Runtime (post-turn) uses `settings.maintenance.soulEveryTurns` (same default: 5).
 */
export const DEFAULT_SOUL_MD_RECENT_MESSAGE_LIMIT = 5;

/** Default create/update gate line for refreshBotSkills (one system line only). */
export const DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION =
  '仅当对话中出现「固定多步流程」，或同一类事情已做/将做至少两遍时，才新增或更新 skill。技能 slug、name 与文件名均须以 okbot- 为前缀。description 必填（最多 1024 字），描述何时使用此技能；body 按专业技能模版写「何时使用此技能 / 工作原理 / 示例 / 注意事项」。';

/** Exact prior defaults; persisted copies upgrade to DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION. */
export const LEGACY_DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION =
  '仅当对话中出现「固定多步流程」，或同一类事情已做/将做至少两遍时，才新增或更新 skill。技能 slug（目录名）必须以 okbot- 为前缀。';

/** Prior default (okbot- prefix on slug/name/file); upgrade in place. */
export const LEGACY_DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION_V2 =
  '仅当对话中出现「固定多步流程」，或同一类事情已做/将做至少两遍时，才新增或更新 skill。技能slug（目录名）、技能name（名称）和文件name（skill文件名）必须以okbot-为前缀。';

/** Prior default (triggers-only-in-description / body-steps-only); upgrade in place. */
export const LEGACY_DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION_V3 =
  '仅当对话中出现「固定多步流程」，或同一类事情已做/将做至少两遍时，才新增或更新 skill。技能 slug、name 与文件名均须以 okbot- 为前缀。description 写清能力与何时使用（含触发词与「勿用于」），最多 1024 字；触发说明只写在 description，body 只写步骤。';

/**
 * Fixed refreshBotSkills lines: how to write skill.description / body
 * (always injected; not replaced by skillsCreateUpdateInstruction).
 */
export const DEFAULT_SKILLS_DESCRIPTION_FORMAT_INSTRUCTION = [
  '目录布局：skills/<slug>/ 含 SKILL.md（必需），以及可选 scripts/、references/、assets/、README.md；slug / name / 目录名均以 okbot- 开头。',
  'SKILL.md frontmatter：name、description 必填；author / version / tags / license 仅在有实际值时写入。description 最多 1024 字，描述何时使用此技能（第三人称、动词开头，如「从…提取…」/ Extract…）；避免「我能」「你可以」。',
  'body 按此顺序写章节（中文优先）：# <Name> 技能 → ## 何时使用此技能 → ## 工作原理（编号步骤）→ ## 示例 → ## 注意事项。不要单独的「何时不要使用」/ Do NOT use 章节；额外约束放进「注意事项」。',
].join('\n');

/**
 * Fallback recent-message window for refreshBotSkills when callers omit the limit.
 * Runtime uses `settings.maintenance.skillsEveryTurns` (same default: 5).
 */
export const DEFAULT_SKILLS_RECENT_MESSAGE_LIMIT = 5;

export const DEFAULT_INSTRUCTIONS_SETTINGS: InstructionsSettings = {
  assistantRoleTemplate: DEFAULT_ASSISTANT_ROLE_TEMPLATE,
  soulMdRefreshSystemPrompt: DEFAULT_SOUL_MD_REFRESH_SYSTEM_PROMPT,
  skillsCreateUpdateInstruction: DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION,
};

/** Clamp / fill instructions settings. Empty strings → defaults. Leftover limit keys ignored. */
export function normalizeInstructionsSettings(raw: unknown): InstructionsSettings {
  const src =
    raw && typeof raw === 'object'
      ? (raw as Partial<Record<keyof InstructionsSettings, unknown>>)
      : {};
  const templateRaw =
    typeof src.assistantRoleTemplate === 'string' ? src.assistantRoleTemplate.trim() : '';
  const template =
    !templateRaw || templateRaw === LEGACY_DEFAULT_ASSISTANT_ROLE_TEMPLATE ? '' : templateRaw;
  // Prefer new keys; fall back to legacy agentsMd* so custom prompts are not wiped.
  const srcAny = src as Partial<Record<string, unknown>>;
  const soulPromptCandidate =
    typeof srcAny.soulMdRefreshSystemPrompt === 'string'
      ? srcAny.soulMdRefreshSystemPrompt
      : typeof srcAny.agentsMdRefreshSystemPrompt === 'string'
        ? srcAny.agentsMdRefreshSystemPrompt
        : '';
  const soulPromptRaw = soulPromptCandidate.trim();
  // Upgrade exact legacy defaults (pre-vision-guard / vision-guard+NO_CHANGE / pre-SOUL) in place.
  const soulPrompt =
    !soulPromptRaw ||
    soulPromptRaw === LEGACY_DEFAULT_AGENTS_MD_REFRESH_SYSTEM_PROMPT ||
    soulPromptRaw === LEGACY_AGENTS_MD_REFRESH_WITH_VISION_GUARD ||
    soulPromptRaw === LEGACY_AGENTS_MD_REFRESH_FULL_FILE ||
    soulPromptRaw === LEGACY_AGENTS_MD_REFRESH_WITH_ROBOT ||
    soulPromptRaw === LEGACY_AGENTS_MD_REFRESH_SECTION_PATCH
      ? ''
      : soulPromptRaw;
  const skillsInstrRaw =
    typeof src.skillsCreateUpdateInstruction === 'string'
      ? src.skillsCreateUpdateInstruction.trim()
      : '';
  const skillsInstr =
    !skillsInstrRaw ||
    skillsInstrRaw === LEGACY_DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION ||
    skillsInstrRaw === LEGACY_DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION_V2 ||
    skillsInstrRaw === LEGACY_DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION_V3
      ? ''
      : skillsInstrRaw;
  return {
    assistantRoleTemplate: template || DEFAULT_ASSISTANT_ROLE_TEMPLATE,
    soulMdRefreshSystemPrompt: soulPrompt || DEFAULT_SOUL_MD_REFRESH_SYSTEM_PROMPT,
    skillsCreateUpdateInstruction:
      skillsInstr || DEFAULT_SKILLS_CREATE_UPDATE_INSTRUCTION,
  };
}

/** Resolve the 1:1 opening role line from a template + bot display name. */
export function resolveAssistantRoleLine(template: string | undefined | null, botName: string): string {
  const name = (botName || '').trim() || 'OkBot';
  const raw = (template ?? '').trim() || DEFAULT_ASSISTANT_ROLE_TEMPLATE;
  return raw.replaceAll('{name}', name);
}

/**
 * Memory refresh / global memory knobs (`settings.json` → `memory`).
 * `scopeInstruction` is the single line that teaches the model global vs bot scope.
 * Analysis window size follows `settings.maintenance.memoryEveryTurns` (not a separate limit).
 * Older JSON may still carry `recentMessageLimit` — ignored on load.
 */
export interface MemorySettings {
  /** Injected into refreshMemories system prompt as the scope=global vs scope=bot rule line. */
  scopeInstruction: string;
  /** Max memory bullets injected into the system prompt. Default 16; clamp 5–200. */
  promptMaxEntries: number;
  /** Max chars for memory bullets in the system prompt. Default 4000; clamp 500–20000. */
  promptMaxChars: number;
}

export const DEFAULT_MEMORY_SCOPE_INSTRUCTION =
  '默认 scope=bot（本助手记忆）。仅当内容属于：用户身份/称呼、长期习惯与偏好、本机电脑环境、跨助手通用配置，或用户明确要求写入全局记忆时，才用 scope=global；其余一律 scope=bot。拿不准时选 bot。';

/**
 * Fallback recent-message window for refreshMemories when callers omit the limit.
 * Runtime uses `settings.maintenance.memoryEveryTurns` (same default: 2).
 */
export const DEFAULT_MEMORY_RECENT_MESSAGE_LIMIT = 2;

export const DEFAULT_MEMORY_PROMPT_MAX_ENTRIES = 16;
export const DEFAULT_MEMORY_PROMPT_MAX_CHARS = 4_000;

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  scopeInstruction: DEFAULT_MEMORY_SCOPE_INSTRUCTION,
  promptMaxEntries: DEFAULT_MEMORY_PROMPT_MAX_ENTRIES,
  promptMaxChars: DEFAULT_MEMORY_PROMPT_MAX_CHARS,
};

/** Clamp / fill memory settings. Empty scope instruction → default. Leftover recentMessageLimit ignored. */
export function normalizeMemorySettings(raw: unknown): MemorySettings {
  const src =
    raw && typeof raw === 'object'
      ? (raw as Partial<Record<keyof MemorySettings, unknown>>)
      : {};
  const scopeInstruction =
    typeof src.scopeInstruction === 'string' ? src.scopeInstruction.trim() : '';
  // null/'' → defaults (Number(null)===0 would clamp to the floor extremes).
  let promptMaxEntries: number;
  if (src.promptMaxEntries == null || src.promptMaxEntries === '') {
    promptMaxEntries = DEFAULT_MEMORY_PROMPT_MAX_ENTRIES;
  } else if (typeof src.promptMaxEntries === 'string' && !src.promptMaxEntries.trim()) {
    promptMaxEntries = DEFAULT_MEMORY_PROMPT_MAX_ENTRIES;
  } else {
    promptMaxEntries =
      typeof src.promptMaxEntries === 'number' ? src.promptMaxEntries : Number(src.promptMaxEntries);
    if (!Number.isFinite(promptMaxEntries)) promptMaxEntries = DEFAULT_MEMORY_PROMPT_MAX_ENTRIES;
  }
  promptMaxEntries = Math.min(200, Math.max(5, Math.floor(promptMaxEntries)));

  let promptMaxChars: number;
  if (src.promptMaxChars == null || src.promptMaxChars === '') {
    promptMaxChars = DEFAULT_MEMORY_PROMPT_MAX_CHARS;
  } else if (typeof src.promptMaxChars === 'string' && !src.promptMaxChars.trim()) {
    promptMaxChars = DEFAULT_MEMORY_PROMPT_MAX_CHARS;
  } else {
    promptMaxChars =
      typeof src.promptMaxChars === 'number' ? src.promptMaxChars : Number(src.promptMaxChars);
    if (!Number.isFinite(promptMaxChars)) promptMaxChars = DEFAULT_MEMORY_PROMPT_MAX_CHARS;
  }
  promptMaxChars = Math.min(20_000, Math.max(500, Math.floor(promptMaxChars)));

  return {
    scopeInstruction: scopeInstruction || DEFAULT_MEMORY_SCOPE_INSTRUCTION,
    promptMaxEntries,
    promptMaxChars,
  };
}

/**
 * Post-turn silent maintenance throttle (`settings.json` → `maintenance`).
 * SOUL.md / skills still use turn/char gates. Memory always runs post-turn;
 * the LLM decides whether to write (no programmatic every-N / chars gate).
 * The same `*EveryTurns` numbers also size each refresh's recent-message analysis window
 * (SOUL / roster description → soulEveryTurns; skills → skillsEveryTurns; memory → memoryEveryTurns).
 */
export interface MaintenanceSettings {
  /**
   * @deprecated Unused write gate (compat only). Memory refresh runs every successful
   * turn; the model decides create/skip/merge. Still used as the memory analysis window size.
   * Clamp 1–50 if present in settings.json. Default 2.
   */
  memoryEveryTurns: number;
  /**
   * @deprecated Unused write gate (compat only). Not consulted for memory refresh.
   * Clamp 50–20000 if present in settings.json.
   */
  memoryEveryUserChars: number;
  /** SOUL.md refresh every N turns (default 5); also the SOUL/roster analysis window. Clamp 1–50. Settings key migrates from agentsEveryTurns. */
  soulEveryTurns: number;
  /** Or when user chars since last SOUL refresh ≥ this (default 1200). Migrates from agentsEveryUserChars. */
  soulEveryUserChars: number;
  /** Skills refresh every N turns (default 5); also the skills analysis window. Clamp 1–50. */
  skillsEveryTurns: number;
  /** Or when user chars since last skills refresh ≥ this (default 1200). */
  skillsEveryUserChars: number;
}

export const DEFAULT_MAINTENANCE_SETTINGS: MaintenanceSettings = {
  memoryEveryTurns: 2,
  memoryEveryUserChars: 400,
  soulEveryTurns: 5,
  soulEveryUserChars: 1200,
  skillsEveryTurns: 5,
  skillsEveryUserChars: 1200,
};

function clampMaintTurns(raw: unknown, fallback: number): number {
  // null/'' → fallback (Number(null)===0 would wrongly clamp to 1 = every turn).
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'string' && !raw.trim()) return fallback;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

function clampMaintChars(raw: unknown, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'string' && !raw.trim()) return fallback;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(20_000, Math.max(50, Math.floor(n)));
}

export function normalizeMaintenanceSettings(raw: unknown): MaintenanceSettings {
  const src =
    raw && typeof raw === 'object'
      ? (raw as Partial<Record<keyof MaintenanceSettings, unknown>>)
      : {};
  return {
    memoryEveryTurns: clampMaintTurns(src.memoryEveryTurns, DEFAULT_MAINTENANCE_SETTINGS.memoryEveryTurns),
    memoryEveryUserChars: clampMaintChars(
      src.memoryEveryUserChars,
      DEFAULT_MAINTENANCE_SETTINGS.memoryEveryUserChars,
    ),
    soulEveryTurns: clampMaintTurns(
      (src as Partial<Record<string, unknown>>).soulEveryTurns ??
        (src as Partial<Record<string, unknown>>).agentsEveryTurns,
      DEFAULT_MAINTENANCE_SETTINGS.soulEveryTurns,
    ),
    soulEveryUserChars: clampMaintChars(
      (src as Partial<Record<string, unknown>>).soulEveryUserChars ??
        (src as Partial<Record<string, unknown>>).agentsEveryUserChars,
      DEFAULT_MAINTENANCE_SETTINGS.soulEveryUserChars,
    ),
    skillsEveryTurns: clampMaintTurns(src.skillsEveryTurns, DEFAULT_MAINTENANCE_SETTINGS.skillsEveryTurns),
    skillsEveryUserChars: clampMaintChars(
      src.skillsEveryUserChars,
      DEFAULT_MAINTENANCE_SETTINGS.skillsEveryUserChars,
    ),
  };
}

/**
 * User-chosen default assistant (`settings.json` → `defaultAssistantId`).
 * Empty / unknown id → none. Validated against current bot ids when provided.
 */
export function normalizeDefaultAssistantId(
  raw: unknown,
  bots?: ReadonlyArray<{ id: string }> | ReadonlyArray<string>,
): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return '';
  if (!bots) return id;
  for (const b of bots) {
    const bid = typeof b === 'string' ? b : b.id;
    if (bid === id) return id;
  }
  return '';
}

/** True when `tz` is a valid IANA zone for Intl. */
export function isValidIanaTimezone(tz: string): boolean {
  const id = (tz || '').trim();
  if (!id) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: id }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * User timezone preference (`settings.json` → `timezone`).
 * Empty string = auto-detect host local at use time. Invalid → ''.
 */
export function normalizeTimezone(raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id) return '';
  return isValidIanaTimezone(id) ? id : '';
}

/** Host IANA timezone (Intl); falls back to UTC. */
export function detectHostTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Effective app timezone: explicit settings.timezone when valid, else host local.
 */
export function resolveAppTimezone(settingsTimezone: string | undefined | null): string {
  const n = normalizeTimezone(settingsTimezone);
  return n || detectHostTimezone();
}

/** All IANA zones from Intl when available (sorted). */
export function listIanaTimezones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof fn === 'function') {
      const list = fn.call(Intl, 'timeZone');
      if (Array.isArray(list) && list.length) return list.slice().sort((a, b) => a.localeCompare(b));
    }
  } catch {
    /* fall through */
  }
  return ['UTC'];
}

/** Current wall-clock time label in a zone (HH:MM, 24h). */
export function formatTimezoneLocalTime(timeZone: string, now: Date = new Date()): string {
  const tz = normalizeTimezone(timeZone) || detectHostTimezone();
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(now);
  } catch {
    return '';
  }
}

/**
 * Sidebar session pin order (`settings.json` → `pinnedOwnerIds`).
 * Stable array of bot/squad owner ids (first = leftmost). Dedupe; trim empties.
 * When `knownIds` is provided, drop ids not in the current roster.
 */
export function normalizePinnedOwnerIds(
  raw: unknown,
  knownIds?: ReadonlySet<string> | ReadonlyArray<{ id: string }> | ReadonlyArray<string>,
): string[] {
  if (!Array.isArray(raw)) return [];
  let known: Set<string> | null = null;
  if (knownIds) {
    known = new Set<string>();
    if (knownIds instanceof Set) {
      for (const id of knownIds) known.add(id);
    } else {
      for (const b of knownIds) {
        known.add(typeof b === 'string' ? b : b.id);
      }
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    if (known && !known.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Sidebar hidden assistants/squads (`settings.json` → `hiddenOwnerIds`).
 * Same shape as pinnedOwnerIds: stable owner-id list, deduped, optional roster filter.
 */
export function normalizeHiddenOwnerIds(
  raw: unknown,
  knownIds?: ReadonlySet<string> | ReadonlyArray<{ id: string }> | ReadonlyArray<string>,
): string[] {
  return normalizePinnedOwnerIds(raw, knownIds);
}

/** Sentinel id for the virtual default group 「未分组」 (not stored in ownerGroups). */
export const UNGROUPED_OWNER_GROUP_ID = '__ungrouped__';

/** Default name for a newly created custom owner group. */
export const DEFAULT_NEW_OWNER_GROUP_NAME = '新建分组';

/** One custom sidebar group for assistants/squads (`settings.json` → `ownerGroups`). */
export interface OwnerGroup {
  id: string;
  name: string;
}

/**
 * Pick a unique new-group label: `base`, then `base1`, `base2`, … until unused.
 * Compares against existing custom group names (trimmed).
 */
export function allocateUniqueOwnerGroupName(
  existing: ReadonlyArray<OwnerGroup | string>,
  base: string = DEFAULT_NEW_OWNER_GROUP_NAME,
): string {
  const names = new Set<string>();
  for (const item of existing) {
    const n = typeof item === 'string' ? item.trim() : String(item?.name ?? '').trim();
    if (n) names.add(n);
  }
  const root = base.trim() || DEFAULT_NEW_OWNER_GROUP_NAME;
  if (!names.has(root)) return root;
  let n = 1;
  while (names.has(`${root}${n}`)) n += 1;
  return `${root}${n}`;
}

/**
 * Ordered custom owner groups. Does not include the virtual 「未分组」.
 * Dedupe by id; trim empties; cap name length. Unknown / sentinel ids dropped.
 */
export function normalizeOwnerGroups(raw: unknown): OwnerGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: OwnerGroup[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    if (!id || id === UNGROUPED_OWNER_GROUP_ID || seen.has(id)) continue;
    let name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) name = DEFAULT_NEW_OWNER_GROUP_NAME;
    if (name.length > 64) name = name.slice(0, 64);
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

/**
 * ownerId → custom group id. Absent / null / unknown group → 「未分组」.
 * When `groups` is provided, drop memberships whose groupId is not in that list.
 * When `knownIds` is provided, drop owner ids not in the roster.
 */
export function normalizeOwnerGroupMembership(
  raw: unknown,
  groups?: ReadonlyArray<OwnerGroup>,
  knownIds?: ReadonlySet<string> | ReadonlyArray<{ id: string }> | ReadonlyArray<string>,
): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  let known: Set<string> | null = null;
  if (knownIds) {
    known = new Set<string>();
    if (knownIds instanceof Set) {
      for (const id of knownIds) known.add(id);
    } else {
      for (const b of knownIds) {
        known.add(typeof b === 'string' ? b : b.id);
      }
    }
  }
  const groupIds = groups ? new Set(groups.map((g) => g.id)) : null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ownerId = typeof k === 'string' ? k.trim() : '';
    if (!ownerId) continue;
    if (known && !known.has(ownerId)) continue;
    if (typeof v !== 'string') continue;
    const groupId = v.trim();
    if (!groupId || groupId === UNGROUPED_OWNER_GROUP_ID) continue;
    if (groupIds && !groupIds.has(groupId)) continue;
    out[ownerId] = groupId;
  }
  return out;
}

/** Create a stable new custom owner group id. */
export function createOwnerGroupId(): string {
  return createId('ogroup');
}

/**
 * Full sidebar group display order (`settings.json` → `ownerGroupOrder`).
 * Includes custom group ids and {@link UNGROUPED_OWNER_GROUP_ID}.
 * Missing / partial → customs in `groups` order, then 未分组 at the end.
 */
export function normalizeOwnerGroupOrder(
  raw: unknown,
  groups: ReadonlyArray<OwnerGroup> = [],
): string[] {
  const customIds = groups.map((g) => g.id);
  const allowed = new Set<string>([...customIds, UNGROUPED_OWNER_GROUP_ID]);
  const out: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const id = item.trim();
      if (!id || !allowed.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of customIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  if (!seen.has(UNGROUPED_OWNER_GROUP_ID)) {
    out.push(UNGROUPED_OWNER_GROUP_ID);
  }
  return out;
}

/** Default order: custom groups (as given), then 未分组. */
export function defaultOwnerGroupOrder(groups: ReadonlyArray<OwnerGroup>): string[] {
  return [...groups.map((g) => g.id), UNGROUPED_OWNER_GROUP_ID];
}

/** Saved remote sources for the assistant marketplace (public URLs only). */
export type AssistantMarketplaceSettings = {
  /** Newest-first list of GitHub / raw / .okbot URLs the user saved. Max 20. */
  savedSources: string[];
};

const MAX_MARKETPLACE_SOURCES = 20;

export function normalizeAssistantMarketplaceSettings(raw: unknown): AssistantMarketplaceSettings {
  const src =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as { savedSources?: unknown }).savedSources
      : undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(src)) {
    for (const item of src) {
      if (typeof item !== 'string') continue;
      const u = item.trim();
      if (!u || u.length > 2000) continue;
      const key = u.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(u);
      if (out.length >= MAX_MARKETPLACE_SOURCES) break;
    }
  }
  return { savedSources: out };
}

/**
 * Electron / browser chrome prefs — NOT stored in gateway `~/.okbot/server.json`.
 * Desktop: `~/.okbot/client.json` (window bounds nested under `window`); Web: localStorage.
 * Web UI (`isGatewayClient`): `localStorage` (or equivalent).
 */
export const CLIENT_SETTINGS_KEYS = [
  'theme',
  'translucent',
  'language',
  'microphoneId',
  'hardwareAcceleration',
  'autoUpdate',
  'sidebarDockMagnify',
  'closeAction',
  'notifications',
  'developerMode',
  'settingsNavTab',
  'settingsClientGroupExpanded',
  'settingsGatewayGroupExpanded',
] as const;

/** Valid settings sidebar tab ids (client chrome prefs). */
export const SETTINGS_NAV_TABS = [
  'general',
  'gateways',
  'gateway',
  'extensions',
  'tools',
  'security',
  'model',
  'instructions',
  'memory',
  'usage',
  'updates',
] as const;

export type SettingsNavTab = (typeof SETTINGS_NAV_TABS)[number];

const SETTINGS_NAV_TAB_SET: ReadonlySet<string> = new Set(SETTINGS_NAV_TABS);

export function normalizeSettingsNavTab(raw: unknown): SettingsNavTab {
  if (typeof raw === 'string' && SETTINGS_NAV_TAB_SET.has(raw)) {
    return raw as SettingsNavTab;
  }
  // Legacy alias from older deep-links / search.
  if (raw === 'computers') return 'gateway';
  return 'general';
}

export type ClientSettingsKey = (typeof CLIENT_SETTINGS_KEYS)[number];

const CLIENT_SETTINGS_KEY_SET: ReadonlySet<string> = new Set(CLIENT_SETTINGS_KEYS);

export function isClientSettingsKey(key: string): key is ClientSettingsKey {
  return CLIENT_SETTINGS_KEY_SET.has(key);
}

/** UI / shell prefs that stay on the client when switching gateways. */
export interface ClientSettings {
  theme: ThemeMode;
  /**
   * Frost / glass translucency (sidebar vibrancy, drawers, pills, transparent
   * BrowserWindow on darwin). Default true; missing on disk = on.
   */
  translucent: boolean;
  /** UI language. */
  language: LanguageCode;
  /** Empty string = system default microphone. */
  microphoneId: string;
  /** Requires app restart when changed. Default true. */
  hardwareAcceleration: boolean;
  /** When true, check GitHub Releases for updates in the background. Default true. */
  autoUpdate: boolean;
  /**
   * Mac Dock–style icon magnification while the session sidebar is collapsed.
   * Default false (off).
   */
  sidebarDockMagnify: boolean;
  /**
   * What the window close button does (desktop Electron).
   * Default `ask`: first close offers Quit vs minimize/hide to tray; optional remember.
   */
  closeAction: CloseAction;
  /**
   * System notification + unread when the window is not focused and a reply
   * finishes or a tool approval waits. Default true.
   */
  notifications: boolean;
  /**
   * Developer mode: unlocks advanced settings tabs (security / gateway / extensions),
   * model context-compression, bot Advanced (SOUL), copy request URL, view context /
   * usage / trace menus, settings-search filtering, revealAdvanced jump behavior,
   * and the 系统指令 (instructions) tab. Default false. Missing on disk stays off.
   */
  developerMode: boolean;
  /**
   * Last selected Settings sidebar tab (chrome UI). Default `general`.
   * Persisted in client.json so reopen restores the previous panel.
   */
  settingsNavTab: SettingsNavTab;
  /**
   * Whether the Settings 「客户端」 nav group is expanded. Default true.
   */
  settingsClientGroupExpanded: boolean;
  /**
   * Whether the Settings 「网关端」 nav group is expanded. Default false.
   */
  settingsGatewayGroupExpanded: boolean;
}

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = {
  theme: 'system',
  translucent: true,
  language: 'system',
  microphoneId: '',
  hardwareAcceleration: true,
  autoUpdate: true,
  sidebarDockMagnify: false,
  closeAction: 'ask',
  notifications: true,
  developerMode: false,
  settingsNavTab: 'general',
  settingsClientGroupExpanded: true,
  settingsGatewayGroupExpanded: false,
};

/** Clamp / fill client chrome prefs from disk, UI, or migration peel. */
export function normalizeClientSettings(raw: unknown): ClientSettings {
  const src =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Partial<Record<ClientSettingsKey, unknown>>)
      : {};
  const language =
    src.language === 'en' || src.language === 'zh' || src.language === 'system'
      ? src.language
      : 'system';
  const theme =
    src.theme === 'light' || src.theme === 'dark' || src.theme === 'system'
      ? src.theme
      : 'system';
  return {
    theme,
    language,
    microphoneId: typeof src.microphoneId === 'string' ? src.microphoneId : '',
    hardwareAcceleration: src.hardwareAcceleration !== false,
    autoUpdate: src.autoUpdate !== false,
    sidebarDockMagnify: src.sidebarDockMagnify === true,
    translucent: src.translucent !== false,
    developerMode: src.developerMode === true,
    notifications: src.notifications !== false,
    closeAction: normalizeCloseAction(src.closeAction),
    settingsNavTab: normalizeSettingsNavTab(src.settingsNavTab),
    // Missing keys keep historical defaults (client open, gateway collapsed).
    settingsClientGroupExpanded: src.settingsClientGroupExpanded !== false,
    settingsGatewayGroupExpanded: src.settingsGatewayGroupExpanded === true,
  };
}

/** Pick the client chrome subset from a merged AppSettings (or partial). */
export function pickClientSettings(
  raw: Partial<AppSettings> | ClientSettings | Record<string, unknown> | null | undefined,
): ClientSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CLIENT_SETTINGS };
  return normalizeClientSettings(raw);
}

/**
 * Remove client chrome keys from a bag (gateway write / HTTP patch).
 * Returns a shallow copy; does not mutate `raw`.
 */
export function stripClientSettingsKeys<T extends Record<string, unknown>>(
  raw: T,
): Omit<T, ClientSettingsKey> {
  const out = { ...raw } as Record<string, unknown>;
  for (const key of CLIENT_SETTINGS_KEYS) delete out[key];
  return out as Omit<T, ClientSettingsKey>;
}

/**
 * Peel client chrome from a legacy combined `settings.json` object.
 * Returns null when no client keys were present (already slim / empty).
 */
export function peelClientSettingsFromRaw(
  raw: unknown,
): { client: ClientSettings; hadClientKeys: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { client: { ...DEFAULT_CLIENT_SETTINGS }, hadClientKeys: false };
  }
  const src = raw as Record<string, unknown>;
  let hadClientKeys = false;
  for (const key of CLIENT_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, key)) {
      hadClientKeys = true;
      break;
    }
  }
  return { client: normalizeClientSettings(src), hadClientKeys };
}

/**
 * Overlay client chrome onto gateway settings for UI / IPC merged view.
 * Client wins for every {@link CLIENT_SETTINGS_KEYS} field.
 */
export function mergeClientGatewaySettings(
  gateway: AppSettings,
  client: ClientSettings,
): AppSettings {
  const c = normalizeClientSettings(client);
  return {
    ...(gateway as AppSettings),
    theme: c.theme,
    translucent: c.translucent,
    language: c.language,
    microphoneId: c.microphoneId,
    hardwareAcceleration: c.hardwareAcceleration,
    autoUpdate: c.autoUpdate,
    sidebarDockMagnify: c.sidebarDockMagnify,
    closeAction: c.closeAction,
    notifications: c.notifications,
    developerMode: c.developerMode,
    settingsNavTab: c.settingsNavTab,
    settingsClientGroupExpanded: c.settingsClientGroupExpanded,
    settingsGatewayGroupExpanded: c.settingsGatewayGroupExpanded,
  };
}

/**
 * Split a merged AppSettings write into client + gateway halves.
 */
export function splitClientGatewaySettings(settings: AppSettings): {
  client: ClientSettings;
  gateway: AppSettings;
} {
  const client = pickClientSettings(settings);
  // Keep AppSettings shape for SettingsStore.saveSettings, but chrome values are
  // ignored on disk (stripped). Defaults keep the in-memory type complete.
  const gateway: AppSettings = {
    ...settings,
    ...DEFAULT_CLIENT_SETTINGS,
  };
  return { client, gateway };
}

/**
 * Merged UI / IPC view: client chrome + gateway host settings.
 * Persistence is split — see {@link ClientSettings} vs gateway `~/.okbot/server.json`.
 */
export interface AppSettings {
  theme: ThemeMode;
  /** UI language. */
  language: LanguageCode;
  /**
   * Preferred IANA timezone for schedules / time display.
   * Empty string = auto-detect host local at use time.
   */
  timezone: string;
  /** Empty string = system default microphone. */
  microphoneId: string;
  /** Requires app restart when changed. Default true. */
  hardwareAcceleration: boolean;
  /** When true, check GitHub Releases for updates in the background. Default true. */
  autoUpdate: boolean;
  /**
   * Mac Dock–style icon magnification while the session sidebar is collapsed.
   * Default false (off).
   */
  sidebarDockMagnify: boolean;
  /**
   * Frost / glass translucency (sidebar vibrancy, drawers, pills, transparent
   * BrowserWindow on darwin). Default true; missing on disk = on.
   */
  translucent: boolean;
  /**
   * Developer mode: advanced tabs, compression, bot Advanced, debug menus, and
   * 系统指令. Default false. See {@link ClientSettings.developerMode}.
   */
  developerMode: boolean;
  /** Last Settings sidebar tab. See {@link ClientSettings.settingsNavTab}. */
  settingsNavTab: SettingsNavTab;
  /** Settings 「客户端」 group expanded. See {@link ClientSettings.settingsClientGroupExpanded}. */
  settingsClientGroupExpanded: boolean;
  /** Settings 「网关端」 group expanded. See {@link ClientSettings.settingsGatewayGroupExpanded}. */
  settingsGatewayGroupExpanded: boolean;
  /** Master switch for keyword-based auto tool approval. */
  autoApprovalEnabled: boolean;
  autoApprovalRules: AutoApprovalRule[];
  /** Per-tool enable + default approval policy. */
  tools: ToolPreferences;
  /** Local tool path / shell guardrails. */
  security: SecuritySettings;
  model: ModelSettings;
  /** Summary+Buffer compression policy (sibling of model). */
  contextCompression: ContextCompressionSettings;
  /** 1:1 assistant instruction templates (role sentence, etc.). */
  instructions: InstructionsSettings;
  /** Memory refresh scope rule + global memory manager settings. */
  memory: MemorySettings;
  /** Post-turn AGENTS / skills / memory refresh throttle. */
  maintenance: MaintenanceSettings;
  /** Built-in squad captain defaults (persona / playbook). */
  squad: SquadSettings;
  /** 1:1 peer mesh bag (no caps; reserved). Squads ignore this. */
  mesh: MeshSettings;
  /** Gateway HTTP listen settings (port / tokens / LAN / Web UI). Always on when owning. */
  gatewayHttpApi: GatewayHttpApiSettings;
  /**
   * Registered remote cloud computers (sandbox containers).
   * Always-on Local is implicit (`LOCAL_COMPUTER_ID`) and not listed here.
   */
  computers: ComputerEntry[];
  /**
   * Shell/fs computer when the conversation does not name one.
   * `local` or a `computers` id. Missing / unknown normalizes to `local`.
   */
  defaultComputerId: string;
  /**
   * User-chosen default assistant bot id (identity / UI only).
   * Empty string = none. Cleared when that bot is deleted or missing.
   */
  defaultAssistantId: string;
  /**
   * Sidebar pin order for assistants and squads (owner ids).
   * First entry is leftmost in the pin strip. Cleared entries when owners are deleted.
   */
  pinnedOwnerIds: string[];
  /**
   * Hidden assistants/squads (owner ids). Shown only in the bottom collapsed
   * 「已隐藏」 group. Cleared when owners are deleted. Hiding also unpins.
   */
  hiddenOwnerIds: string[];
  /**
   * Custom sidebar groups for assistants/squads (metadata + stable ids).
   * Virtual 「未分组」 is not listed here. Empty → main list stays flat.
   * Display order (including 未分组) is {@link ownerGroupOrder}.
   */
  ownerGroups: OwnerGroup[];
  /**
   * Display order of group headers: custom ids + {@link UNGROUPED_OWNER_GROUP_ID}.
   * Missing → customs then 未分组 (via normalizeOwnerGroupOrder).
   */
  ownerGroupOrder: string[];
  /**
   * ownerId → custom group id. Absent / unknown → 「未分组」.
   * Hidden owners still keep membership but only render under 「已隐藏」.
   */
  ownerGroupMembership: Record<string, string>;
  /**
   * System notification + unread when the window is not focused and a reply
   * finishes or a tool approval waits. Default true.
   */
  notifications: boolean;
  /**
   * What the window close button does (desktop Electron).
   * Default `ask`: first close offers Quit vs minimize/hide to tray; optional remember.
   */
  closeAction: CloseAction;
  /** Optional MCP servers ("advanced extensions"). Default off. */
  mcp: McpSettings;
  /**
   * Built-in web tools: third-party search provider + API key,
   * and web_fetch private-network allow flag.
   */
  web: WebSettings;
  /** Assistant marketplace: saved remote package sources. */
  assistantMarketplace: AssistantMarketplaceSettings;
}

/**
 * Agent / host runtime persisted in each gateway’s `~/.okbot/server.json`.
 * Does not include {@link ClientSettings} chrome keys.
 */
export type GatewaySettings = Omit<AppSettings, ClientSettingsKey>;

/** Max chars for bot/squad roster description (sidebar / gallery blurb). */
export const OWNER_DESCRIPTION_MAX_CHARS = 200;

/** Trim + hard-cap roster description for bots and squads. */
export function clampOwnerDescription(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';
  return s.length <= OWNER_DESCRIPTION_MAX_CHARS
    ? s
    : s.slice(0, OWNER_DESCRIPTION_MAX_CHARS);
}

/**
 * Strip generic product capability / safety boilerplate from roster description.
 * Description is duties + work boundaries for assistant handoff only; tool laundry
 * lists and consent/secrets lines belong in SOUL.md, not bots.json description.
 */
export function sanitizeOwnerDescriptionDuties(raw: unknown): string {
  let s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';
  const cap =
    '(?:查资料|读写(?:本机)?文件|执行命令|生成图片|设定?时(?:提醒|任务)|(?:管理)?定时任务)';
  // Capability laundry lists (file/shell/web/schedule/image — product tools, not duties).
  s = s.replace(
    new RegExp(
      `(?:，|、|；|,|和|与)?(?:也(?:能|可)|并能|并可|可以|能|可|支持)?${cap}(?:(?:，|、|和|与)${cap})*等?`,
      'g',
    ),
    '',
  );
  // English-ish variants sometimes produced by the model.
  s = s.replace(
    /(?:[,;]\s*)?(?:also\s+)?(?:can\s+|supports?\s+)?(?:browse(?:\s+the\s+web)?|read\/?write\s+local\s+files|run\s+shell(?:\s+commands)?|generate\s+images?|set\s+reminders?|schedule\s+tasks?)(?:\s*(?:,|and)\s*(?:browse(?:\s+the\s+web)?|read\/?write\s+local\s+files|run\s+shell(?:\s+commands)?|generate\s+images?|set\s+reminders?|schedule\s+tasks?))*\.?/gi,
    '',
  );
  // Safety boilerplate (destructive-ops consent / secrets) — SOUL.md only.
  s = s.replace(/(?:，|、|；|,)?(?:涉及)?破坏性操作[^。；;!\n]*?(?:征得同意|先问(?:我|你)?)/g, '');
  s = s.replace(/(?:，|、|；|,)?不(?:写入?|传|泄露)[^。；;!\n]*?(?:密钥|令牌|验证码|敏感)[^。；;!\n]*/g, '');
  s = s.replace(/(?:[,;]\s*)?(?:ask\s+before\s+destructive\s+ops?|never\s+(?:write|share|leak)\s+secrets?)[^.;!\n]*/gi, '');
  // Tidy leftover punctuation / empty clauses.
  s = s.replace(/^[，、；,\s]+/g, '').replace(/[，、；,\s]+$/g, '');
  s = s.replace(/[，、]{2,}/g, '，').replace(/\s{2,}/g, ' ');
  s = s.replace(/，([。；;])/g, '$1');
  return clampOwnerDescription(s);
}

/** Max chars for skill frontmatter `description` (Cursor-style). */
export const SKILL_DESCRIPTION_MAX_CHARS = 1024;

/**
 * Soft floor for generated descriptions. Only rejects near-empty crumbs;
 * short Chinese one-liners (e.g. 「导出时用」) still pass.
 */
export const SKILL_DESCRIPTION_MIN_CHARS = 2;

/**
 * Soft-normalize skill description on upsert/write:
 * trim; empty / too-short → fallback; hard-clamp to SKILL_DESCRIPTION_MAX_CHARS.
 */
export function normalizeSkillDescription(raw: unknown, fallback = ''): string {
  let s = typeof raw === 'string' ? raw.trim() : '';
  // Fold newlines / runs of whitespace so YAML frontmatter stays a single scalar.
  s = s.replace(/\s+/g, ' ').trim();
  if (!s || s.length < SKILL_DESCRIPTION_MIN_CHARS) {
    const fb = typeof fallback === 'string' ? fallback.trim().replace(/\s+/g, ' ').trim() : '';
    s = fb;
  }
  if (!s) return '';
  return s.length <= SKILL_DESCRIPTION_MAX_CHARS
    ? s
    : s.slice(0, SKILL_DESCRIPTION_MAX_CHARS);
}

/** Roster row in `~/.okbot/bots.json` (name card only). */
export interface BotRosterEntry {
  id: string;
  name: string;
  description: string;
}

/** How a bot's avatar is rendered in the UI. */
export type BotAvatarKind = 'emoji' | 'bot-avatar';

/**
 * libraries.dev `bot-avatars` body shapes (18).
 * Keep in sync with `botAvatarTypes` from the `bot-avatars` package.
 */
export const BOT_AVATAR_TYPES = [
  'clover',
  'flower',
  'triangle',
  'square',
  'blob',
  'ghost',
  'circle',
  'drop',
  'star',
  'droid',
  'mech',
  'alien',
  'hexagon',
  'cat',
  'cloud',
  'pill',
  'pebble',
  'puddle',
] as const;

export type BotAvatarShape = (typeof BOT_AVATAR_TYPES)[number];

export function normalizeBotAvatarKind(raw: unknown): BotAvatarKind {
  return raw === 'emoji' ? 'emoji' : 'bot-avatar';
}

export function normalizeBotAvatarType(raw: unknown): BotAvatarShape {
  if (typeof raw === 'string' && (BOT_AVATAR_TYPES as readonly string[]).includes(raw)) {
    return raw as BotAvatarShape;
  }
  return 'clover';
}

/** Random body shape for new-bot create (立体头像 default). */
export function randomBotAvatarType(): BotAvatarShape {
  return BOT_AVATAR_TYPES[Math.floor(Math.random() * BOT_AVATAR_TYPES.length)]!;
}

/** Per-bot detail in `~/.okbot/<botId>/bot.json`. */
export interface BotConfig {
  id: string;
  /**
   * Display name dual-written from `bots.json` so a bot folder is self-contained
   * for export/import. List UI still reads the central roster.
   */
  name: string;
  /** Short persona blurb; kept in sync with `bots.json` description. */
  description: string;
  /**
   * Avatar mode. Missing / unknown values normalize to `bot-avatar` on read
   * (early product: no dual-format shim; 立体头像 is the default).
   */
  avatarKind: BotAvatarKind;
  emoji: string;
  /**
   * Accent color: emoji circle fill, or optional body override for bot-avatar.
   * Empty / invalid → 「默认」: library palette when avatarKind is bot-avatar;
   * no colored circle (transparent) when avatarKind is emoji.
   */
  color: string;
  /** Shape when avatarKind === 'bot-avatar'. */
  botAvatarType?: BotAvatarShape;
  createdAt: string;
  updatedAt: string;
  /** False until the model-driven new-assistant onboarding finishes (then never repeats). */
  onboardingComplete: boolean;
  /**
   * Optional model override. Both empty / omitted → global default provider+model at chat time.
   * Across providers the same model id is allowed; resolution uses providerId.
   */
  providerId?: string;
  modelId?: string;
  /** True when an assistant reply finished while this bot session was not selected. */
  hasUnreadReply?: boolean;
  /**
   * When true, selected skills from `~/.agents/skills` are injected alongside bot-local skills.
   * Default false.
   */
  useGlobalSkills: boolean;
  /**
   * Global skill slugs enabled for this bot when `useGlobalSkills` is on.
   * Default []; each switch starts off until the user enables it.
   */
  enabledGlobalSkills: string[];
}

/** One memory row stored as JSONL inside memory.md */
export interface MemoryEntry {
  id: string;
  /** Owning / related bot id (also set for bot-local memories). */
  bot_id: string;
  memory: string;
  /** ISO expiry (UTC), or null/omit for permanent. Missing field on disk = permanent. */
  expires: string | null;
  /** When true, prefer keeping this row in the prompt over unpinned locals. */
  pinned?: boolean;
  /**
   * Two-phase lifecycle: candidate (Phase 1, forgettable / not auto-injected)
   * vs durable (Phase 2). Missing on disk → durable (legacy migration).
   */
  tier?: 'candidate' | 'durable';
  /** Citation / injection hit count for promotion & recall ranking. */
  hits?: number;
  /** ISO time this row was last selected for prompt injection. */
  lastHitAt?: string | null;
  /** ISO create time (decay anchor). Missing → unknown age (no auto-demote). */
  createdAt?: string | null;
}

export type BotSkillSource = 'user' | 'model';

export interface BotSkill {
  /** Directory name under skills/, kebab-case with okbot- prefix. */
  slug: string;
  name: string;
  /**
   * When to use this skill (frontmatter). Required; max SKILL_DESCRIPTION_MAX_CHARS.
   * Catalog progressive disclosure reads this field.
   */
  description: string;
  /**
   * SKILL.md body: H1 + 何时使用此技能 / 工作原理 / 示例 / 注意事项 (in that order).
   * No dedicated do-not-use section — put caveats under 注意事项.
   */
  body: string;
  /**
   * Who last authored the body. Missing on disk → treat as `user` so model refresh
   * does not silently overwrite hand-written skills.
   */
  source?: BotSkillSource;
}

/** Runtime bot = roster + config (+ ephemeral UI fields). */
export interface Bot extends BotRosterEntry, BotConfig {
  /**
   * Latest assistant reply preview for the sidebar (not persisted).
   * Empty when the session has no assistant messages yet.
   */
  lastReplyPreview?: string;
}

/** One member seat inside a squad (assistant id only; no per-seat role). */
export interface SquadMember {
  botId: string;
}

/**
 * Speaker id for built-in virtual captain bubbles in squad transcripts.
 * Not a real bot id — UI uses the squad composite avatar.
 */
export const SQUAD_CAPTAIN_SPEAKER_ID = '__captain__';

/**
 * Squad (小队): star topology, Agents-as-Tools.
 * Captain is a built-in virtual orchestrator (not a roster bot); members are asTool.
 */
export interface Squad {
  id: string;
  name: string;
  description: string;
  members: SquadMember[];
  /**
   * Optional model override. Both empty / omitted → global default at chat time.
   */
  providerId?: string;
  modelId?: string;
  createdAt: string;
  updatedAt: string;
  /** Latest assistant reply preview for the sidebar (not persisted). */
  lastReplyPreview?: string;
  /** True when a squad reply finished while this session was not selected. */
  hasUnreadReply?: boolean;
}

/**
 * Per-squad profile in `~/.okbot/<squadId>/squad.json` (name card dual-write).
 * List UI still reads central `squads.json`; this file stays synced for folder export.
 */
export interface SquadConfig {
  id: string;
  name: string;
  description: string;
}

export interface CreateSquadInput {
  name: string;
  description?: string;
  members: SquadMember[];
  providerId?: string;
  modelId?: string;
}

/** Normalize one squad from disk; drops legacy leaderBotId / captainBotId / guidance. */
export function normalizeSquad(raw: unknown): Squad | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const id = typeof src.id === 'string' ? src.id.trim() : '';
  if (!id) return null;
  const name =
    typeof src.name === 'string' && src.name.trim() ? src.name.trim() : '未命名小队';
  const description = typeof src.description === 'string' ? src.description.trim() : '';
  const membersRaw = Array.isArray(src.members) ? src.members : [];
  const seen = new Set<string>();
  const members: SquadMember[] = [];
  for (const item of membersRaw) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const botId = typeof m.botId === 'string' ? m.botId.trim() : '';
    if (!botId || seen.has(botId)) continue;
    seen.add(botId);
    // Legacy `role` on disk is ignored (forward write omits it).
    members.push({ botId });
  }
  const modelIdRaw = typeof src.modelId === 'string' ? src.modelId.trim() : '';
  const providerIdRaw = typeof src.providerId === 'string' ? src.providerId.trim() : '';
  const createdAt =
    typeof src.createdAt === 'string' && src.createdAt ? src.createdAt : new Date().toISOString();
  const updatedAt =
    typeof src.updatedAt === 'string' && src.updatedAt ? src.updatedAt : createdAt;
  const out: Squad = {
    id,
    name,
    description,
    members,
    createdAt,
    updatedAt,
  };
  // Keep raw fields; FileStorage rewrites legacy modelId-only via resolveModelRef on load.
  if (providerIdRaw) out.providerId = providerIdRaw;
  if (modelIdRaw) out.modelId = modelIdRaw;
  if (src.hasUnreadReply === true) out.hasUnreadReply = true;
  return out;
}

/** Hard cap for per-bot SOUL.md (write + post-refresh merge). */
export const SOUL_MD_MAX_CHARS = 2000;

/** Trim + hard-cap SOUL.md body. */
export function clampSoulMd(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+$/u, '') : '';
  if (!s) return '';
  if (s.length <= SOUL_MD_MAX_CHARS) {
    return s.endsWith('\n') ? s : `${s}\n`;
  }
  const sliced = s.slice(0, SOUL_MD_MAX_CHARS);
  return sliced.endsWith('\n') ? sliced : `${sliced}\n`;
}

export const DEFAULT_SOUL_MD = `# 个性与边界

你是用户的本机个人助手。保持清晰、可靠、有分寸的协作风格；在能力范围内主动帮忙，越界或不确定时先说明。

# 语气与表达

- 简洁清楚；不确定时先说明假设再行动

# 约束

- （随对话自动补充长期约定）

# 安全红线

- 涉及破坏性操作（删除、覆盖、推送、安装）前先征得同意
- 不写入或泄露密钥、令牌、验证码

# 输入输出习惯

- （随对话自动补充偏好的格式与交互方式）
`;


export const DEFAULT_SETTINGS: AppSettings = {
  notifications: true,
  closeAction: 'ask',
  mcp: { enabled: false, servers: [] },
  web: {
    search: { provider: 'tavily', apiKey: '', baseURL: '', compat: 'tavily' },
    fetch: { allowPrivateNetwork: false },
  },
  assistantMarketplace: { savedSources: [] },
  theme: 'system',
  language: 'system',
  timezone: '',
  microphoneId: '',
  hardwareAcceleration: true,
  autoUpdate: true,
  sidebarDockMagnify: false,
  translucent: true,
  developerMode: false,
  settingsNavTab: 'general',
  settingsClientGroupExpanded: true,
  settingsGatewayGroupExpanded: false,
  autoApprovalEnabled: false,
  autoApprovalRules: [],
  tools: {
    run_shell: { ...DEFAULT_TOOL_PREFERENCES.run_shell },
    read_file: { ...DEFAULT_TOOL_PREFERENCES.read_file },
    read_skill: { ...DEFAULT_TOOL_PREFERENCES.read_skill },
    write_file: { ...DEFAULT_TOOL_PREFERENCES.write_file },
    edit_file: { ...DEFAULT_TOOL_PREFERENCES.edit_file },
    generate_image: { ...DEFAULT_TOOL_PREFERENCES.generate_image },
    search_history: { ...DEFAULT_TOOL_PREFERENCES.search_history },
    manage_schedule: { ...DEFAULT_TOOL_PREFERENCES.manage_schedule },
    manage_task_progress: { ...DEFAULT_TOOL_PREFERENCES.manage_task_progress },
    manage_memory: { ...DEFAULT_TOOL_PREFERENCES.manage_memory },
    send_message: { ...DEFAULT_TOOL_PREFERENCES.send_message },
    web_fetch: { ...DEFAULT_TOOL_PREFERENCES.web_fetch },
    web_search: { ...DEFAULT_TOOL_PREFERENCES.web_search },
  },
  security: { ...DEFAULT_SECURITY, deniedPathPrefixes: [...DEFAULT_DENIED_PATH_PREFIXES], allowedPathPrefixes: [], agent: { ...DEFAULT_SECURITY_AGENT } },
  model: {
    providers: [],
    defaultProviderId: '',
    defaultModelId: '',
  },
  contextCompression: { ...DEFAULT_CONTEXT_COMPRESSION },
  instructions: { ...DEFAULT_INSTRUCTIONS_SETTINGS },
  memory: { ...DEFAULT_MEMORY_SETTINGS },
  maintenance: { ...DEFAULT_MAINTENANCE_SETTINGS },
  squad: { ...DEFAULT_SQUAD_SETTINGS },
  mesh: { ...DEFAULT_MESH_SETTINGS },
  gatewayHttpApi: { ...DEFAULT_GATEWAY_HTTP_API, token: '' },
  computers: [],
  defaultComputerId: LOCAL_COMPUTER_ID,
  defaultAssistantId: '',
  pinnedOwnerIds: [],
  hiddenOwnerIds: [],
  ownerGroups: [],
  ownerGroupOrder: [UNGROUPED_OWNER_GROUP_ID],
  ownerGroupMembership: {},
};

export const EMOJI_PRESETS = [
  '🤖', '👑', '💻', '✍️', '📊', '🔍', '💼', '🌐',
  '🛠️', '📚', '📝', '🎨', '🧠', '📅', '💡', '⚡', '🎯',
] as const;

/** Preset accent colors for flattened emoji avatars. */
export const AVATAR_COLORS = [
  '#F97316',
  '#EF4444',
  '#EC4899',
  '#A855F7',
  '#6366F1',
  '#3B82F6',
  '#06B6D4',
  '#14B8A6',
  '#22C55E',
  '#84CC16',
  '#EAB308',
  '#A1A1AA',
  '#FFFFFF',
] as const;

export function defaultAvatarColor(seed = ''): string {
  if (!seed) return AVATAR_COLORS[4];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
