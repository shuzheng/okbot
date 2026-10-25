/**
 * 1:1 chat orchestrator:
 * - Idle composer → soft-steer no-op (or abort racing auto_continue), then one main turn.
 * - Busy + composer → soft-steer: cancel auto-continue, abort all in-flight owner
 *   runs (incl. auto_continue), then restart with full session history including
 *   every newly persisted user message. The model sees appended inputs in one
 *   continuing agent context and decides whether each is supplement material or
 *   another line of work (via its own planning / tools / task-progress) — desktop
 *   does not classify or fork parallel AbortControllers for rapid composer spam.
 *   Composer also soft-steers when seemingly idle so a just-started auto_continue
 *   cannot race a parallel 「收到」 turn.
 *
 * Tradeoff: OpenAI Agents `RunState.addInput` only stages input at
 * next_step_interruption / next_step_run_again (HITL / resume boundaries), not
 * mid-token-stream. Soft-steer abort+restart is the closest safe equivalent that
 * still feeds new composer messages into a single active run without N parallel
 * composer turns. Soft-steer lock serializes rapid supplements (FIFO).
 *
 * - Busy + schedule/api → never soft-steer (do not abort the user's turn); start
 *   parallel under the existing gate (strip UI gutted; infra kept).
 * - After a clean done: if tasks.jsonl still has pending/in_progress, host
 *   auto-continues with a quiet synthetic turn (no visible user bubble). No
 *   max-count cap; stops on abort/Stop/error, or when the open queue is empty.
 *   Unchanged fingerprint only escalates the continue prompt — it does not stop
 *   the chain while unfinished tasks remain (user accepts continued AC cost).
 * Stop still aborts all in-flight + queued for the owner (see abortChatOwner).
 *
 * Squads keep startSquadTurn for now (no composer parallel classifier there).
 */
import { createId, type ChatMessage } from '@okbot/shared';
import { normalizeMessageAttachments } from '../../storage/sessionJsonl';
import {
  fingerprintTasks,
  hasUnfinishedTasks,
} from '../../storage/TaskProgressStore';
import type { IpcContext } from '../context';
import {
  cancelAutoContinues,
  clearAutoContinueCancel,
  isAutoContinueCancelled,
} from '../autoContinueGate';
import { ownerHasRuns, releaseOwnerBusyHold } from '../ownerRuns';
import { softSteerNewestRun } from '../softSteerGate';
import { startBotTurn } from './startBotTurn';
import {
  AUTO_CONTINUE_STALL_ESCALATION_TEXT,
  AUTO_CONTINUE_USER_TEXT,
  resolveQuoteFields,
  type ChatStartPayload,
  type ChatStartResult,
} from './turnContext';

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

/** Soft-steer only for composer (or unset = composer for backward compat). */
export function isComposerChatOrigin(origin: ChatStartPayload['origin']): boolean {
  return origin == null || origin === 'composer';
}

export type OrchestrateBotTurnDeps = {
  startTurn?: typeof startBotTurn;
  softSteer?: typeof softSteerNewestRun;
};

/**
 * After a clean turn, keep kicking quiet continues while tasks.jsonl still has
 * unfinished tasks. No artificial max count — Stop / abort / error, or an empty
 * open queue, end the chain. Unchanged fingerprint escalates the continue prompt
 * but does not stop while pending/in_progress remain.
 * Soft-steer may abort+restart; disk keeps unfinished tasks for the model to resume.
 */
async function maybeAutoContinueTaskProgress(
  ctx: IpcContext,
  botId: string,
  payload: ChatStartPayload,
  result: ChatStartResult,
  startTurn: typeof startBotTurn,
): Promise<ChatStartResult> {
  let current = result;
  /** Consecutive auto-continues that left the tasks fingerprint unchanged. */
  let unchangedStreak = 0;

  while (true) {
    if (current.aborted || current.superseded) break;
    if (isAutoContinueCancelled(botId)) break;
    // User (or schedule) already started another run in the idle gap.
    if (ownerHasRuns(ctx.abortControllers, botId)) break;

    let tasks;
    try {
      tasks = ctx.storage.loadTasks(botId);
    } catch (err) {
      console.error('[okbot] load tasks for auto-continue failed', err);
      break;
    }
    if (!hasUnfinishedTasks(tasks)) break;

    const fpBefore = fingerprintTasks(tasks);
    const continueText =
      unchangedStreak > 0 ? AUTO_CONTINUE_STALL_ESCALATION_TEXT : AUTO_CONTINUE_USER_TEXT;
    const continuePayload: ChatStartPayload = {
      botId,
      text: continueText,
      origin: 'auto_continue',
      ...(payload.computerId ? { computerId: payload.computerId } : {}),
    };

    try {
      current = await startTurn(ctx, continuePayload, continueText);
    } catch (err) {
      // Hard error: do not keep spinning.
      console.error('[okbot] tasks auto-continue failed', err);
      throw err;
    }

    if (current.aborted || current.superseded) break;
    if (isAutoContinueCancelled(botId)) break;

    let tasksAfter;
    try {
      tasksAfter = ctx.storage.loadTasks(botId);
    } catch (err) {
      console.error('[okbot] reload tasks after auto-continue failed', err);
      break;
    }
    if (!hasUnfinishedTasks(tasksAfter)) break;
    // Stall: escalate continue prompt while fingerprint unchanged; do not stop
    // solely for no-spin while unfinished tasks remain.
    if (fingerprintTasks(tasksAfter) === fpBefore) {
      unchangedStreak += 1;
      continue;
    }
    unchangedStreak = 0;
  }

  return current;
}

export async function orchestrateBotTurn(
  ctx: IpcContext,
  payload: ChatStartPayload,
  text: string,
  deps: OrchestrateBotTurnDeps = {},
): Promise<ChatStartResult> {
  const startTurn = deps.startTurn ?? startBotTurn;
  const softSteer = deps.softSteer ?? softSteerNewestRun;

  const botId = (payload.botId || '').trim();
  if (!botId) throw new Error('助手不存在');

  // Host auto-continue: never soft-steer; only start when idle.
  if (payload.origin === 'auto_continue') {
    if (ownerHasRuns(ctx.abortControllers, botId) || isAutoContinueCancelled(botId)) {
      return {
        userMessage: {
          id: createId('msg'),
          role: 'user',
          content: text,
          createdAt: new Date().toISOString(),
          autoContinue: true,
        },
        superseded: true,
      };
    }
    return startTurn(ctx, payload, text);
  }

  let result: ChatStartResult;
  const composer = isComposerChatOrigin(payload.origin);

  // Schedule / API: never soft-steer (must not abort the user's current turn).
  if (!composer) {
    // Re-enable auto-continue after a prior Stop.
    clearAutoContinueCancel(botId);
    result = await startTurn(ctx, payload, text);
    return maybeAutoContinueTaskProgress(ctx, botId, payload, result, startTurn);
  }

  // Composer (idle or busy): always soft-steer so an in-flight / just-started
  // auto_continue is cancelled+aborted before we start. Empty runs → no-op.
  // Soft-steer itself calls cancelAutoContinues; do not clear cancel until after
  // soft-steer so a racing AC kick sees the flag.
  const { superseded } = await softSteer(ctx, botId);
  if (superseded) {
    // Stop (or a newer steer) won the epoch — keep the user bubble, no run.
    const userMessage = persistUserOnly(ctx, botId, payload, text);
    return { userMessage, superseded: true };
  }
  // This turn may host auto-continue after a clean done.
  clearAutoContinueCancel(botId);
  try {
    result = await startTurn(ctx, payload, text);
  } catch (err) {
    // startTurn failed before registerOwnerRun — drop soft-steer busy hold.
    releaseOwnerBusyHold(botId);
    throw err;
  }
  return maybeAutoContinueTaskProgress(ctx, botId, payload, result, startTurn);
}
