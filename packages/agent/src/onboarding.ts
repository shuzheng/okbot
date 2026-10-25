import { tool } from '@openai/agents';
import { z } from 'zod';
import {
  OWNER_DESCRIPTION_MAX_CHARS,
  QUICK_CHOICE_MAX_OPTIONS,
  SOUL_MD_MAX_CHARS,
  normalizeQuickChoice,
  type QuickChoice,
} from '@okbot/shared';

/** Tool the model calls to show a quick-choice card under its reply. */
export const ASK_CHOICE_TOOL_NAME = 'ask_choice';

/** Tool the model calls during new-assistant onboarding to save its own profile. */
export const ONBOARDING_PROFILE_TOOL_NAME = 'save_assistant_profile';

/** What the model may save during onboarding (all optional). */
export type OnboardingProfileUpdate = {
  description?: string | null;
  soul?: string | null;
  done?: boolean | null;
};

/** Host persists the update and returns a short status line for the model. */
export type OnboardingProfileApply = (update: OnboardingProfileUpdate) => Promise<string> | string;

/** Host attaches the card to this turn's reply bubble. */
export type QuickChoiceApply = (choice: QuickChoice) => Promise<string> | string;

/**
 * System-prompt block while `onboardingComplete === false`.
 * The model owns every visible line (greeting, options, follow-ups, confirmations);
 * the host only supplies this guide, the tools, and the card UI.
 */
export function buildOnboardingInstruction(lang: 'zh' | 'en' = 'zh'): string {
  return [
    '## 新助手引导（仅在初次认识期间生效）',
    '',
    '你刚被用户创建，这是你们第一次见面。用自然对话认识用户，把你自己的「简介」和「灵魂（SOUL.md）」定下来，不要像填问卷。',
    '按顺序推进三个阶段（用户一句话答了多个阶段就直接跳过已答的）：',
    '1. 角色职责：你主要负责帮用户做什么、不做什么。',
    '2. 做事风格 / 灵魂：性格、语气、协作方式（先确认还是直接办、简洁还是多讲解等）。',
    '3. 随便聊聊 / 其他：用户还想让你知道的任何事（习惯、禁忌、称呼等）。',
    '',
    '做法：',
    '- 第一条消息：以你的名字向用户打招呼（记忆里知道用户的称呼就用它称呼用户），一两句即可；然后根据你的名字推测最可能的 4 个职责场景，作为选项，第 5 个选项固定为「先聊一聊」。',
    `- 每个阶段都要给选项：先调用 ${ASK_CHOICE_TOOL_NAME}（question=本阶段的一个简短问题，options=约 4 个贴合当前对话、彼此不同的短选项，每项不超过 20 字），然后再写正文。正文只写招呼 / 回应 / 过渡，不要在正文里重复列出选项或写 A/B/C/D。用户可以不选、直接打字回答。`,
    '- 一次只问一个阶段的问题；根据回答追问或进入下一阶段。',
    `- 每当某个阶段有了新信息，就调用 ${ONBOARDING_PROFILE_TOOL_NAME} 保存当前最完整的版本：description=对外简介（职责与边界，${OWNER_DESCRIPTION_MAX_CHARS} 字以内，不写工具清单），soul=完整的 SOUL.md 正文（Markdown，${Math.floor(SOUL_MD_MAX_CHARS * 0.75)} 字以内，包含 # 个性与边界、# 职责、# 语气与表达、# 约束、# 安全红线 等小节；安全红线保留「破坏性操作先征得同意」「不泄露密钥」）。`,
    `- 三个阶段都聊完，或用户表示想跳过 / 「先这样」/ 直接交给你一件具体任务时：用已知信息调用 ${ONBOARDING_PROFILE_TOOL_NAME} 且 done=true 结束引导；然后用一句话确认你的新设定（或直接开始做任务），之后不要再给选项、不要再追问引导问题。`,
    '- 保存是内部动作：不要对用户提工具名、「引导」「问卷」「配置」「SOUL.md」这类词，像人一样说话。',
    lang === 'en'
      ? '- The user interface is in English: talk to the user in English unless they write in another language.'
      : '- 用用户使用的语言对话（默认中文）。',
  ].join('\n');
}

/** Hidden seed row that starts the onboarding conversation (never shown in the transcript). */
export function onboardingSeedText(lang: 'zh' | 'en' = 'zh'): string {
  return lang === 'en'
    ? '[New assistant first meeting] The user just created you and opened the chat. Follow the onboarding section of your system prompt: greet them as yourself and offer the stage-1 options now.'
    : '[新助手初次见面] 用户刚创建你并打开了对话。请按系统提示中「新助手引导」：以你的身份打招呼，并给出第一阶段（角色职责）的选项。';
}

const optionalText = (desc: string) => z.string().nullable().optional().describe(desc);

/** Build `ask_choice` (host decides when to register it). */
export function buildAskChoiceTool(apply: QuickChoiceApply) {
  return tool({
    name: ASK_CHOICE_TOOL_NAME,
    description:
      '在你本条回复下方显示一张快捷选项卡片（一个问题 + 若干短选项），用户点选项即作为回复发送，也可以直接打字。每条回复最多调用一次；先调用本工具再写正文。',
    parameters: z.object({
      question: z.string().describe('卡片标题：一个简短问题'),
      options: z
        .array(z.string())
        .describe(`选项列表（2–${QUICK_CHOICE_MAX_OPTIONS} 项，每项一句短语）`),
    }),
    needsApproval: false,
    execute: async (args: { question?: string; options?: string[] }) => {
      const choice = normalizeQuickChoice(args);
      if (!choice) return '错误：question 不能为空，options 至少 2 项。';
      try {
        return await apply(choice);
      } catch (err) {
        return `错误：${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

/** Build the onboarding profile tool (host decides when to register it). */
export function buildOnboardingProfileTool(apply: OnboardingProfileApply) {
  return tool({
    name: ONBOARDING_PROFILE_TOOL_NAME,
    description:
      '新助手引导期间保存你自己的资料：description=对外简介，soul=完整 SOUL.md 正文；done=true 表示引导结束（之后不再引导）。未用到的字段请省略。',
    parameters: z.object({
      description: optionalText(`对外简介：职责与边界（${OWNER_DESCRIPTION_MAX_CHARS} 字以内）`),
      soul: optionalText('完整的 SOUL.md 正文（Markdown）'),
      done: z.boolean().nullable().optional().describe('true = 引导完成'),
    }),
    needsApproval: false,
    execute: async (args: OnboardingProfileUpdate) => {
      try {
        return await apply(args ?? {});
      } catch (err) {
        return `错误：保存失败 — ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
