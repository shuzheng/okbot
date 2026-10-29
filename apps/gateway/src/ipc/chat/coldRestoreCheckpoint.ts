import { createId, resolveModelConfig } from '@okbot/shared';
import {
  resumeAgentChatFromCheckpoint,
  createOkbotFileSession,
  createMeshFollowUpStripper,
  stripLeadingCommittedInterim,
} from '@okbot/agent';
import {
  attachTraceHooks,
  createRunGuards,
  handleRunFailure,
  isAbortLikeError,
  resolveRunFinishStatus,
  sealMessageTrace,
} from '../runGuards';
import {
  acquireRunSlot,
  ownerHasRuns,
  registerOwnerRun,
  unregisterOwnerRun,
} from '../ownerRuns';
import { createApprovalWaiter, releaseRunApprovals } from '../approvalWaiter';
import { mcpToolsForRun } from '../../mcpRuntime';
import { buildMeshPeerSpecs, computerRouteFor, createMeshExchangeHandler, skillLookupFor } from '../chatTurnHelpers';
import { historySearchForOwner } from '../historySearchTool';
import { scheduleManageForOwner } from '../scheduleTool';
import { memoryManageForBot } from '../memoryTool';
import { taskProgressManageForOwner } from '../taskProgressTool';
import {
  clearLiveAssistantForTools,
  commitLiveAssistantBubble,
  emitAssistantMessageBubble,
  persistAssistantContent,
  type LiveAssistantState,
  type TurnContext,
} from './turnContext';
import type { RunCheckpointRecord } from '../../storage/types';

/**
 * Crash recovery: resume a 1:1 bot from a mid-run RunState checkpoint when there
 * is no conflicting pending-hitl card. Squad checkpoints are listed but not
 * auto-resumed yet (HITL cold path still covers squad approvals).
 */
export async function resumeBotFromCheckpoint(
  ctx: TurnContext,
  disk: RunCheckpointRecord,
): Promise<{ ok: boolean; error?: string; resumed?: boolean; aborted?: boolean; skipped?: string }> {
  if (disk.kind !== 'bot') {
    return { ok: true, skipped: 'squad_checkpoint_not_auto_resumed' };
  }
  if (ctx.storage.listPendingHitl(disk.ownerId).length > 0) {
    return { ok: true, skipped: 'pending_hitl_takes_precedence' };
  }
  const bot = ctx.storage.listBots().find((b) => b.id === disk.ownerId);
  if (!bot) {
    ctx.storage.clearRunCheckpoint(disk.ownerId);
    return { ok: false, error: '助手不存在' };
  }
  if (ownerHasRuns(ctx.abortControllers, bot.id)) {
    return { ok: false, error: '该助手已有进行中的任务' };
  }

  const runSlot = await acquireRunSlot(bot.id);
  if (ownerHasRuns(ctx.abortControllers, bot.id)) {
    runSlot.release();
    return { ok: false, error: '该助手已有进行中的任务' };
  }

  const live: LiveAssistantState = {
    assistantId: disk.messageId || createId('msg'),
    assistantMsg: {
      id: '',
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    },
  };
  live.assistantMsg.id = live.assistantId;
  const meshFollowUp = createMeshFollowUpStripper();
  const controller = new AbortController();
  const resumeRunId = createId('run');
  const parkedRequestIds = new Set<string>();
  registerOwnerRun(ctx.abortControllers, bot.id, resumeRunId, controller);
  // Consume checkpoint up front so a second start cannot double-resume.
  ctx.storage.clearRunCheckpoint(bot.id);

  const settings = ctx.storage.getSettings();
  const modelConfig = resolveModelConfig(settings.model, { providerId: bot.providerId, modelId: bot.modelId });
  const guards = createRunGuards({
    controller,
  });
  try {
    const soulMd = ctx.storage.readSoulMd(bot.id);
    const skillsText = ctx.storage.formatSkillsForPrompt(bot.id);
    const skillLookup = skillLookupFor(ctx.storage, bot.id);
    const memoriesText = ctx.storage.formatMemoriesForPrompt(bot.id, { recordHits: true });
    const summaryState = ctx.storage.readSessionSummary(bot.id);
    const sessionSummary = summaryState?.summary?.trim() || '';
    const fileSession = createOkbotFileSession(
      ctx.storage.createSessionStore(bot.id, {
        afterMessageId: summaryState?.coveredThroughId ?? null,
        runId: resumeRunId,
      }),
    );
    const meshPeers = buildMeshPeerSpecs(ctx.storage, bot.id);
    const result = await resumeAgentChatFromCheckpoint({
      botName: bot.name,
      botDescription: bot.description,
      soulMd,
      skillsText,
      skillLookup,
      historySearch: historySearchForOwner(ctx.storage, bot.id),
      scheduleManage: scheduleManageForOwner(ctx.storage, bot.id),
      memoryManage: memoryManageForBot(ctx.storage, bot.id),
      taskProgressManage: async (input) => {
        const result = await taskProgressManageForOwner(ctx.storage, bot.id)(input);
        try {
          ctx.sendRuntimeEvent({
            type: 'tasks_changed',
            botId: bot.id,
            tasks: ctx.storage.loadOpenTasks(bot.id),
          });
        } catch (err) {
          console.error('[okbot] tasks_changed emit failed', err);
        }
        return result;
      },
      web: settings.web,
      memoriesText,
      sessionSummary: sessionSummary || undefined,
      taskProgressText: ctx.storage.formatTaskProgressForPrompt(bot.id) || undefined,
      assistantRoleTemplate: settings.instructions?.assistantRoleTemplate,
      isDefaultAssistant: settings.defaultAssistantId === bot.id,
      model: modelConfig,
      tools: settings.tools,
      security: settings.security,
      toolRunBudget: guards.budget,
      extraTools: await mcpToolsForRun(settings, guards.budget),
      session: fileSession,
      ownerId: bot.id,
      resourcesDir: ctx.storage.ownerResourcesDir(bot.id),
      computerRoute: computerRouteFor(settings, disk.userText, disk.computerId),
      meshPeers,
      meshSettings: settings.mesh,
      meshDepth: 0,
      meshStack: [bot.id],
      signal: controller.signal,
      serializedRunState: disk.serializedRunState,
      onClearLiveText: async () => {
        await clearLiveAssistantForTools(live, {
          ownerId: bot.id,
          runId: resumeRunId,
          showThinking: modelConfig.showThinking,
          storage: ctx.storage,
          emit: (event) => ctx.sendRuntimeEvent(event),
          noteCommitted: (t) => meshFollowUp.noteCommitted(t),
        });
      },
      onCommitLiveAssistant: async () => {
        await commitLiveAssistantBubble(live, {
          ownerId: bot.id,
          runId: resumeRunId,
          showThinking: modelConfig.showThinking,
          storage: ctx.storage,
          emit: (event) => ctx.sendRuntimeEvent(event),
          noteCommitted: (t) => meshFollowUp.noteCommitted(t),
        }, { meshInterim: true, logLabel: 'commit mesh interim assistant' });
      },
      emitAssistantMessage: async (content) => {
        await emitAssistantMessageBubble(live, content, {
          ownerId: bot.id,
          runId: resumeRunId,
          showThinking: modelConfig.showThinking,
          storage: ctx.storage,
          emit: (event) => ctx.sendRuntimeEvent(event),
          noteCommitted: (t) => meshFollowUp.noteCommitted(t),
        });
      },
      onDelta: (delta) => {
        const piece = meshFollowUp.acceptDelta(delta);
        if (piece == null || !piece) return;
        live.assistantMsg.content += piece;
        // Non-streaming UI: buffer until done; do not emit token deltas.
      },
      ...attachTraceHooks(guards),
      onMeshExchange: createMeshExchangeHandler({
        storage: ctx.storage,
        emit: (event) => ctx.sendRuntimeEvent(event),
      }),
      onToolApprovalRequest: createApprovalWaiter(ctx, {
        ownerId: bot.id,
        messageId: () => live.assistantId,
        settings,
        signal: controller.signal,
        computerId: disk.computerId,
        userText: disk.userText,
        runId: resumeRunId,
        onParked: (id) => parkedRequestIds.add(id),
      }),
      onToolResult: ({ requestId, toolName, approved, output }) => {
        if (!approved) {
          guards.budget.recordRejection(toolName, {}, output);
        }
        ctx.sendRuntimeEvent({
          type: 'tool_result',
          botId: bot.id,
          messageId: live.assistantId,
          requestId,
          toolName,
          approved,
          output,
          runId: resumeRunId,
        });
      },
      onRunCheckpoint: ({ serializedRunState }) => {
        try {
          ctx.storage.saveRunCheckpoint(bot.id, {
            kind: 'bot',
            runId: resumeRunId,
            messageId: live.assistantId,
            serializedRunState,
            createdAt: new Date().toISOString(),
            computerId: disk.computerId,
            userText: disk.userText,
          });
        } catch (err) {
          console.error('[okbot] save run checkpoint failed', err);
        }
      },
    });

    const interim = meshFollowUp.getCommitted();
    let finalized = (result.content || '').trim() ? result.content : live.assistantMsg.content;
    finalized = meshFollowUp.finalize(finalized || '');
    if (interim) {
      finalized = stripLeadingCommittedInterim(finalized, interim);
      live.assistantMsg.content = stripLeadingCommittedInterim(live.assistantMsg.content, interim);
    }
    if (
      finalized &&
      (!live.assistantMsg.content.trim() || finalized.length >= live.assistantMsg.content.length)
    ) {
      live.assistantMsg.content = finalized;
    }
    live.assistantMsg.content = persistAssistantContent(
      live.assistantMsg.content,
      modelConfig.showThinking,
    );
    if (result.usage) live.assistantMsg.usage = result.usage;
    const botTrace = sealMessageTrace(
      guards,
      resolveRunFinishStatus({ aborted: controller.signal.aborted }),
    );
    if (botTrace) live.assistantMsg.trace = botTrace;
    if ((live.assistantMsg.content || '').trim()) {
      await ctx.storage.upsertAssistantMessage(bot.id, live.assistantMsg, { runId: resumeRunId });
    }
    if (result.usage && (result.usage.input || result.usage.output || result.usage.cache)) {
      try {
        ctx.storage.recordUsage(bot.id, result.usage);
      } catch (err) {
        console.error('[okbot] record bot usage failed', err);
      }
    }
    ctx.sendRuntimeEvent({
      type: 'done',
      botId: bot.id,
      messageId: live.assistantId,
      content: live.assistantMsg.content,
      usage: result.usage,
      ...(botTrace ? { trace: botTrace } : {}),
      ...(controller.signal.aborted ? { aborted: true } : {}),
    });
    return { ok: true, resumed: true };
  } catch (err) {
    if (
      (controller.signal.aborted || isAbortLikeError(err))
    ) {
      const abortTrace = sealMessageTrace(
        guards,
        resolveRunFinishStatus({
          aborted: true,
        }),
      );
      if (abortTrace && (live.assistantMsg.content || '').trim()) {
        live.assistantMsg.trace = abortTrace;
        try {
          await ctx.storage.upsertAssistantMessage(bot.id, live.assistantMsg, { runId: resumeRunId });
        } catch (upsertErr) {
          console.error('[okbot] upsert aborted bot trace failed', upsertErr);
        }
      }
      ctx.sendRuntimeEvent({
        type: 'done',
        botId: bot.id,
        messageId: live.assistantId,
        content: live.assistantMsg.content,
        ...(abortTrace ? { trace: abortTrace } : {}),
        aborted: true,
      });
      return { ok: true, resumed: true, aborted: true };
    }
    const message = handleRunFailure({
      root: ctx.storage.dataRoot,
      ownerId: bot.id,
      messageId: live.assistantId,
      phase: 'resumeCheckpoint',
      err,
      guards,
    });
    console.error('[okbot] resumeCheckpoint failed', err);
    if (!live.assistantMsg.content) {
      live.assistantMsg.content = `错误：${message}`;
      const errTrace = guards.trace.getMessageTrace();
      if (errTrace) live.assistantMsg.trace = errTrace;
      await ctx.storage.upsertAssistantMessage(bot.id, live.assistantMsg, {
        allowRebind: false,
        runId: resumeRunId,
      });
    }
    ctx.sendRuntimeEvent({
      type: 'error',
      botId: bot.id,
      messageId: live.assistantId,
      error: message,
    });
    return { ok: false, error: message };
  } finally {
    guards.dispose();
    unregisterOwnerRun(ctx.abortControllers, bot.id, resumeRunId, controller);
    releaseRunApprovals(ctx, bot.id, parkedRequestIds, '已结束');
    try {
      ctx.storage.clearRunCheckpoint(bot.id);
    } catch (err) {
      console.error('[okbot] clear run checkpoint failed', err);
    }
    runSlot.release();
  }
}

/** Scan disk checkpoints and auto-resume safe 1:1 bots (no pending-hitl conflict). */
export async function resumeAllSafeCheckpoints(ctx: TurnContext): Promise<void> {
  const list = ctx.storage.listAllRunCheckpoints();
  for (const disk of list) {
    try {
      const result = await resumeBotFromCheckpoint(ctx, disk);
      if (result.skipped) {
        console.info('[okbot] skip checkpoint resume', disk.ownerId, result.skipped);
      } else if (!result.ok) {
        console.error('[okbot] checkpoint resume failed', disk.ownerId, result.error);
      } else if (result.resumed) {
        console.info('[okbot] resumed run from checkpoint', disk.ownerId);
      }
    } catch (err) {
      console.error('[okbot] checkpoint resume threw', disk.ownerId, err);
    }
  }
}
