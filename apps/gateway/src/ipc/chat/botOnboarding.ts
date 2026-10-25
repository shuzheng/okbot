/**
 * Model-driven new-assistant onboarding.
 *
 * While `onboardingComplete === false` every 1:1 turn gets the onboarding guide in
 * its system prompt plus `ask_choice` (quick-choice card) and
 * `save_assistant_profile` (description + SOUL.md). The model writes every visible
 * line; the host only persists what the model saved, runs per-step evolution, and
 * marks onboarding complete once the model says done and the last evolution ran.
 */
import {
  clampOwnerDescription,
  resolveModelConfig,
  type Bot,
  type QuickChoice,
} from '@okbot/shared';
import {
  buildAskChoiceTool,
  buildOnboardingInstruction,
  buildOnboardingProfileTool,
  onboardingSeedText,
  type OnboardingProfileUpdate,
} from '@okbot/agent';
import type { FileStorage } from '../../storage/FileStorage';
import { runThrottledPostTurnMaintenance } from '../chatMaintenance';

/**
 * Safety net: after this many visible user messages the host closes onboarding
 * silently (no chat text), in case the model never calls done=true.
 */
export const ONBOARDING_MAX_USER_TURNS = 12;

/** Model said done=true; completion waits for the final evolution pass. */
const pendingDone = new Set<string>();

/** Per-assistant evolution runner state (one in flight, coalesced reruns). */
const evolutionState = new Map<string, { rerun: boolean; userText: string; done: Promise<void> }>();

export function onboardingLang(storage: FileStorage): 'zh' | 'en' {
  // Headless/gateway has no Electron locale — zh|en from settings, else zh.
  return storage.getSettings().language === 'en' ? 'en' : 'zh';
}

/** True while this assistant still runs the onboarding guide. */
export function isOnboardingActive(bot: Pick<Bot, 'id' | 'onboardingComplete'>): boolean {
  return bot.onboardingComplete === false && !pendingDone.has(bot.id);
}

function cleanText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Persist one `save_assistant_profile` call; returns a status line for the model. */
export function applyOnboardingProfile(
  storage: FileStorage,
  botId: string,
  update: OnboardingProfileUpdate,
): string {
  const bot = storage.listBots().find((b) => b.id === botId);
  if (!bot) return '错误：助手不存在';
  if (!isOnboardingActive(bot)) return '已结束，无需再保存。';
  const saved: string[] = [];
  const soul = cleanText(update.soul);
  if (soul) {
    storage.writeSoulMd(botId, soul);
    saved.push('SOUL');
  }
  const description = clampOwnerDescription(cleanText(update.description));
  if (description && description !== bot.description) {
    // updateBot also re-syncs the SOUL.md identity header (name + description).
    storage.updateBot(botId, { description });
    saved.push('简介');
  }
  if (update.done === true) {
    pendingDone.add(botId);
    return saved.length ? `已保存：${saved.join('、')}；已结束。` : '已结束。';
  }
  return saved.length ? `已保存：${saved.join('、')}。` : '没有需要保存的变化。';
}

/** Prompt + tool extras for a 1:1 run; empty once onboarding is done. */
export function onboardingRunExtras(
  storage: FileStorage,
  bot: Bot,
  onChoice: (choice: QuickChoice) => void,
): {
  onboardingGuide?: string;
  tools: Array<ReturnType<typeof buildAskChoiceTool> | ReturnType<typeof buildOnboardingProfileTool>>;
} {
  if (!isOnboardingActive(bot)) return { tools: [] };
  return {
    onboardingGuide: buildOnboardingInstruction(onboardingLang(storage)),
    tools: [
      buildAskChoiceTool((choice) => {
        onChoice(choice);
        return '选项卡片已显示在你本条回复下方。现在写正文，不要在正文里重复列出选项。';
      }),
      buildOnboardingProfileTool((update) => applyOnboardingProfile(storage, bot.id, update)),
    ],
  };
}

/** Hidden seed text for the first onboarding turn. */
export function onboardingSeed(storage: FileStorage): string {
  return onboardingSeedText(onboardingLang(storage));
}

function visibleUserTurns(storage: FileStorage, botId: string): number {
  try {
    return storage
      .getMessages(botId)
      .filter((m) => m.role === 'user' && !m.autoContinue).length;
  } catch {
    return 0;
  }
}

/** Close onboarding once (after the final evolution pass). */
function maybeCompleteOnboarding(storage: FileStorage, botId: string): void {
  const bot = storage.listBots().find((b) => b.id === botId);
  if (!bot) {
    pendingDone.delete(botId);
    return;
  }
  if (bot.onboardingComplete !== false) {
    pendingDone.delete(botId);
    return;
  }
  if (!pendingDone.has(botId) && visibleUserTurns(storage, botId) < ONBOARDING_MAX_USER_TURNS) return;
  try {
    storage.finishBotOnboarding(botId);
  } catch (err) {
    console.error('[okbot] finish onboarding failed', botId, err);
  }
  pendingDone.delete(botId);
}

/**
 * Per-step evolution while onboarding: after each answered step, run the normal
 * post-turn maintenance with the SOUL throttle bypassed (SOUL.md + description).
 * Fire-and-forget: never blocks the chat turn or the next reply (no owner
 * maintenance lock, so the next turn's compression does not wait). One run per
 * assistant at a time; steps that land mid-run coalesce into one rerun.
 */
export function scheduleOnboardingEvolution(
  storage: FileStorage,
  botId: string,
  userText: string,
): Promise<void> {
  const running = evolutionState.get(botId);
  if (running) {
    running.rerun = true;
    running.userText = userText;
    return running.done;
  }
  const state = { rerun: false, userText, done: Promise.resolve() };
  evolutionState.set(botId, state);
  state.done = (async () => {
    try {
      do {
        state.rerun = false;
        const bot = storage.listBots().find((b) => b.id === botId);
        if (!bot || bot.onboardingComplete !== false) break;
        const model = resolveModelConfig(storage.getSettings().model, {
          providerId: bot.providerId,
          modelId: bot.modelId,
        });
        try {
          await runThrottledPostTurnMaintenance({
            storage,
            botId,
            botName: bot.name,
            model,
            soulMd: storage.readSoulMd(botId),
            userText: state.userText,
            forceSoul: true,
          });
        } catch (err) {
          console.error('[okbot] onboarding evolution failed', botId, err);
        }
      } while (state.rerun);
      maybeCompleteOnboarding(storage, botId);
    } finally {
      evolutionState.delete(botId);
    }
  })();
  return state.done;
}

/** Test seam. */
export function resetOnboardingStateForTests(): void {
  pendingDone.clear();
  evolutionState.clear();
}
