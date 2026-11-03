import { createId, isTransientRunError, resolveModelConfig, type ChatMessage } from '@okbot/shared';
import {
  resumeAgentChatFromCheckpoint,
  resumeSquadChatFromCheckpoint,
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
  setOwnerRunCheckpointFlush,
  unregisterOwnerRun,
} from '../ownerRuns';
import { createApprovalWaiter, releaseRunApprovals } from '../approvalWaiter';
import { mcpToolsForRun } from '../../mcpRuntime';
import { buildMeshPeerSpecs, buildSquadMemberSpecs, computerRouteFor, createMeshExchangeHandler, skillLookupFor } from '../chatTurnHelpers';
import { historySearchForOwner } from '../historySearchTool';
import { scheduleManageForOwner } from '../scheduleTool';
import { memoryManageForBot } from '../memoryTool';
import { memoryManageForSquad } from '../memoryTool';
import { taskProgressManageForOwner } from '../taskProgressTool';
import { noteManageForOwner } from '../noteTool';
import { libraryWriteGateForOwner } from '../sameTopicArtifactGate';
import { applyAssistantSendMessage, applyEmojiOnlyFinalGuard } from '../messageReaction';
import { buildInterruptedRunResumeContext } from './softSteerResumeContext';
import {
  clearLiveAssistantForTools,
  commitLiveAssistantBubble,
  emitAssistantMessageBubble,
  persistAssistantContent,
  type LiveAssistantState,
  type TurnContext,
} from './turnContext';
import type { RunCheckpointRecord } from '../../storage/types';
import { ensureColdResumeCheckpointKeptForTransient } from './coldResumeCheckpointKeep';


/**
 * Crash / Watchdog recovery: resume a bot or squad from a mid-run RunState
 * checkpoint when there is no conflicting pending-hitl card and the checkpoint
 * is auto-resume eligible (Stop leftovers are excluded).
 */
export async function resumeBotFromCheckpoint(
  ctx: TurnContext,
  disk: RunCheckpointRecord,
): Promise<{ ok: boolean; error?: string; resumed?: boolean; aborted?: boolean; skipped?: string }> {
  if (disk.kind !== 'bot') {
    return resumeSquadFromCheckpoint(ctx, disk);
  }
  if (disk.autoResumeEligible === false) {
    return { ok: true, skipped: 'stop_suppress_auto_resume' };
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
  let keepForTransientFailure = false;
  let turnNoteCard: import('@okbot/shared').NoteCardMeta | null = null;
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
    const turnGlobalHitIds = new Set<string>();
    const memoriesText = ctx.storage.formatMemoriesForPrompt(bot.id, {
      ...(disk.userText ? { query: disk.userText } : {}),
      recordHits: false,
      recordedGlobalHitIds: turnGlobalHitIds,
    });
    const summaryState = ctx.storage.readSessionSummary(bot.id);
    const sessionSummary = summaryState?.summary?.trim() || '';
    const fileSession = createOkbotFileSession(
      ctx.storage.createSessionStore(bot.id, {
        afterMessageId: summaryState?.coveredThroughId ?? null,
        runId: resumeRunId,
      }),
    );
    const meshPeers = buildMeshPeerSpecs(ctx.storage, bot.id, {
      recordedGlobalHitIds: turnGlobalHitIds,
      recordHits: false,
    });
    const resourcesDir = ctx.storage.ownerResourcesDir(bot.id);
    const resumeContextText = buildInterruptedRunResumeContext(
      ctx.storage,
      bot.id,
      'checkpoint',
    );
    const assertLibraryWriteAllowed = libraryWriteGateForOwner(
      ctx.storage,
      bot.id,
      resourcesDir,
    );
    const result = await resumeAgentChatFromCheckpoint({
      botName: bot.name,
      botDescription: bot.description,
      soulMd,
      skillsText,
      skillLookup,
      historySearch: historySearchForOwner(ctx.storage, bot.id),
      scheduleManage: scheduleManageForOwner(ctx.storage, bot.id),
      memoryManage: memoryManageForBot(ctx.storage, bot.id),
      noteManage: noteManageForOwner(ctx.storage, bot.id, (card) => {
        turnNoteCard = card;
      }),
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
      resumeContextText,
      assistantRoleTemplate: settings.instructions?.assistantRoleTemplate,
      isDefaultAssistant: settings.defaultAssistantId === bot.id,
      model: modelConfig,
      tools: settings.tools,
      security: settings.security,
      toolRunBudget: guards.budget,
      extraTools: await mcpToolsForRun(settings, guards.budget),
      session: fileSession,
      ownerId: bot.id,
      resourcesDir,
      onGeneratedImageSaved: (info) => {
        try {
          ctx.storage.indexOwnerResourceFile(bot.id, {
            filePath: info.filePath,
            title: info.title,
            createdBy: 'assistant',
          });
        } catch (err) {
          console.error('[okbot] indexOwnerResourceFile failed', err);
        }
      },
      assertLibraryWriteAllowed,
      computerRoute: computerRouteFor(settings, disk.userText, disk.computerId),
      meshPeers,
      meshSettings: settings.mesh,
      meshDepth: 0,
      meshStack: [bot.id],
      signal: controller.signal,
      transientRetries: settings.watchdog?.transientRetries,
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
      emitAssistantMessage: async (input) => {
        await applyAssistantSendMessage(
          ctx,
          bot.id,
          input,
          async (content) => {
            await emitAssistantMessageBubble(live, content, {
              ownerId: bot.id,
              runId: resumeRunId,
              showThinking: modelConfig.showThinking,
              storage: ctx.storage,
              emit: (event) => ctx.sendRuntimeEvent(event),
              noteCommitted: (t) => meshFollowUp.noteCommitted(t),
            });
          },
          {
            onReacted: (emoji) => {
              (live.reactedEmojisThisTurn ??= []).push(emoji);
            },
          },
        );
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
      registerCheckpointFlush: (flush) => {
        setOwnerRunCheckpointFlush(bot.id, resumeRunId, flush);
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
          { ownerId: bot.id, storage: ctx.storage },
        );
    live.assistantMsg.content = await applyEmojiOnlyFinalGuard(
      ctx,
      bot.id,
      live.assistantMsg.content,
      { reactedEmojisThisTurn: live.reactedEmojisThisTurn },
    );
    if (result.usage) live.assistantMsg.usage = result.usage;
    if (turnNoteCard && !controller.signal.aborted) {
      live.assistantMsg.noteCard = turnNoteCard;
    }
    const botTrace = sealMessageTrace(
      guards,
      resolveRunFinishStatus({ aborted: controller.signal.aborted }),
    );
    if (botTrace) live.assistantMsg.trace = botTrace;
    // Upsert when there is visible text OR a note card (card-only reply after manage_note).
    if ((live.assistantMsg.content || '').trim() || live.assistantMsg.noteCard) {
      await ctx.storage.upsertAssistantMessage(bot.id, live.assistantMsg, { runId: resumeRunId });
    }
    if (result.usage && (result.usage.input || result.usage.output || result.usage.cache)) {
      try {
        ctx.storage.recordUsage(bot.id, result.usage, { modelId: modelConfig.model });
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
      ...(live.assistantMsg.noteCard ? { noteCard: live.assistantMsg.noteCard } : {}),
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
    if (isTransientRunError(err)) {
      keepForTransientFailure = true;
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
      const aborted = controller.signal.aborted;
      if (keepForTransientFailure) {
        ensureColdResumeCheckpointKeptForTransient(ctx.storage, bot.id, disk);
      } else if (!aborted) {
        ctx.storage.clearRunCheckpoint(bot.id);
      }
    } catch (err) {
      console.error('[okbot] clear run checkpoint failed', err);
    }
    runSlot.release();
  }
}


/**
 * Watchdog / cold resume of a squad captain mid-run checkpoint (no HITL decision).
 * Member HITL cold path remains resumeSquadAfterRestart.
 */
export async function resumeSquadFromCheckpoint(
  ctx: TurnContext,
  disk: RunCheckpointRecord,
): Promise<{ ok: boolean; error?: string; resumed?: boolean; aborted?: boolean; skipped?: string }> {
  if (disk.kind !== 'squad') {
    return { ok: true, skipped: 'not_squad_checkpoint' };
  }
  if (disk.autoResumeEligible === false) {
    return { ok: true, skipped: 'stop_suppress_auto_resume' };
  }
  if (ctx.storage.listPendingHitl(disk.ownerId).length > 0) {
    return { ok: true, skipped: 'pending_hitl_takes_precedence' };
  }
  const squad = ctx.storage.listSquads().find((q) => q.id === disk.ownerId);
  if (!squad) {
    ctx.storage.clearRunCheckpoint(disk.ownerId);
    return { ok: false, error: '小队不存在' };
  }
  if (ownerHasRuns(ctx.abortControllers, squad.id)) {
    return { ok: false, error: '该小队已有进行中的任务' };
  }

  const runSlot = await acquireRunSlot(squad.id);
  if (ownerHasRuns(ctx.abortControllers, squad.id)) {
    runSlot.release();
    return { ok: false, error: '该小队已有进行中的任务' };
  }

  let assistantId = disk.messageId || createId('msg');
  let assistantMsg: ChatMessage = {
    id: assistantId,
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
  };
  const controller = new AbortController();
  const resumeRunId = createId('run');
  const parkedRequestIds = new Set<string>();
  registerOwnerRun(ctx.abortControllers, squad.id, resumeRunId, controller);
  let keepForTransientFailure = false;
  let turnNoteCard: import('@okbot/shared').NoteCardMeta | null = null;
  // Consume-once so Watchdog cannot double-start.
  ctx.storage.clearRunCheckpoint(squad.id);

  const settings = ctx.storage.getSettings();
  const modelConfig = resolveModelConfig(settings.model, {
    providerId: squad.providerId,
    modelId: squad.modelId,
  });
  const guards = createRunGuards({ controller });
  try {
    const userText = disk.userText || '';
    const members = buildSquadMemberSpecs(ctx.storage, squad, {
      query: userText,
      recordedGlobalHitIds: new Set<string>(),
      recordHits: false,
    });
    const summaryState = ctx.storage.readSessionSummary(squad.id);
    const sessionSummary = summaryState?.summary?.trim() || '';
    const session = createOkbotFileSession(
      ctx.storage.createSessionStore(squad.id, {
        afterMessageId: summaryState?.coveredThroughId ?? null,
        runId: resumeRunId,
      }),
    );
    const resourcesDir = ctx.storage.ownerResourcesDir(squad.id);
    const assertLibraryWriteAllowed = libraryWriteGateForOwner(
      ctx.storage,
      squad.id,
      resourcesDir,
    );
    const result = await resumeSquadChatFromCheckpoint({
      squadName: squad.name,
      squadDescription: squad.description,
      squadSettings: settings.squad,
      members,
      sessionSummary: sessionSummary || undefined,
      historySearch: historySearchForOwner(ctx.storage, squad.id),
      scheduleManage: scheduleManageForOwner(ctx.storage, squad.id),
      memoryManage: memoryManageForSquad(ctx.storage),
      noteManage: noteManageForOwner(ctx.storage, squad.id, (card) => {
        turnNoteCard = card;
      }),
      taskProgressManage: async (input) => {
        const out = await taskProgressManageForOwner(ctx.storage, squad.id)(input);
        try {
          ctx.sendRuntimeEvent({
            type: 'tasks_changed',
            botId: squad.id,
            tasks: ctx.storage.loadOpenTasks(squad.id),
          });
        } catch (err) {
          console.error('[okbot] tasks_changed emit failed', err);
        }
        return out;
      },
      taskProgressText: ctx.storage.formatTaskProgressForPrompt(squad.id) || undefined,
      web: settings.web,
      model: modelConfig,
      tools: settings.tools,
      security: settings.security,
      toolRunBudget: guards.budget,
      extraTools: await mcpToolsForRun(settings, guards.budget),
      history: [],
      session,
      ownerId: squad.id,
      resourcesDir,
      onGeneratedImageSaved: (info) => {
        try {
          ctx.storage.indexOwnerResourceFile(squad.id, {
            filePath: info.filePath,
            title: info.title,
            createdBy: 'assistant',
          });
        } catch (err) {
          console.error('[okbot] indexOwnerResourceFile failed', err);
        }
      },
      assertLibraryWriteAllowed,
      computerRoute: computerRouteFor(settings, userText, disk.computerId),
      userText,
      signal: controller.signal,
      transientRetries: settings.watchdog?.transientRetries,
      serializedRunState: disk.serializedRunState,
      onClearLiveText: () => {
        if (!assistantMsg.content) return;
        assistantMsg.content = '';
        ctx.sendRuntimeEvent({
          type: 'assistant_message',
          botId: squad.id,
          message: { ...assistantMsg },
        });
      },
      onDelta: (delta) => {
        assistantMsg.content += delta;
      },
      ...attachTraceHooks(guards),
      onToolApprovalRequest: createApprovalWaiter(ctx, {
        ownerId: squad.id,
        messageId: () => assistantId,
        settings,
        signal: controller.signal,
        computerId: disk.computerId,
        userText,
        runId: resumeRunId,
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
          runId: resumeRunId,
        });
      },
      registerCheckpointFlush: (flush) => {
        setOwnerRunCheckpointFlush(squad.id, resumeRunId, flush);
      },
      onRunCheckpoint: ({ serializedRunState }) => {
        try {
          ctx.storage.saveRunCheckpoint(squad.id, {
            kind: 'squad',
            runId: resumeRunId,
            messageId: assistantId,
            serializedRunState,
            createdAt: new Date().toISOString(),
            computerId: disk.computerId,
            userText,
          });
        } catch (err) {
          console.error('[okbot] save squad run checkpoint failed', err);
        }
      },
    });

    if (!assistantMsg.content.trim() && (result.content || '').trim()) {
      assistantMsg.content = result.content;
    }
    if (result.usage) assistantMsg.usage = result.usage;
    if (turnNoteCard && !controller.signal.aborted) {
      assistantMsg.noteCard = turnNoteCard;
    }
    const squadTrace = sealMessageTrace(
      guards,
      resolveRunFinishStatus({ aborted: controller.signal.aborted }),
    );
    if (squadTrace) assistantMsg.trace = squadTrace;
    if ((assistantMsg.content || '').trim() || assistantMsg.noteCard) {
      assistantMsg.createdAt = new Date().toISOString();
      await ctx.storage.upsertAssistantMessage(squad.id, assistantMsg, { runId: resumeRunId });
    }
    if (result.usage && (result.usage.input || result.usage.output || result.usage.cache)) {
      try {
        ctx.storage.recordUsage(squad.id, result.usage, { modelId: modelConfig.model });
      } catch (err) {
        console.error('[okbot] record squad usage failed', err);
      }
    }
    ctx.sendRuntimeEvent({
      type: 'done',
      botId: squad.id,
      messageId: assistantId,
      content: assistantMsg.content,
      usage: result.usage,
      ...(squadTrace ? { trace: squadTrace } : {}),
      ...(assistantMsg.noteCard ? { noteCard: assistantMsg.noteCard } : {}),
      ...(controller.signal.aborted ? { aborted: true } : {}),
    });
    return { ok: true, resumed: true };
  } catch (err) {
    if (controller.signal.aborted || isAbortLikeError(err)) {
      ctx.sendRuntimeEvent({
        type: 'done',
        botId: squad.id,
        messageId: assistantId,
        content: assistantMsg.content,
        aborted: true,
      });
      return { ok: true, resumed: true, aborted: true };
    }
    if (isTransientRunError(err)) {
      keepForTransientFailure = true;
    }
    const message = handleRunFailure({
      root: ctx.storage.dataRoot,
      ownerId: squad.id,
      messageId: assistantId,
      phase: 'resumeCheckpoint',
      err,
      guards,
    });
    console.error('[okbot] resumeSquadCheckpoint failed', err);
    if (!assistantMsg.content) {
      assistantMsg.content = `错误：${message}`;
      await ctx.storage.upsertAssistantMessage(squad.id, assistantMsg, {
        allowRebind: false,
        runId: resumeRunId,
      });
    }
    ctx.sendRuntimeEvent({
      type: 'error',
      botId: squad.id,
      messageId: assistantId,
      error: message,
    });
    return { ok: false, error: message };
  } finally {
    guards.dispose();
    unregisterOwnerRun(ctx.abortControllers, squad.id, resumeRunId, controller);
    releaseRunApprovals(ctx, squad.id, parkedRequestIds, '已结束');
    try {
      const aborted = controller.signal.aborted;
      if (keepForTransientFailure) {
        ensureColdResumeCheckpointKeptForTransient(ctx.storage, squad.id, disk);
      } else if (!aborted) {
        ctx.storage.clearRunCheckpoint(squad.id);
      }
    } catch (err) {
      console.error('[okbot] clear squad run checkpoint failed', err);
    }
    runSlot.release();
  }
}

/**
 * Scan disk checkpoints and auto-resume safe bot + squad runs
 * (no pending-hitl, not Stop-suppressed, no live run).
 */
export async function resumeOwnerFromCheckpoint(
  ctx: TurnContext,
  disk: RunCheckpointRecord,
): Promise<{ ok: boolean; error?: string; resumed?: boolean; aborted?: boolean; skipped?: string }> {
  if (disk.kind === 'squad') {
    return resumeSquadFromCheckpoint(ctx, disk);
  }
  return resumeBotFromCheckpoint(ctx, disk);
}

/** Scan disk checkpoints and auto-resume safe bot + squad owners. */
export async function resumeAllSafeCheckpoints(ctx: TurnContext): Promise<void> {
  const list = ctx.storage.listAllRunCheckpoints();
  for (const disk of list) {
    try {
      if (disk.autoResumeEligible === false) {
        console.info('[okbot] skip checkpoint resume', disk.ownerId, 'stop_suppress_auto_resume');
        continue;
      }
      const result = await resumeOwnerFromCheckpoint(ctx, disk);
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
