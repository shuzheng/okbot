import { createId, resolveModelConfig, type ChatMessage } from '@okbot/shared';
import {
  resumeAgentChatAfterHitl,
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
import { persistAssistantContent, type TurnContext } from './turnContext';
type DiskPending = ReturnType<TurnContext['storage']['listAllPendingHitl']>[number];

/** Cold-restore a 1:1 bot HITL after process restart. */
export async function resumeBotAfterRestart(
  ctx: TurnContext,
  bot: ReturnType<TurnContext['storage']['listBots']>[number],
  disk: DiskPending,
  decision: { approved: boolean; message?: string },
): Promise<{ ok: boolean; error?: string; resumed?: boolean; aborted?: boolean }> {
      if (ownerHasRuns(ctx.abortControllers, bot.id)) {
        return { ok: false, error: '该助手已有进行中的任务' };
      }

      const runSlot = await acquireRunSlot(bot.id);
      // Re-check after waiting on the exclusive chain (a chat turn may have started).
      if (ownerHasRuns(ctx.abortControllers, bot.id)) {
        runSlot.release();
        return { ok: false, error: '该助手已有进行中的任务' };
      }

      let assistantId = disk.messageId;
      let assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      };
      const meshFollowUp = createMeshFollowUpStripper();
      const controller = new AbortController();
      const resumeRunId = createId('run');
      /** Approvals parked by this resumed run; only these are released at the end. */
      const parkedRequestIds = new Set<string>();
      registerOwnerRun(ctx.abortControllers, bot.id, resumeRunId, controller);
      // Only this card — sibling cold-pending approvals for the same owner must survive.
      ctx.storage.clearPendingHitlRequest(bot.id, disk.requestId);

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
        const summaryState = ctx.storage.readSessionSummary(bot.id);
        const sessionSummary = summaryState?.summary?.trim() || '';
        const fileSession = createOkbotFileSession(
          ctx.storage.createSessionStore(bot.id, {
            afterMessageId: summaryState?.coveredThroughId ?? null,
            runId: resumeRunId,
          }),
        );

        const meshPeers = buildMeshPeerSpecs(ctx.storage, bot.id);
        const result = await resumeAgentChatAfterHitl({
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
          session: fileSession,
          ownerId: bot.id,
          resourcesDir: ctx.storage.ownerResourcesDir(bot.id),
          computerRoute: computerRouteFor(settings, disk.userText, disk.computerId),
          meshPeers,
          meshSettings: settings.mesh,
          meshDepth: 0,
          meshStack: [bot.id],
          meshCallBudget: { calls: 0 },
          meshMemberMaxTurns: settings.squad?.memberMaxTurns,
          signal: controller.signal,
          serializedRunState: disk.serializedRunState,
          requestId: disk.requestId,
          toolName: disk.toolName,
          decision,
          onClearLiveText: () => {
            if (!assistantMsg.content) return;
            assistantMsg.content = '';
            ctx.sendRuntimeEvent({
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
                runId: resumeRunId,
              });
            } catch (err) {
              console.error('[okbot] commit mesh interim assistant failed', err);
            }
            ctx.sendRuntimeEvent({
              type: 'assistant_message',
              botId: bot.id,
              message: { ...assistantMsg },
            });
            meshFollowUp.noteCommitted(sealed);
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
            if (piece == null || !piece) return;
            assistantMsg.content += piece;
            ctx.sendRuntimeEvent({
              type: 'delta',
              botId: bot.id,
              messageId: assistantId,
              delta: piece,
            });
          },
          ...attachTraceHooks(guards),
          onMeshExchange: createMeshExchangeHandler({
            storage: ctx.storage,
            emit: (event) => ctx.sendRuntimeEvent(event),
          }),
          onToolApprovalRequest: createApprovalWaiter(ctx, {
            ownerId: bot.id,
            messageId: () => assistantId,
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
              messageId: assistantId,
              requestId,
              toolName,
              approved,
              output,
              runId: resumeRunId,
            });
          },
        });

        guards.throwIfBroken();

        // result.content prefers live stream (cleared at tools → formal only). Never shrink
        // an already-visible bubble if the agent returned a shorter finalOutput fallback.
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
          await ctx.storage.upsertAssistantMessage(bot.id, assistantMsg, { runId: resumeRunId });
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
          messageId: assistantId,
          content: assistantMsg.content,
          usage: result.usage,
          ...(botTrace ? { trace: botTrace } : {}),
          ...(controller.signal.aborted ? { aborted: true } : {}),
        });
        return { ok: true, resumed: true };
      } catch (err) {
        // Circuit-breaker aborts the same controller; surface getBreakReason() first
        // so the user sees the limit message instead of a silent stop.
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
              await ctx.storage.upsertAssistantMessage(bot.id, assistantMsg, { runId: resumeRunId });
            } catch (err) {
              console.error('[okbot] upsert aborted bot trace failed', err);
            }
          }
          ctx.sendRuntimeEvent({
            type: 'done',
            botId: bot.id,
            messageId: assistantId,
            content: assistantMsg.content,
            ...(abortTrace ? { trace: abortTrace } : {}),
            aborted: true,
          });
          return { ok: true, resumed: true, aborted: true };
        }
        const message = handleRunFailure({
          root: ctx.storage.root,
          ownerId: bot.id,
          messageId: assistantId,
          phase: 'resumeHitl',
          err,
          guards,
        });
        console.error('[okbot] resumeHitl failed', err);
        if (!assistantMsg.content) {
          assistantMsg.content = `错误：${message}`;
          const errTrace = guards.trace.getMessageTrace();
          if (errTrace) assistantMsg.trace = errTrace;
          await ctx.storage.upsertAssistantMessage(bot.id, assistantMsg, { allowRebind: false, runId: resumeRunId });
        }
        ctx.sendRuntimeEvent({
          type: 'error',
          botId: bot.id,
          messageId: assistantId,
          error: message,
        });
        return { ok: false, error: message };
      } finally {
        guards.dispose();
        unregisterOwnerRun(ctx.abortControllers, bot.id, resumeRunId, controller);
        // Align with squad resume / live turns: only this run's parked cards.
        releaseRunApprovals(ctx, bot.id, parkedRequestIds, '已结束');
        runSlot.release();
      }
}
