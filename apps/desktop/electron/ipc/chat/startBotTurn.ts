import {
  createId,
  resolveModelConfig,
  type ChatMessage,
} from '@okbot/shared';
import {
  runAgentChat,
  createOkbotFileSession,
  resolveSessionInputCallbackForTurn,
  createMeshFollowUpStripper,
  stripLeadingCommittedInterim,
} from '@okbot/agent';
import { normalizeMessageAttachments } from '../../storage/sessionJsonl';
import {
  ensureSessionCompressed,
  resolveTopicCompressForce,
} from '../../storage/sessionCompression';
import {
  extractMemoriesFromFoldedHistory,
  rememberSummaryFacts,
  runThrottledPostTurnMaintenance,
} from '../../contextMaterials';
import {
  attachTraceHooks,
  createRunGuards,
  handleRunFailure,
  isAbortLikeError,
  resolveRunFinishStatus,
  sealMessageTrace,
} from '../runGuards';
import { isAutoContinueCancelled } from '../autoContinueGate';
import {
  acquireParallelGate,
  ownerHasRuns,
  registerOwnerRun,
  releaseOwnerBusyHold,
  unregisterOwnerRun,
  withOwnerMaintenanceLock,
} from '../ownerRuns';
import { createApprovalWaiter, releaseRunApprovals } from '../approvalWaiter';
import { mcpToolsForRun } from '../../mcpRuntime';
import { buildMeshPeerSpecs, computerRouteFor, createMeshExchangeHandler, skillLookupFor } from '../chatTurnHelpers';
import { historySearchForOwner } from '../historySearchTool';
import { scheduleManageForOwner } from '../scheduleTool';
import { taskProgressManageForOwner } from '../taskProgressTool';
import {
  clearLiveAssistantForTools,
  commitLiveAssistantBubble,
  createTurnEmitter,
  emitAssistantMessageBubble,
  persistAssistantContent,
  resolveQuoteFields,
  type ChatStartPayload,
  type ChatStartResult,
  type LiveAssistantState,
  type TurnContext,
} from './turnContext';

/** 1:1 bot turn (behavior-preserving extract from registerChat). */
export async function startBotTurn(
  ctx: TurnContext,
  payload: ChatStartPayload,
  text: string,
): Promise<ChatStartResult> {
      const bots = ctx.storage.listBots();
      const bot = bots.find((b) => b.id === payload.botId);
      if (!bot) throw new Error('助手不存在');

      const quote = resolveQuoteFields(ctx.storage, bot.id, payload.quoteMessageId, text);
      const attachments = normalizeMessageAttachments(payload.attachments);
      const isAutoContinue = payload.origin === 'auto_continue';
      const userMsg: ChatMessage = {
        id: createId('msg'),
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
        ...quote.userMsgExtra,
        ...(attachments ? { attachments } : {}),
        ...(isAutoContinue ? { autoContinue: true } : {}),
      };
      // Persist immediately so parallel turns and the UI see the new task.
      // Auto-continue rows stay in the model session but are hidden from the UI.
      ctx.storage.appendMessage(bot.id, userMsg);
      ctx.storage.touchBot(bot.id);

      const parallelGate = await acquireParallelGate(bot.id);
      try {
        if (!parallelGate.proceed) {
          // Soft-steer may have left a busy hold; no registerOwnerRun will clear it.
          releaseOwnerBusyHold(bot.id);
          // Still notify UI of the persisted user bubble (no run to bind).
          // Auto-continue stays quiet (no visible user bubble).
          if (!isAutoContinue) {
            ctx.sendRuntimeEvent({ type: 'user_message', botId: bot.id, message: userMsg });
          }
          return { userMessage: userMsg, superseded: true };
        }

        // Auto-continue: re-check after the gate wait. Composer soft-steer may have
        // cancelled the chain or registered a user turn while we awaited a slot.
        if (
          isAutoContinue &&
          (isAutoContinueCancelled(bot.id) || ownerHasRuns(ctx.abortControllers, bot.id))
        ) {
          releaseOwnerBusyHold(bot.id);
          return { userMessage: userMsg, superseded: true };
        }

      const live: LiveAssistantState = {
        assistantId: createId('msg'),
        assistantMsg: {
          id: '',
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString(),
        },
      };
      live.assistantMsg.id = live.assistantId;
      /** After ask_assistant / send_message: strip repeated interim from follow-up. */
      const meshFollowUp = createMeshFollowUpStripper();
      // Do not persist empty assistant placeholder — Runner/Session writes the
      // real assistant (+ tool) items; UI streams against this ephemeral id.

      /** Approvals parked by this run; only these are released at the end. */
      const parkedRequestIds = new Set<string>();
      const controller = new AbortController();
      registerOwnerRun(ctx.abortControllers, bot.id, parallelGate.runId, controller);
      const turnRunId = parallelGate.runId;
      const clientTurnId = (payload.clientTurnId || '').trim() || undefined;
      const emitTurn = createTurnEmitter(ctx, turnRunId);
      // turn_started first so SSE/gateway can bind runId (+ clientTurnId) before deltas.
      emitTurn({
        type: 'turn_started',
        botId: bot.id,
        runId: turnRunId,
        userMessageId: userMsg.id,
        assistantMessageId: live.assistantId,
        ...(clientTurnId ? { clientTurnId } : {}),
      });
      // Auto-continue: no visible user bubble (row still in session for the model).
      if (!isAutoContinue) {
        emitTurn({ type: 'user_message', botId: bot.id, message: userMsg });
      }

      const settings = ctx.storage.getSettings();
      const modelConfig = resolveModelConfig(settings.model, { providerId: bot.providerId, modelId: bot.modelId });
      const guards = createRunGuards({
        controller,
      });
      try {
        const agentsMd = ctx.storage.readAgentsMd(bot.id);
        const skillsText = ctx.storage.formatSkillsForPrompt(bot.id);
        const skillLookup = skillLookupFor(ctx.storage, bot.id);
        const memoriesText = ctx.storage.formatMemoriesForPrompt(bot.id);

        // All prior turns (exclude the empty streaming assistant placeholder).
        const allMessages = ctx.storage
          .getMessages(bot.id)
          .filter((m) => m.id !== live.assistantId)
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .filter((m) => !m.meshExchange && !m.meshInterim)
          .filter((m) => (m.id === userMsg.id ? true : Boolean(m.content?.trim())));

        const prior = allMessages.filter((m) => m.id !== userMsg.id);
        const staticText = [agentsMd, skillsText, memoriesText, bot.name, bot.description, text]
          .filter(Boolean)
          .join('\n');
        const existingSummary = ctx.storage.readSessionSummary(bot.id);
        const topicForce = await resolveTopicCompressForce({
          model: modelConfig,
          contextCompression: settings.contextCompression,
          prior,
          sessionSummary: existingSummary?.summary,
          coveredThroughId: existingSummary?.coveredThroughId,
          newUserText: text,
          signal: controller.signal,
        });
        guards.trace.beginSystem('compress');
        let sessionSummary: string;
        let summaryState: Awaited<ReturnType<typeof ensureSessionCompressed>>['summaryState'];
        let omitRecordIds: Awaited<ReturnType<typeof ensureSessionCompressed>>['omitRecordIds'];
        try {
          const compressed = await withOwnerMaintenanceLock(bot.id, () => ensureSessionCompressed({
            storage: ctx.storage,
            ownerId: bot.id,
            model: modelConfig,
            contextCompression: settings.contextCompression,
            staticText,
            prior,
            sessionRows: ctx.storage.listSessionBudgetRows(bot.id),
            signal: controller.signal,
            force: topicForce,
            enforceBudget: true,
            rememberFacts: (facts) => rememberSummaryFacts(ctx.storage, bot.id, facts),
            onHistoryFolded: async ({ deltaMessages }) => {
              await extractMemoriesFromFoldedHistory({
                storage: ctx.storage,
                botId: bot.id,
                botName: bot.name,
                model: modelConfig,
                deltaMessages,
                signal: controller.signal,
              });
            },
          }));
          sessionSummary = compressed.sessionSummary;
          summaryState = compressed.summaryState;
          omitRecordIds = compressed.omitRecordIds;
          guards.trace.endSystem('compress', { status: 'ok' });
        } catch (compressErr) {
          guards.trace.endSystem('compress', {
            status: 'error',
            error: compressErr instanceof Error ? compressErr.message : String(compressErr),
          });
          throw compressErr;
        }

        // Model session view = yet-uncompressed tail after coveredThroughId (full jsonl unchanged).
        const fileSession = createOkbotFileSession(
          ctx.storage.createSessionStore(bot.id, {
            afterMessageId: summaryState?.coveredThroughId ?? null,
            omitRecordIds,
            runId: parallelGate.runId,
          }),
        );

        const sessionInputCallback = await resolveSessionInputCallbackForTurn({
          modelText: quote.modelText,
          quoteSessionInputCallback: quote.sessionInputCallback,
          attachments,
          security: settings.security,
        });
        const hasVisionInput = (attachments ?? []).some((a) => a.kind === 'image');

        const meshPeers = buildMeshPeerSpecs(ctx.storage, bot.id);
        const result = await runAgentChat({

          botName: bot.name,
          botDescription: bot.description,
          agentsMd,
          skillsText,
          skillLookup,
          historySearch: historySearchForOwner(ctx.storage, bot.id),
          scheduleManage: scheduleManageForOwner(ctx.storage, bot.id),
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
          maxTurns: settings.maxTurns,
          toolRunBudget: guards.budget,
          extraTools: await mcpToolsForRun(settings, guards.budget),
          history: [], // model history via session
          session: fileSession,
          sessionInputCallback,
          hasVisionInput,
          ownerId: bot.id,
          resourcesDir: ctx.storage.ownerResourcesDir(bot.id),
          computerRoute: computerRouteFor(settings, text, payload.computerId),
          meshPeers,
          meshSettings: settings.mesh,
          meshDepth: 0,
          meshStack: [bot.id],
          meshCallBudget: { calls: 0 },
          meshMemberMaxTurns: settings.squad?.memberMaxTurns,
          userText: text,
          signal: controller.signal,
          onClearLiveText: async () => {
            await clearLiveAssistantForTools(live, {
              ownerId: bot.id,
              runId: parallelGate.runId,
              showThinking: modelConfig.showThinking,
              storage: ctx.storage,
              emit: emitTurn,
              noteCommitted: (t) => meshFollowUp.noteCommitted(t),
            });
          },
          onCommitLiveAssistant: async () => {
            await commitLiveAssistantBubble(live, {
              ownerId: bot.id,
              runId: parallelGate.runId,
              showThinking: modelConfig.showThinking,
              storage: ctx.storage,
              emit: emitTurn,
              noteCommitted: (t) => meshFollowUp.noteCommitted(t),
            }, { meshInterim: true, logLabel: 'commit mesh interim assistant' });
          },
          emitAssistantMessage: async (content) => {
            await emitAssistantMessageBubble(live, content, {
              ownerId: bot.id,
              runId: parallelGate.runId,
              showThinking: modelConfig.showThinking,
              storage: ctx.storage,
              emit: emitTurn,
              noteCommitted: (t) => meshFollowUp.noteCommitted(t),
            });
          },
          onDelta: (delta) => {
            const piece = meshFollowUp.acceptDelta(delta);
            if (piece == null) return; // still matching repeated interim prefix
            if (!piece) return;
            live.assistantMsg.content += piece;
            // Non-streaming UI: buffer until done / send_message; do not emit token deltas.
          },
          ...attachTraceHooks(guards),
          onMeshExchange: createMeshExchangeHandler({
            storage: ctx.storage,
            emit: emitTurn,
          }),
          onToolApprovalRequest: createApprovalWaiter(ctx, {
            ownerId: bot.id,
            messageId: () => live.assistantId,
            settings,
            signal: controller.signal,
            computerId: payload.computerId,
            userText: text,
            runId: turnRunId,
            emit: emitTurn,
            onParked: (id) => parkedRequestIds.add(id),
          }),
          onToolResult: ({ requestId, toolName, approved, output }) => {
            if (!approved) {
              guards.budget.recordRejection(toolName, {}, output);
            }
            emitTurn({
              type: 'tool_result',
              botId: bot.id,
              messageId: live.assistantId,
              requestId,
              toolName,
              approved,
              output,
            });
          },
          onRunCheckpoint: ({ serializedRunState }) => {
            try {
              ctx.storage.saveRunCheckpoint(bot.id, {
                kind: 'bot',
                runId: turnRunId,
                messageId: live.assistantId,
                serializedRunState,
                createdAt: new Date().toISOString(),
                computerId: payload.computerId,
                userText: text,
              });
            } catch (err) {
              console.error('[okbot] save run checkpoint failed', err);
            }
          },
        });
        // result.content prefers live stream (cleared at tools → formal only). Never shrink
        // an already-visible bubble if the agent returned a shorter finalOutput fallback.
        // Mesh: strip sealed interim A if the model repeated it into follow-up B.
        const interim = meshFollowUp.getCommitted();
        let finalized = (result.content || '').trim()
          ? result.content
          : live.assistantMsg.content;
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
        // Empty + no session row for this streaming id: skip upsert. Abort during
        // HITL clears streamed text; unconditional upsert used to rebind/wipe the
        // previous assistant turn (see FileStorage.upsertAssistantMessage).
        if ((live.assistantMsg.content || '').trim()) {
          await ctx.storage.upsertAssistantMessage(bot.id, live.assistantMsg, { runId: parallelGate.runId });
        }
        if (result.usage && (result.usage.input || result.usage.output || result.usage.cache)) {
          try {
            ctx.storage.recordUsage(bot.id, result.usage);
          } catch (err) {
            console.error('[okbot] record bot usage failed', err);
          }
        }
        emitTurn({
          type: 'done',
          botId: bot.id,
          messageId: live.assistantId,
          content: live.assistantMsg.content,
          usage: result.usage,
          ...(botTrace ? { trace: botTrace } : {}),
          ...(controller.signal.aborted ? { aborted: true } : {}),
        });
        // First real chat closes optional onboarding without forcing answers.
        // Abort before a completed turn must not mark onboarding done.
        if (bot.onboardingComplete === false && !controller.signal.aborted) {
          try {
            ctx.storage.finishBotOnboarding(bot.id, {});
          } catch (err) {
            console.error('[okbot] soft onboarding close failed', err);
          }
        }
        // Silent AGENTS.md / skills / memory maintenance (throttled) — next turn reloads from disk.
        try {
          if (!controller.signal.aborted) {
            await withOwnerMaintenanceLock(bot.id, () =>
              runThrottledPostTurnMaintenance({
                storage: ctx.storage,
                botId: bot.id,
                botName: bot.name,
                model: modelConfig,
                agentsMd,
                userText: text,
                signal: controller.signal,
              }),
            );
          }
        } catch (err) {
          console.error('[okbot] AGENTS.md/skills/memory refresh failed', err);
        }
        return { userMessage: userMsg, assistantMessage: live.assistantMsg };
      } catch (err) {
        // Stop (or peer-unrelated abort): settle quietly.
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
              await ctx.storage.upsertAssistantMessage(bot.id, live.assistantMsg, { runId: parallelGate.runId });
            } catch (err) {
              console.error('[okbot] upsert aborted bot trace failed', err);
            }
          }
          emitTurn({
            type: 'done',
            botId: bot.id,
            messageId: live.assistantId,
            content: live.assistantMsg.content,
            ...(abortTrace ? { trace: abortTrace } : {}),
            aborted: true,
          });
          return { userMessage: userMsg, assistantMessage: live.assistantMsg, aborted: true };
        }
        const message = handleRunFailure({
          root: ctx.storage.root,
          ownerId: bot.id,
          messageId: live.assistantId,
          phase: 'chatStart',
          err,
          guards,
        });
        console.error('[okbot] chatStart failed', err);
        if (!live.assistantMsg.content) {
          live.assistantMsg.content = `错误：${message}`;
          const errTrace = guards.trace.getMessageTrace();
          if (errTrace) live.assistantMsg.trace = errTrace;
          await ctx.storage.upsertAssistantMessage(bot.id, live.assistantMsg, { allowRebind: false, runId: parallelGate.runId });
        }
        emitTurn({
          type: 'error',
          botId: bot.id,
          messageId: live.assistantId,
          error: message,
        });
        throw err;
      } finally {
        guards.dispose();
        unregisterOwnerRun(ctx.abortControllers, bot.id, parallelGate.runId, controller);
        releaseRunApprovals(ctx, bot.id, parkedRequestIds, '已结束');
        // Clear mid-run checkpoint on success, Stop, or soft-steer abort.
        // Crash leaves the file for cold resume on next start.
        try {
          ctx.storage.clearRunCheckpoint(bot.id);
        } catch (err) {
          console.error('[okbot] clear run checkpoint failed', err);
        }
      }
      } finally {
        parallelGate.release();
      }
}
