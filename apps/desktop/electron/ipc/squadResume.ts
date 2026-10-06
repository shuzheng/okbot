import {
  addTokenUsage,
  createId,
  resolveModelConfig,
  SQUAD_CAPTAIN_SPEAKER_ID,
  type ChatMessage,
  type Squad,
  type TokenUsage,
} from '@okbot/shared';
import {
  createOkbotFileSession,
  dropUnansweredToolCalls,
  formatSquadResumeNote,
  resumeSquadChatAfterHitl,
  runSquadChat,
  type RunSquadChatInput,
  type ToolApprovalDecision,
} from '@okbot/agent';
import type { IpcContext } from './context';
import type { PendingHitlRecord } from '../storage/types';
import {
  createRunGuards,
  handleRunFailure,
  isAbortLikeError,
  resolveRunFinishStatus,
} from './runGuards';
import { acquireRunSlot } from './steerGate';
import { createApprovalWaiter, releaseRunApprovals } from './approvalWaiter';
import { mcpToolsForRun } from '../mcpRuntime';
import { buildSquadMemberSpecs, computerRouteFor } from './chatTurnHelpers';

type ResumeResult = { ok: boolean; error?: string; resumed?: boolean; aborted?: boolean };

/**
 * What a cold squad resume does after its own run, given the other pending cards
 * of the same turn. Exactly one run finalizes a turn:
 * - captain resumed: it finalized; member cards of the turn are stale (drop them);
 * - member resumed: continue the captain only when no card of the turn waits
 *   (a waiting captain card finalizes the turn itself).
 */
export function planSquadResumeAfter(
  kind: 'captain' | 'member',
  pendingSameTurn: readonly { squadMember?: unknown }[],
): { dropMemberCards: boolean; continueCaptain: boolean } {
  if (kind === 'captain') {
    return { dropMemberCards: pendingSameTurn.some((p) => p.squadMember), continueCaptain: false };
  }
  return { dropMemberCards: false, continueCaptain: pendingSameTurn.length === 0 };
}

function hasUsage(u: TokenUsage | undefined): u is TokenUsage {
  return Boolean(u && (u.input || u.output || u.cache));
}

/**
 * Cold resume of a squad approval after an app restart.
 *
 * - Captain approval: restore the captain RunState and run to the final reply.
 * - Member approval: restore that member's RunState and run it to its reply. The
 *   captain run that called `ask_*` did not survive, so when the last pending
 *   member approval of the turn is answered, start a captain continuation with the
 *   collected member replies (see formatSquadResumeNote).
 *
 * Parallel member approvals of one turn have one pending file each; the replies
 * collected so far live in `pending-hitl-replies/<turnId>.json`.
 */
export async function resumeSquadAfterRestart(
  ctx: IpcContext,
  squad: Squad,
  disk: PendingHitlRecord & { botId: string },
  decision: ToolApprovalDecision,
): Promise<ResumeResult> {
  const busy: ResumeResult = { ok: false, error: '该小队已有进行中的任务' };
  if (ctx.abortControllers.has(squad.id)) return busy;
  const runSlot = await acquireRunSlot(squad.id);
  if (ctx.abortControllers.has(squad.id)) {
    runSlot.release();
    return busy;
  }

  const turnId = disk.turnId || disk.messageId;
  /** Approvals parked by this resumed run; only these are released at the end. */
  const parkedRequestIds = new Set<string>();
  const controller = new AbortController();
  ctx.abortControllers.set(squad.id, controller);
  ctx.storage.clearPendingHitlRequest(squad.id, disk.requestId);

  const settings = ctx.storage.getSettings();
  const modelConfig = resolveModelConfig(settings.model, {
    providerId: squad.providerId,
    modelId: squad.modelId,
  });
  const guards = createRunGuards({
    ownerDir: ctx.storage.ownerDir(squad.id),
    toolRun: settings.toolRun,
    controller,
  });

  let assistantId = disk.messageId;
  let assistantMsg: ChatMessage = {
    id: assistantId,
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
    speakerBotId: SQUAD_CAPTAIN_SPEAKER_ID,
  };
  /** Persist captain text streamed so far, then rotate to a new bubble id. */
  const sealCaptainSegment = () => {
    if (!assistantMsg.content.trim()) return;
    try {
      ctx.storage.upsertAssistantMessage(squad.id, { ...assistantMsg });
    } catch (err) {
      console.error('[okbot] append squad captain segment failed', err);
    }
    assistantId = createId('msg');
    assistantMsg = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      speakerBotId: SQUAD_CAPTAIN_SPEAKER_ID,
    };
  };

  try {
    const members = buildSquadMemberSpecs(ctx.storage, squad);
    const summaryState = ctx.storage.readSessionSummary(squad.id);
    const sessionSummary = summaryState?.summary?.trim() || '';
    const session = createOkbotFileSession(
      ctx.storage.createSessionStore(squad.id, {
        afterMessageId: summaryState?.coveredThroughId ?? null,
      }),
    );
    const userText = disk.userText || '';
    const common: RunSquadChatInput = {
      squadName: squad.name,
      squadDescription: squad.description,
      squadSettings: settings.squad,
      members,
      sessionSummary: sessionSummary || undefined,
      model: modelConfig,
      tools: settings.tools,
      security: settings.security,
      toolRunBudget: guards.budget,
      extraTools: await mcpToolsForRun(settings, guards.budget),
      history: [],
      session,
      ownerId: squad.id,
      resourcesDir: ctx.storage.ownerResourcesDir(squad.id),
      computerRoute: computerRouteFor(settings, userText, disk.computerId),
      userText,
      signal: controller.signal,
      onClearLiveText: () => {
        if (!assistantMsg.content) return;
        assistantMsg.content = '';
        ctx.sendRuntimeEvent({ type: 'assistant_message', botId: squad.id, message: { ...assistantMsg } });
      },
      onDelta: (delta) => {
        assistantMsg.content += delta;
        ctx.sendRuntimeEvent({ type: 'delta', botId: squad.id, messageId: assistantId, delta });
      },
      onToolApprovalRequest: createApprovalWaiter(ctx, {
        ownerId: squad.id,
        messageId: () => assistantId,
        settings,
        signal: controller.signal,
        computerId: disk.computerId,
        userText,
        turnId,
        onParked: (id) => parkedRequestIds.add(id),
      }),
      onToolResult: ({ requestId, toolName, approved, output }) => {
        if (!approved) guards.budget.recordRejection(toolName, {}, output);
        ctx.sendRuntimeEvent({
          type: 'tool_result',
          botId: squad.id,
          messageId: assistantId,
          requestId,
          toolName,
          approved,
          output,
        });
      },
      onSquadExchange: ({ kind, memberBotId, memberName, content, usage }) => {
        sealCaptainSegment();
        const exchangeMsg: ChatMessage = {
          id: createId('msg'),
          role: 'assistant',
          content: kind === 'ask' ? `呼叫「${memberName}」：\n${content}` : content,
          createdAt: new Date().toISOString(),
          speakerBotId: kind === 'ask' ? SQUAD_CAPTAIN_SPEAKER_ID : memberBotId,
          ...(kind === 'reply' && usage ? { usage } : {}),
        };
        try {
          ctx.storage.appendMessage(squad.id, exchangeMsg);
        } catch (err) {
          console.error('[okbot] append squad exchange failed', err);
        }
        ctx.sendRuntimeEvent({ type: 'assistant_message', botId: squad.id, message: exchangeMsg });
      },
    };

    const resumed = await resumeSquadChatAfterHitl({
      ...common,
      serializedRunState: disk.serializedRunState,
      requestId: disk.requestId,
      toolName: disk.toolName,
      decision,
      squadMember: disk.squadMember,
    });

    let content = '';
    let usage: TokenUsage | undefined = resumed.usage;
    const sameTurn = () =>
      ctx.storage
        .listPendingHitl(squad.id)
        .filter((p) => (p.turnId || p.messageId) === turnId && !parkedRequestIds.has(p.requestId));
    if (resumed.kind === 'captain') {
      content = resumed.content;
      // The captain run finished this turn. Member cards of the same turn belonged to
      // the captain run that did not survive; drop them so no second finalize runs.
      const pendingSameTurn = sameTurn();
      const plan = planSquadResumeAfter('captain', pendingSameTurn);
      const stale = plan.dropMemberCards ? pendingSameTurn.filter((p) => p.squadMember) : [];
      for (const p of stale) {
        ctx.storage.clearPendingHitlRequest(squad.id, p.requestId);
        ctx.sendRuntimeEvent({
          type: 'tool_result',
          botId: squad.id,
          messageId: p.messageId,
          requestId: p.requestId,
          toolName: p.toolName,
          approved: false,
          output: '已结束',
        });
      }
      if (stale.length) ctx.storage.writeSquadResumeReplies(squad.id, turnId, []);
    } else {
      const replies = [...ctx.storage.readSquadResumeReplies(squad.id, turnId), resumed.reply];
      // A waiting captain card of the same turn finalizes the turn itself (its
      // RunState runs to the final reply). Do not also start a continuation here.
      const plan = planSquadResumeAfter('member', sameTurn());
      if (!plan.continueCaptain) {
        // Other cards of this turn still wait. Keep the reply for the continuation.
        ctx.storage.writeSquadResumeReplies(squad.id, turnId, replies);
        if (hasUsage(usage)) ctx.storage.recordUsage(squad.id, usage);
        guards.finish(resolveRunFinishStatus({ aborted: false, breakReason: null }));
        ctx.sendRuntimeEvent({ type: 'done', botId: squad.id, messageId: assistantId, content: '' });
        return { ok: true, resumed: true };
      }
      ctx.storage.writeSquadResumeReplies(squad.id, turnId, []);
      const cont = await runSquadChat({
        ...common,
        resumeNote: formatSquadResumeNote(replies),
        // The session already holds this turn's user text; drop the stale ask_* call.
        sessionInputCallback: (history) => dropUnansweredToolCalls(history),
      });
      content = cont.content;
      usage = usage && cont.usage ? addTokenUsage(usage, cont.usage) : cont.usage ?? usage;
    }

    guards.throwIfBroken();
    if (!assistantMsg.content.trim() && content.trim()) assistantMsg.content = content;
    if (usage) assistantMsg.usage = usage;
    if (assistantMsg.content.trim()) {
      assistantMsg.createdAt = new Date().toISOString();
      ctx.storage.upsertAssistantMessage(squad.id, assistantMsg);
    }
    if (hasUsage(usage)) {
      try {
        ctx.storage.recordUsage(squad.id, usage);
      } catch (err) {
        console.error('[okbot] record squad usage failed', err);
      }
    }
    ctx.sendRuntimeEvent({
      type: 'done',
      botId: squad.id,
      messageId: assistantId,
      content: assistantMsg.content,
      usage,
      ...(controller.signal.aborted ? { aborted: true } : {}),
    });
    guards.finish(
      resolveRunFinishStatus({
        aborted: controller.signal.aborted,
        breakReason: guards.budget.getBreakReason(),
      }),
    );
    return { ok: true, resumed: true };
  } catch (err) {
    if (!guards.budget.getBreakReason() && (controller.signal.aborted || isAbortLikeError(err))) {
      guards.finish(resolveRunFinishStatus({ aborted: true, breakReason: null }));
      ctx.sendRuntimeEvent({
        type: 'done',
        botId: squad.id,
        messageId: assistantId,
        content: assistantMsg.content,
        aborted: true,
      });
      return { ok: true, resumed: true, aborted: true };
    }
    const message = handleRunFailure({
      root: ctx.storage.root,
      ownerId: squad.id,
      messageId: assistantId,
      phase: 'resumeHitl',
      err,
      guards,
    });
    console.error('[okbot] resumeSquadHitl failed', err);
    if (!assistantMsg.content) {
      assistantMsg.content = `错误：${message}`;
      ctx.storage.upsertAssistantMessage(squad.id, assistantMsg, { allowRebind: false });
    }
    ctx.sendRuntimeEvent({ type: 'error', botId: squad.id, messageId: assistantId, error: message });
    return { ok: false, error: message };
  } finally {
    guards.dispose();
    ctx.abortControllers.delete(squad.id);
    // Not rejectPendingApprovalsForBot: that clears every pending file of the squad,
    // including other members' cold approvals and the collected replies of this turn.
    releaseRunApprovals(ctx, squad.id, parkedRequestIds, '已结束');
    runSlot.release();
  }
}
