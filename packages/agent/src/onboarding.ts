import { tool } from '@openai/agents';
import { z } from 'zod';
import {
  OWNER_DESCRIPTION_MAX_CHARS,
  QUICK_CHOICE_MAX_OPTIONS,
  normalizeQuickChoice,
  type QuickChoice,
} from '@okbot/shared';
import {
  ASK_CHOICE_TOOL_NAME,
  ONBOARDING_PROFILE_TOOL_NAME,
} from './onboardingPrompt.js';

export {
  ASK_CHOICE_TOOL_NAME,
  ONBOARDING_PROFILE_TOOL_NAME,
  buildOnboardingInstruction,
  onboardingSeedText,
} from './onboardingPrompt.js';

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
