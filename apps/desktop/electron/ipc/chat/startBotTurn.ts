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
import {
  acquireParallelGate,
  registerOwnerRun,
  unregisterOwnerRun,
  withOwnerMaintenanceLock,
} from '../ownerRuns';
import { createApprovalWaiter, releaseRunApprovals } from '../approvalWaiter';
import { mcpToolsForRun } from '../../mcpRuntime';
import { buildMeshPeerSpecs, computerRouteFor, createMeshExchangeHandler, skillLookupFor } from '../chatTurnHelpers';
import { historySearchForOwner } from '../historySearchTool';
import { scheduleManageForOwner } from '../scheduleTool';
import {
  createTurnEmitter,
  persistAssistantContent,
  resolveQuoteFields,
  type ChatStartPayload,
  type ChatStartResult,
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
      const userMsg: ChatMessage = {
        id: createId('msg'),
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
        ...quote.userMsgExtra,
        ...(attachments ? { attachments } : {}),
      };
      // Persist immediately so parallel turns and the UI see the new task.
      ctx.storage.appendMessage(bot.id, userMsg);
      ctx.storage.touchBot(bot.id);

      const parallelGate = await acquireParallelGate(bot.id);
      try {
        if (!parallelGate.proceed) {
          // Still notify UI of the persisted user bubble (no run to bind).
          ctx.sendRuntimeEvent({ type: 'user_message', botId: bot.id, message: userMsg });
          return { userMessage: userMsg, superseded: true };
        }

      let assistantId = createId('msg');
      let assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      };
      /** After ask_assistant commit: strip repeated interim from follow-up B. */
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
        assistantMessageId: assistantId,
        ...(clientTurnId ? { clientTurnId } : {}),
      });
      emitTurn({ type: 'user_message', botId: bot.id, message: userMsg });

      const settings = ctx.storage.getSettings();
      const modelConfig = resolveModelConfig(settings.model, { providerId: bot.providerId, modelId: bot.modelId });
      const guards = createRunGuards({
        toolRun: settings.toolRun,
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
          .filter((m) => m.id !== assistantId)
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
          web: settings.web,
          memoriesText,
          sessionSummary: sessionSummary || undefined,
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
          onClearLiveText: () => {
            if (!assistantMsg.content) return;
            assistantMsg.content = '';
            emitTurn({
              type: 'assistant_message',
              botId: bot.id,
              message: { ...assistantMsg },
            });
          },
          onCommitLiveAssistant: async () => {
            const raw = assistantMsg.content || '';
            if (!raw.trim()) return;
            const sealed = persistAssistantContent(raw, modelConfig.showThinking);
            assistantMsg = {
              ...assistantMsg,
              content: sealed,
              meshInterim: true,
            };
            try {
              await ctx.storage.upsertAssistantMessage(bot.id, { ...assistantMsg }, {
                allowRebind: false,
                runId: parallelGate.runId,
              });
            } catch (err) {
              console.error('[okbot] commit mesh interim assistant failed', err);
            }
            emitTurn({
              type: 'assistant_message',
              botId: bot.id,
              message: { ...assistantMsg },
            });
            meshFollowUp.noteCommitted(sealed);
            // Rotate: post-peer follow-up streams into a new bubble (never append into interim).
            assistantId = createId('msg');
            assistantMsg = {
              id: assistantId,
              role: 'assistant',
              content: '',
              createdAt: new Date().toISOString(),
            };
          },
          onDelta: (delta) => {
            const piece = meshFollowUp.acceptDelta(delta);
            if (piece == null) return; // still matching repeated interim prefix
            if (!piece) return;
            assistantMsg.content += piece;
            emitTurn({
              type: 'delta',
              botId: bot.id,
              messageId: assistantId,
              delta: piece,
            });
          },
          ...attachTraceHooks(guards),
          onMeshExchange: createMeshExchangeHandler({
            storage: ctx.storage,
            emit: emitTurn,
          }),
          onToolApprovalRequest: createApprovalWaiter(ctx, {
            ownerId: bot.id,
            messageId: () => assistantId,
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
              messageId: assistantId,
              requestId,
              toolName,
              approved,
              output,
            });
          },
        });
        guards.throwIfBroken();
        // result.content prefers live stream (cleared at tools → formal only). Never shrink
        // an already-visible bubble if the agent returned a shorter finalOutput fallback.
        // Mesh: strip sealed interim A if the model repeated it into follow-up B.
        const interim = meshFollowUp.getCommitted();
        let finalized = (result.content || '').trim()
          ? result.content
          : assistantMsg.content;
        finalized = meshFollowUp.finalize(finalized || '');
        if (interim) {
          finalized = stripLeadingCommittedInterim(finalized, interim);
          assistantMsg.content = stripLeadingCommittedInterim(assistantMsg.content, interim);
        }
        if (
          finalized &&
          (!assistantMsg.content.trim() || finalized.length >= assistantMsg.content.length)
        ) {
          assistantMsg.content = finalized;
        }
        assistantMsg.content = persistAssistantContent(
          assistantMsg.content,
          modelConfig.showThinking,
        );
        if (result.usage) assistantMsg.usage = result.usage;
        const botTrace = sealMessageTrace(
          guards,
          resolveRunFinishStatus({
            aborted: controller.signal.aborted,
            breakReason: guards.budget.getBreakReason(),
          }),
        );
        if (botTrace) assistantMsg.trace = botTrace;
        // Empty + no session row for this streaming id: skip upsert. Abort during
        // HITL clears streamed text; unconditional upsert used to rebind/wipe the
        // previous assistant turn (see FileStorage.upsertAssistantMessage).
        if ((assistantMsg.content || '').trim()) {
          await ctx.storage.upsertAssistantMessage(bot.id, assistantMsg, { runId: parallelGate.runId });
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
          messageId: assistantId,
          content: assistantMsg.content,
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
        return { userMessage: userMsg, assistantMessage: assistantMsg };
      } catch (err) {
        // Stop (or peer-unrelated abort): settle quietly. Circuit-breaker sets getBreakReason()
        // before aborting — surface that to the user instead of a silent done.
        if (
          !guards.budget.getBreakReason() &&
          (controller.signal.aborted || isAbortLikeError(err))
        ) {
          const abortTrace = sealMessageTrace(
            guards,
            resolveRunFinishStatus({
              aborted: true,
              breakReason: null,
            }),
          );
          if (abortTrace && (assistantMsg.content || '').trim()) {
            assistantMsg.trace = abortTrace;
            try {
              await ctx.storage.upsertAssistantMessage(bot.id, assistantMsg, { runId: parallelGate.runId });
            } catch (err) {
              console.error('[okbot] upsert aborted bot trace failed', err);
            }
          }
          emitTurn({
            type: 'done',
            botId: bot.id,
            messageId: assistantId,
            content: assistantMsg.content,
            ...(abortTrace ? { trace: abortTrace } : {}),
            aborted: true,
          });
          return { userMessage: userMsg, assistantMessage: assistantMsg, aborted: true };
        }
        const message = handleRunFailure({
          root: ctx.storage.root,
          ownerId: bot.id,
          messageId: assistantId,
          phase: 'chatStart',
          err,
          guards,
        });
        console.error('[okbot] chatStart failed', err);
        if (!assistantMsg.content) {
          assistantMsg.content = `错误：${message}`;
          const errTrace = guards.trace.getMessageTrace();
          if (errTrace) assistantMsg.trace = errTrace;
          await ctx.storage.upsertAssistantMessage(bot.id, assistantMsg, { allowRebind: false, runId: parallelGate.runId });
        }
        emitTurn({
          type: 'error',
          botId: bot.id,
          messageId: assistantId,
          error: message,
        });
        throw err;
      } finally {
        guards.dispose();
        unregisterOwnerRun(ctx.abortControllers, bot.id, parallelGate.runId, controller);
        releaseRunApprovals(ctx, bot.id, parkedRequestIds, '已结束');
      }
      } finally {
        parallelGate.release();
      }
}
