import { createId, resolveModelConfig } from '@okbot/shared';
import {
  resumeAgentChatAfterHitl,
  runAgentChat,
  createOkbotFileSession,
  createMeshFollowUpStripper,
  stripLeadingCommittedInterim,
  resumeMeshCalleeAfterHitl,
  formatMeshResumeNote,
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

      const live: LiveAssistantState = {
        assistantId: disk.messageId,
        assistantMsg: {
          id: disk.messageId,
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString(),
        },
      };
      const meshFollowUp = createMeshFollowUpStripper();
      const controller = new AbortController();
      const resumeRunId = createId('run');
      /** Approvals parked by this resumed run; only these are released at the end. */
      const parkedRequestIds = new Set<string>();
      registerOwnerRun(ctx.abortControllers, bot.id, resumeRunId, controller);
      // Do NOT clear pending HITL until resume succeeds — a failed resume must leave
      // the card on disk so the user can retry (fail-closed retain).

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
        const meshExchange = createMeshExchangeHandler({
          storage: ctx.storage,
          emit: (event) => ctx.sendRuntimeEvent(event),
        });

        // Mesh ask_assistant callee HITL: serializedRunState belongs to the peer, not the caller.
        if (disk.squadMember && disk.squadMember.botId) {
          const tag = disk.squadMember;
          const peer = meshPeers.find((p) => p.id === tag.botId);
          if (!peer) {
            throw new Error(`恢复失败：找不到被呼叫的助手（${tag.botId}）`);
          }
          const peerRoster = meshPeers.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
          }));
          const calleeOut = await resumeMeshCalleeAfterHitl({
            peer,
            task: tag.task || '',
            callerBotId: bot.id,
            callerName: bot.name,
            peers: meshPeers,
            mesh: { depth: 0, stack: [bot.id] },
            model: modelConfig,
            tools: settings.tools,
            security: settings.security,
            toolRunBudget: guards.budget,
            web: settings.web,
            ownerId: bot.id,
            resourcesDir: ctx.storage.ownerResourcesDir(bot.id),
            computerRoute: computerRouteFor(settings, disk.userText, disk.computerId),
            rosterForCallee: (calleeId) => peerRoster.filter((p) => p.id !== calleeId),
            signal: controller.signal,
            serializedRunState: disk.serializedRunState,
            requestId: disk.requestId,
            toolName: disk.toolName,
            ...(typeof disk.callId === 'string' && disk.callId.trim()
              ? { callId: disk.callId.trim() }
              : {}),
            ...(disk.arguments !== undefined ? { arguments: disk.arguments } : {}),
            decision,
            onMeshExchange: meshExchange,
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
            ...attachTraceHooks(guards),
          });

          try {
            ctx.storage.clearPendingHitlRequest(bot.id, disk.requestId);
          } catch (err) {
            console.error('[okbot] clear pending hitl after mesh callee resume failed', err);
          }

          // Continue the caller with a resume note (mirrors squad captain continuation).
          const resumeNote = formatMeshResumeNote(calleeOut.peerName, calleeOut.task, calleeOut.reply);
          const result = await runAgentChat({
            botName: bot.name,
            botDescription: bot.description,
            soulMd,
            skillsText,
            skillLookup,
            historySearch: historySearchForOwner(ctx.storage, bot.id),
            scheduleManage: scheduleManageForOwner(ctx.storage, bot.id),
      memoryManage: memoryManageForBot(ctx.storage, bot.id),
            taskProgressManage: async (input) => {
              const r = await taskProgressManageForOwner(ctx.storage, bot.id)(input);
              try {
                ctx.sendRuntimeEvent({
                  type: 'tasks_changed',
                  botId: bot.id,
                  tasks: ctx.storage.loadOpenTasks(bot.id),
                });
              } catch (err) {
                console.error('[okbot] tasks_changed emit failed', err);
              }
              return r;
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
            userText: resumeNote,
            signal: controller.signal,
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
            },
            ...attachTraceHooks(guards),
            onMeshExchange: meshExchange,
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
          try {
            ctx.storage.clearRunCheckpoint(bot.id);
          } catch (err) {
            console.error('[okbot] clear run checkpoint after mesh resume failed', err);
          }
          return { ok: true, resumed: true };
        }

        const result = await resumeAgentChatAfterHitl({
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
          requestId: disk.requestId,
          toolName: disk.toolName,
          ...(typeof disk.callId === 'string' && disk.callId.trim()
            ? { callId: disk.callId.trim() }
            : {}),
          ...(disk.arguments !== undefined ? { arguments: disk.arguments } : {}),
          decision,
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

        // result.content prefers live stream (cleared at tools → formal only). Never shrink
        // an already-visible bubble if the agent returned a shorter finalOutput fallback.
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
        try {
          ctx.storage.clearPendingHitlRequest(bot.id, disk.requestId);
        } catch (err) {
          console.error('[okbot] clear pending hitl after resume failed', err);
        }
        try {
          ctx.storage.clearRunCheckpoint(bot.id);
        } catch (err) {
          console.error('[okbot] clear run checkpoint after resume failed', err);
        }
        return { ok: true, resumed: true };
      } catch (err) {
        // Stop / abort: settle quietly.
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
            } catch (err) {
              console.error('[okbot] upsert aborted bot trace failed', err);
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
          try {
            ctx.storage.clearPendingHitlRequest(bot.id, disk.requestId);
          } catch (err) {
            console.error('[okbot] clear pending hitl after abort failed', err);
          }
          try {
            ctx.storage.clearRunCheckpoint(bot.id);
          } catch (err) {
            console.error('[okbot] clear run checkpoint after abort failed', err);
          }
          return { ok: true, resumed: true, aborted: true };
        }
        const message = handleRunFailure({
          root: ctx.storage.dataRoot,
          ownerId: bot.id,
          messageId: live.assistantId,
          phase: 'resumeHitl',
          err,
          guards,
        });
        console.error('[okbot] resumeHitl failed', err);
        if (!live.assistantMsg.content) {
          live.assistantMsg.content = `错误：${message}`;
          const errTrace = guards.trace.getMessageTrace();
          if (errTrace) live.assistantMsg.trace = errTrace;
          await ctx.storage.upsertAssistantMessage(bot.id, live.assistantMsg, { allowRebind: false, runId: resumeRunId });
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
        // Align with squad resume / live turns: only this run's parked cards.
        releaseRunApprovals(ctx, bot.id, parkedRequestIds, '已结束');
        runSlot.release();
      }
}
