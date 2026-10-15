/**
 * 1:1 chat orchestrator (总→分→总):
 * - Idle → one main turn (startBotTurn).
 * - Busy + supplement/follow-up → soft-steer the newest in-flight run
 *   (abort that run only, then restart with full history including the new message).
 *   Does not spawn a sibling user-facing reply stream for the supplement alone.
 * - Busy + distinct new task → parallel sub-task via startBotTurn (strip / gate unchanged).
 * Stop still aborts all in-flight + queued for the owner (see abortChatOwner).
 *
 * Squads keep startSquadTurn for now (classifier soft-steer deferred).
 */
import { createId, resolveModelConfig, type ChatMessage } from '@okbot/shared';
import { classifyBusyIntent } from '@okbot/agent';
import { normalizeMessageAttachments } from '../../storage/sessionJsonl';
import type { IpcContext } from '../context';
import { listOwnerRunIds, ownerHasRuns } from '../ownerRuns';
import { softSteerNewestRun } from '../softSteerGate';
import { startBotTurn } from './startBotTurn';
import { resolveQuoteFields, type ChatStartPayload, type ChatStartResult } from './turnContext';

function persistUserOnly(
  ctx: IpcContext,
  botId: string,
  payload: ChatStartPayload,
  text: string,
): ChatMessage {
  const quote = resolveQuoteFields(ctx.storage, botId, payload.quoteMessageId, text);
  const attachments = normalizeMessageAttachments(payload.attachments);
  const userMsg: ChatMessage = {
    id: createId('msg'),
    role: 'user',
    content: text,
    createdAt: new Date().toISOString(),
    ...quote.userMsgExtra,
    ...(attachments ? { attachments } : {}),
  };
  ctx.storage.appendMessage(botId, userMsg);
  ctx.storage.touchBot(botId);
  ctx.sendRuntimeEvent({ type: 'user_message', botId, message: userMsg });
  return userMsg;
}

export async function orchestrateBotTurn(
  ctx: IpcContext,
  payload: ChatStartPayload,
  text: string,
): Promise<ChatStartResult> {
  const botId = (payload.botId || '').trim();
  if (!botId) throw new Error('助手不存在');

  // Idle: main process owns a single turn.
  if (!ownerHasRuns(ctx.abortControllers, botId)) {
    return startBotTurn(ctx, payload, text);
  }

  const bots = ctx.storage.listBots();
  const bot = bots.find((b) => b.id === botId);
  if (!bot) throw new Error('助手不存在');

  const settings = ctx.storage.getSettings();
  let modelConfig: ReturnType<typeof resolveModelConfig> | null = null;
  try {
    modelConfig = resolveModelConfig(settings.model, {
      providerId: bot.providerId,
      modelId: bot.modelId,
    });
  } catch {
    modelConfig = null;
  }

  const activeIds = listOwnerRunIds(ctx.abortControllers, botId);
  const recent = ctx.storage
    .getMessages(botId)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-12);
  const hintCount = Math.max(1, activeIds.length);
  const activeTaskHints = recent
    .filter((m) => m.role === 'user')
    .slice(-hintCount)
    .map((m) => (m.content || '').trim())
    .filter(Boolean);

  const intent = await classifyBusyIntent({
    model: modelConfig,
    activeTaskHints,
    recentMessages: recent,
    newUserText: text,
    activeRunCount: activeIds.length,
    hasQuote: Boolean((payload.quoteMessageId || '').trim()),
  });

  if (intent === 'supplement') {
    const { superseded } = await softSteerNewestRun(ctx, botId);
    if (superseded) {
      // Stop (or a newer steer) won the epoch — keep the user bubble, no run.
      const userMessage = persistUserOnly(ctx, botId, payload, text);
      return { userMessage, superseded: true };
    }
    return startBotTurn(ctx, payload, text);
  }

  // Distinct new task: parallel under the existing gate / strip.
  return startBotTurn(ctx, payload, text);
}
