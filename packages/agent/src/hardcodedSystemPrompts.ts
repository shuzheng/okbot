/**
 * Catalog of hardcoded LLM-facing system / instruction prompts for the
 * developer-mode 「系统指令」 panel (read-only). Editable settings (assistant
 * role, SOUL refresh, memory scope line, skills create/update, squad) live in
 * InstructionsSettingsPanel's other sub-tabs — this list only covers code-fixed
 * prompts so developers can inspect the full surface without hunting the repo.
 *
 * Browser-safe leaf: only imports prompt modules with zero Node / OpenAI /
 * @openai/agents deps so the Electron renderer can load this catalog without
 * pulling guardrails/fs/os into Vite.
 */

import { CONTEXT_SUMMARY_MAX_CHARS } from '@okbot/shared';
import {
  buildCompressHandoffSystemPrompt,
  buildCompressHandoffUserPrompt,
} from './compressHandoffPrompt.js';
import {
  MESH_USER_FACING_REPLY_RULE,
  MID_RUN_USER_INPUT_INSTRUCTION,
  REPLY_STYLE_INSTRUCTION,
  SEND_MESSAGE_INSTRUCTION,
  TASK_PROGRESS_INSTRUCTION,
  TASK_PROGRESS_UNFINISHED_SYNC,
  USER_FACING_PRODUCT_LANGUAGE_RULE,
  formatSessionSummarySection,
} from './instructionPrompts.js';
import {
  buildMemoryRefreshSystemPrompt,
  buildOwnerDescriptionSystemPrompt,
  buildSkillsRefreshSystemPrompt,
} from './maintenancePrompts.js';
import { buildOnboardingInstruction, onboardingSeedText } from './onboardingPrompt.js';
import {
  buildTopicChangeSystemPrompt,
  buildTopicChangeUserPrompt,
} from './topicChangePrompt.js';
import { VISION_TURN_INSTRUCTION } from './visionTurnPrompt.js';

export type HardcodedSystemPromptCategory =
  | 'compression'
  | 'topic'
  | 'agent'
  | 'maintenance'
  | 'onboarding'
  | 'vision';

export type HardcodedSystemPromptEntry = {
  /** Stable id for settings search / data-settings-id. */
  id: string;
  category: HardcodedSystemPromptCategory;
  /** Chinese label (UI primary). */
  titleZh: string;
  /** English label. */
  titleEn: string;
  /** Short hint shown under the title. */
  hintZh: string;
  hintEn: string;
  /** Source module path relative to packages/agent/src. */
  source: string;
  /** Prompt body as sent (or a representative default when parameterized). */
  body: string;
};

/** Representative sample for compress / topic user templates. */
const SAMPLE_HANDOFF_PREVIOUS = '目标：\n无\n约定：\n无\n路径/命令：\n无\n未完成：\n无\n其他：\n无';
const SAMPLE_HANDOFF_DIALOGUE = '用户: （示例）继续做上一件事\n助手: （示例）好的';

/**
 * All hardcoded system / instruction prompts exposed in developer mode.
 * Order is intentional: compression first (user ask), then related classifiers,
 * then always-on agent rules, maintenance refreshes, onboarding, vision.
 */
export function listHardcodedSystemPrompts(): HardcodedSystemPromptEntry[] {
  const summaryMax = CONTEXT_SUMMARY_MAX_CHARS;
  return [
    {
      id: 'compressHandoffSystem',
      category: 'compression',
      titleZh: '上下文压缩 · 交接文档（system）',
      titleEn: 'Context compression · handoff (system)',
      hintZh: `Summary+Buffer 压缩模型的系统提示；字数上限取当前默认 ${summaryMax}。`,
      hintEn: `System prompt for the Summary+Buffer compress model; uses default max chars ${summaryMax}.`,
      source: 'compressHandoffPrompt.ts',
      body: buildCompressHandoffSystemPrompt(summaryMax),
    },
    {
      id: 'compressHandoffUser',
      category: 'compression',
      titleZh: '上下文压缩 · 交接文档（user 模板）',
      titleEn: 'Context compression · handoff (user template)',
      hintZh: '旧交接文档 + 新掉出窗口的对话增量；下列为示意样例。',
      hintEn: 'Prior handoff + dropped-out dialogue delta; sample values below.',
      source: 'compressHandoffPrompt.ts',
      body: buildCompressHandoffUserPrompt(SAMPLE_HANDOFF_PREVIOUS, SAMPLE_HANDOFF_DIALOGUE),
    },
    {
      id: 'topicChangeSystem',
      category: 'topic',
      titleZh: '换题判定（system）',
      titleEn: 'Topic-change classifier (system)',
      hintZh: '发送时若开启「换题自动压缩」，用于判断是否新话题。',
      hintEn: 'Used when auto-compress-on-topic-change is on.',
      source: 'topicChangePrompt.ts',
      body: buildTopicChangeSystemPrompt(),
    },
    {
      id: 'topicChangeUser',
      category: 'topic',
      titleZh: '换题判定（user 模板）',
      titleEn: 'Topic-change classifier (user template)',
      hintZh: '交接文档 + 近期对话 + 新用户消息；下列为示意样例。',
      hintEn: 'Handoff + recent turns + new user text; sample below.',
      source: 'topicChangePrompt.ts',
      body: buildTopicChangeUserPrompt({
        summary: '（示例交接文档）',
        recentDialogue: '用户: （示例近期）\n助手: （示例）',
        newUserText: '（示例新消息）',
      }),
    },
    {
      id: 'sessionSummarySection',
      category: 'compression',
      titleZh: '会话交接文档注入段',
      titleEn: 'Session handoff injection section',
      hintZh: '注入到 1:1 / 队长系统提示的「更早对话交接文档」小节（示意）。',
      hintEn: 'Section injected into 1:1 / captain system prompts (sample).',
      source: 'instructions.ts',
      body: formatSessionSummarySection('（示例交接正文）'),
    },
    {
      id: 'replyStyle',
      category: 'agent',
      titleZh: '回复文风',
      titleEn: 'Reply style',
      hintZh: '每轮助手回复的写作约束。',
      hintEn: 'Writing constraints on every assistant turn.',
      source: 'instructions.ts',
      body: REPLY_STYLE_INSTRUCTION,
    },
    {
      id: 'userFacingProductLanguage',
      category: 'agent',
      titleZh: '对用户产品语言',
      titleEn: 'User-facing product language',
      hintZh: '可见气泡禁止工具名 / 内部路径 / 编排术语。',
      hintEn: 'Visible bubbles must stay in product language.',
      source: 'instructions.ts',
      body: USER_FACING_PRODUCT_LANGUAGE_RULE,
    },
    {
      id: 'meshUserFacingReply',
      category: 'agent',
      titleZh: '互聊对用户表述',
      titleEn: 'Mesh user-facing reply rule',
      hintZh: '有伙伴互聊时，对用户不暴露协作协议。',
      hintEn: 'When mesh peer-ask is on, do not leak coordination protocol.',
      source: 'instructions.ts',
      body: MESH_USER_FACING_REPLY_RULE,
    },
    {
      id: 'sendMessageInstruction',
      category: 'agent',
      titleZh: '多气泡 send_message',
      titleEn: 'send_message multi-bubble',
      hintZh: '启用 send_message 时注入的进度/确认规则。',
      hintEn: 'Injected when send_message is enabled.',
      source: 'instructions.ts',
      body: SEND_MESSAGE_INSTRUCTION,
    },
    {
      id: 'taskProgressInstruction',
      category: 'agent',
      titleZh: '任务进度 manage_task_progress',
      titleEn: 'manage_task_progress',
      hintZh: '启用任务进度工具时注入。',
      hintEn: 'Injected when manage_task_progress is enabled.',
      source: 'instructions.ts',
      body: TASK_PROGRESS_INSTRUCTION,
    },
    {
      id: 'taskProgressUnfinishedSync',
      category: 'agent',
      titleZh: '未完成任务强制同步',
      titleEn: 'Unfinished-task sync',
      hintZh: '系统提示已注入「当前任务」且仍有待办时追加。',
      hintEn: 'Appended when unfinished tasks are already in the prompt.',
      source: 'instructions.ts',
      body: TASK_PROGRESS_UNFINISHED_SYNC,
    },
    {
      id: 'midRunUserInput',
      category: 'agent',
      titleZh: '运行中用户追加输入',
      titleEn: 'Mid-run user input',
      hintZh: '软接管 / 追加消息时的协调规则。',
      hintEn: 'Coordination when user messages arrive mid-run.',
      source: 'instructions.ts',
      body: MID_RUN_USER_INPUT_INSTRUCTION,
    },
    {
      id: 'skillsRefreshSystem',
      category: 'maintenance',
      titleZh: '技能沉淀（完整 system，默认）',
      titleEn: 'Skills refresh (full system, defaults)',
      hintZh: '含可编辑的「创建/更新」行；此处展示默认拼装全文。',
      hintEn: 'Includes the editable create/update line; shows default assembly.',
      source: 'refresh.ts',
      body: buildSkillsRefreshSystemPrompt(),
    },
    {
      id: 'memoryRefreshSystem',
      category: 'maintenance',
      titleZh: '记忆抽取（完整 system，默认）',
      titleEn: 'Memory refresh (full system, defaults)',
      hintZh: '含可编辑的 scope 行与 expires 规则；此处展示默认拼装全文。',
      hintEn: 'Includes editable scope line + expires rules; default assembly.',
      source: 'refresh.ts',
      body: buildMemoryRefreshSystemPrompt(),
    },
    {
      id: 'ownerDescriptionSystem',
      category: 'maintenance',
      titleZh: '花名册简介维护',
      titleEn: 'Owner description refresh',
      hintZh: '助手/小队对外 description 静默刷新。',
      hintEn: 'Silent roster blurb refresh for bot/squad description.',
      source: 'refresh.ts',
      body: buildOwnerDescriptionSystemPrompt('助手'),
    },
    {
      id: 'onboardingInstruction',
      category: 'onboarding',
      titleZh: '新助手引导',
      titleEn: 'New-assistant onboarding',
      hintZh: 'onboardingComplete === false 时注入。',
      hintEn: 'Injected while onboardingComplete === false.',
      source: 'onboarding.ts',
      body: buildOnboardingInstruction('zh'),
    },
    {
      id: 'onboardingSeed',
      category: 'onboarding',
      titleZh: '新助手引导种子（隐藏用户行）',
      titleEn: 'Onboarding seed (hidden user row)',
      hintZh: '开启引导对话的隐藏种子，不进可见 transcript。',
      hintEn: 'Hidden seed that starts onboarding; not shown in transcript.',
      source: 'onboarding.ts',
      body: onboardingSeedText('zh'),
    },
    {
      id: 'visionTurn',
      category: 'vision',
      titleZh: '本回合视觉输入',
      titleEn: 'Vision turn instruction',
      hintZh: '用户消息附带图片时注入，覆盖「不能看图」类表述。',
      hintEn: 'Injected when the turn has image parts.',
      source: 'visionInput.ts',
      body: VISION_TURN_INSTRUCTION,
    },
  ];
}
