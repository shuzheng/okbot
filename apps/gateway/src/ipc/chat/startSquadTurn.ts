import {
  createId,
  resolveModelConfig,
  SQUAD_CAPTAIN_SPEAKER_ID,
  type ChatMessage,
} from '@okbot/shared';
import {
  runSquadChat,
  createOkbotFileSession,
  resolveSessionInputCallbackForTurn,
} from '@okbot/agent';
import { normalizeMessageAttachments } from '../../storage/sessionJsonl';
import {
  ensureSessionCompressed,
  resolveTopicCompressForce,
} from '../../storage/sessionCompression';
import {
  runThrottledPostTurnSquadDescriptionRefresh,
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
import { buildSquadMemberSpecs, computerRouteFor, skillLookupFor } from '../chatTurnHelpers';
import { historySearchForOwner } from '../historySearchTool';
import { scheduleManageForOwner } from '../scheduleTool';
import { taskProgressManageForOwner } from '../taskProgressTool';
import {
  createTurnEmitter,
  persistAssistantContent,
  resolveQuoteFields,
  type ChatStartPayload,
  type ChatStartResult,
  type TurnContext,
} from './turnContext';

/** 1:N squad captain turn (behavior-preserving extract from registerChat). */
export async function startSquadTurn(
  ctx: TurnContext,
  payload: ChatStartPayload,
  text: string,
): Promise<ChatStartResult> {
      const squad = ctx.storage.listSquads().find((s) => s.id === payload.squadId);
      if (!squad) throw new Error('小队不存在');
      const bots = ctx.storage.listBots();
      const byId = new Map(bots.map((b) => [b.id, b]));
      for (const m of squad.members) {
        if (!byId.has(m.botId)) throw new Error(`成员不存在：${m.botId}`);
      }
      const quote = resolveQuoteFields(ctx.storage, squad.id, payload.quoteMessageId, text);
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
      ctx.storage.appendMessage(squad.id, userMsg);
      ctx.storage.touchSquad(squad.id);

      const parallelGate = await acquireParallelGate(squad.id);
      try {
        if (!parallelGate.proceed) {
          ctx.sendRuntimeEvent({ type: 'user_message', botId: squad.id, message: userMsg });
          return { userMessage: userMsg, superseded: true };
        }

      let assistantId = createId('msg');
      let assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        speakerBotId: SQUAD_CAPTAIN_SPEAKER_ID,
      };
      let sealedCaptainSegments = 0;
      let lastSealedCaptainId: string | null = null;
      /** Approvals parked by this run; only these are released at the end. */
      const parkedRequestIds = new Set<string>();

      const controller = new AbortController();
      registerOwnerRun(ctx.abortControllers, squad.id, parallelGate.runId, controller);
      const turnRunId = parallelGate.runId;
      const clientTurnId = (payload.clientTurnId || '').trim() || undefined;
      const emitTurn = createTurnEmitter(ctx, turnRunId);
      emitTurn({
        type: 'turn_started',
        botId: squad.id,
        runId: turnRunId,
        userMessageId: userMsg.id,
        assistantMessageId: assistantId,
        ...(clientTurnId ? { clientTurnId } : {}),
      });
      emitTurn({ type: 'user_message', botId: squad.id, message: userMsg });
      const settings = ctx.storage.getSettings();
      const modelConfig = resolveModelConfig(settings.model, { providerId: squad.providerId, modelId: squad.modelId });
      const guards = createRunGuards({
        controller,
      });

      /** Persist captain text streamed so far, then rotate to a new bubble id. */
      const sealCaptainSegment = async () => {
        if (!assistantMsg.content.trim()) return;
        assistantMsg.content = persistAssistantContent(
          assistantMsg.content,
          modelConfig.showThinking,
        );
        if (!assistantMsg.content.trim()) return;
        try {
          ctx.storage.appendMessage(squad.id, { ...assistantMsg });
          sealedCaptainSegments += 1;
          lastSealedCaptainId = assistantId;
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
        const memberSpecs = buildSquadMemberSpecs(ctx.storage, squad);

        // Prior turns (exclude empty assistant placeholders / current user msg).
        const allMessages = ctx.storage
          .getMessages(squad.id)
          .filter((m) => m.id !== assistantId)
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .filter((m) => (m.id === userMsg.id ? true : Boolean(m.content?.trim())));
        const prior = allMessages.filter((m) => m.id !== userMsg.id);
        const rosterText = memberSpecs
          .map((m) => m.name)
          .join('、');
        const staticText = [
          squad.name,
          squad.description,
          settings.squad?.captainPersona,
          settings.squad?.playbook,
          rosterText,
          text,
        ]
          .filter(Boolean)
          .join('\n');
        const existingSummary = ctx.storage.readSessionSummary(squad.id);
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
          const compressed = await withOwnerMaintenanceLock(squad.id, () =>
            ensureSessionCompressed({
              storage: ctx.storage,
              ownerId: squad.id,
              model: modelConfig,
              contextCompression: settings.contextCompression,
              staticText,
              prior,
              sessionRows: ctx.storage.listSessionBudgetRows(squad.id),
              signal: controller.signal,
              force: topicForce,
              enforceBudget: true,
            }),
          );
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

        const fileSession = createOkbotFileSession(
          ctx.storage.createSessionStore(squad.id, {
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

        const result = await runSquadChat({
          squadName: squad.name,
          squadDescription: squad.description,
          squadSettings: settings.squad,
          members: memberSpecs,
          sessionSummary: sessionSummary || undefined,
          historySearch: historySearchForOwner(ctx.storage, squad.id),
          scheduleManage: scheduleManageForOwner(ctx.storage, squad.id),
          taskProgressManage: async (input) => {
            const result = await taskProgressManageForOwner(ctx.storage, squad.id)(input);
            try {
              ctx.sendRuntimeEvent({
                type: 'tasks_changed',
                botId: squad.id,
                tasks: ctx.storage.loadOpenTasks(squad.id),
              });
            } catch (err) {
              console.error('[okbot] tasks_changed emit failed', err);
            }
            return result;
          },
          taskProgressText: ctx.storage.formatTaskProgressForPrompt(squad.id) || undefined,
          web: settings.web,
          model: modelConfig,
          tools: settings.tools,
          security: settings.security,
          toolRunBudget: guards.budget,
          extraTools: await mcpToolsForRun(settings, guards.budget),
          history: [],
          session: fileSession,
          sessionInputCallback,
          hasVisionInput,
          ownerId: squad.id,
          resourcesDir: ctx.storage.ownerResourcesDir(squad.id),
          computerRoute: computerRouteFor(settings, text, payload.computerId),
          userText: text,
          signal: controller.signal,
          onClearLiveText: () => {
            // Discard pre-tool buffer; do not emit an empty assistant row.
            if (!assistantMsg.content) return;
            assistantMsg.content = '';
          },
          onDelta: (delta) => {
            assistantMsg.content += delta;
            // Non-streaming UI: buffer until done; do not emit token deltas.
          },
          ...attachTraceHooks(guards),
          onToolApprovalRequest: createApprovalWaiter(ctx, {
            ownerId: squad.id,
            messageId: () => assistantId,
            settings,
            signal: controller.signal,
            computerId: payload.computerId,
            userText: text,
            turnId: userMsg.id,
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
              botId: squad.id,
              messageId: assistantId,
              requestId,
              toolName,
              approved,
              output,
            });
          },
          onRunCheckpoint: ({ serializedRunState }) => {
            try {
              ctx.storage.saveRunCheckpoint(squad.id, {
                kind: 'squad',
                runId: turnRunId,
                messageId: assistantId,
                serializedRunState,
                createdAt: new Date().toISOString(),
                computerId: payload.computerId,
                userText: text,
              });
            } catch (err) {
              console.error('[okbot] save squad run checkpoint failed', err);
            }
          },
          onSquadExchange: async ({ kind, memberBotId, memberName, content, usage }) => {
            // Keep pre-tool / between-tool captain narration where it first appeared;
            // later captain deltas create a new bubble after the exchanges.
            await sealCaptainSegment();
            const body = persistAssistantContent(content, modelConfig.showThinking);
            const exchangeMsg: ChatMessage = {
              id: createId('msg'),
              role: 'assistant',
              content:
                kind === 'ask'
                  ? `呼叫 @${memberName}：\n${body}`
                  : body,
              createdAt: new Date().toISOString(),
              speakerBotId: kind === 'ask' ? SQUAD_CAPTAIN_SPEAKER_ID : memberBotId,
              ...(kind === 'reply' && usage ? { usage } : {}),
            };
            try {
              ctx.storage.appendMessage(squad.id, exchangeMsg);
            } catch (err) {
              console.error('[okbot] append squad exchange failed', err);
            }
            // Member usage stays on the exchange bubble only; aggregate under squad.id below.
            emitTurn({
              type: 'assistant_message',
              botId: squad.id,
              message: exchangeMsg,
            });
          },
        });

        // result.content is the full-turn concat — do not paste it onto the
        // current segment after seals (that would duplicate opening at the end).
        // Usage is turn-aggregate (captain + members); no per-segment token splits.
        if (assistantMsg.content.trim()) {
          assistantMsg.content = persistAssistantContent(
            assistantMsg.content,
            modelConfig.showThinking,
          );
          assistantMsg.createdAt = new Date().toISOString();
          if (result.usage) assistantMsg.usage = result.usage;
          if (assistantMsg.content.trim()) {
            await ctx.storage.upsertAssistantMessage(squad.id, assistantMsg, { runId: parallelGate.runId });
          }
        } else if (sealedCaptainSegments === 0 && (result.content || '').trim()) {
          assistantMsg.content = persistAssistantContent(
            result.content,
            modelConfig.showThinking,
          );
          assistantMsg.createdAt = new Date().toISOString();
          if (result.usage) assistantMsg.usage = result.usage;
          if (assistantMsg.content.trim()) {
            await ctx.storage.upsertAssistantMessage(squad.id, assistantMsg, { runId: parallelGate.runId });
          }
        } else if (
          !assistantMsg.content.trim() &&
          sealedCaptainSegments > 0 &&
          lastSealedCaptainId &&
          result.usage &&
          (result.usage.input || result.usage.output || result.usage.cache)
        ) {
          // Final bubble empty after seals — park aggregate usage on last sealed captain.
          const patched = ctx.storage.patchMessage(squad.id, lastSealedCaptainId, {
            usage: result.usage,
          });
          if (patched) {
            emitTurn({
              type: 'assistant_message',
              botId: squad.id,
              message: patched,
            });
          }
        }
        if (result.usage && (result.usage.input || result.usage.output || result.usage.cache)) {
          try {
            // Aggregate under squad only (member slices stay on exchange bubbles).
            ctx.storage.recordUsage(squad.id, result.usage);
            if (payload.apiTokenId) {
              try {
                ctx.storage.recordApiTokenUsage(payload.apiTokenId, squad.id, {
                  messages: 1,
                  tokens: result.usage,
                });
              } catch (err) {
                console.error('[okbot] record api-token usage failed', err);
              }
            }
          } catch (err) {
            console.error('[okbot] record squad usage failed', err);
          }
        }
        const squadTrace = sealMessageTrace(
          guards,
          resolveRunFinishStatus({ aborted: controller.signal.aborted }),
        );
        if (squadTrace) {
          if (assistantMsg.content.trim()) {
            assistantMsg.trace = squadTrace;
            try {
              ctx.storage.patchMessage(squad.id, assistantId, { trace: squadTrace });
            } catch (err) {
              console.error('[okbot] patch squad captain trace failed', err);
            }
          } else if (lastSealedCaptainId) {
            try {
              const patched = ctx.storage.patchMessage(squad.id, lastSealedCaptainId, {
                trace: squadTrace,
              });
              if (patched) {
                emitTurn({
                  type: 'assistant_message',
                  botId: squad.id,
                  message: patched,
                });
              }
            } catch (err) {
              console.error('[okbot] patch squad sealed captain trace failed', err);
            }
          }
        }
        emitTurn({
          type: 'done',
          botId: squad.id,
          messageId: assistantId,
          content: assistantMsg.content,
          usage: result.usage,
          ...(squadTrace ? { trace: squadTrace } : {}),
          ...(controller.signal.aborted ? { aborted: true } : {}),
        });
        // Silent roster description refresh (agents cadence) — next turn / UI reload.
        try {
          if (!controller.signal.aborted) {
            await withOwnerMaintenanceLock(squad.id, () =>
              runThrottledPostTurnSquadDescriptionRefresh({
                storage: ctx.storage,
                squadId: squad.id,
                squadName: squad.name,
                currentDescription: squad.description,
                model: modelConfig,
                userText: text,
                signal: controller.signal,
              }),
            );
          }
        } catch (err) {
          console.error('[okbot] squad description refresh failed', err);
        }
        return { userMessage: userMsg, assistantMessage: assistantMsg };
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
          if (abortTrace) {
            if (assistantMsg.content.trim()) {
              assistantMsg.trace = abortTrace;
              try {
                ctx.storage.patchMessage(squad.id, assistantId, { trace: abortTrace });
              } catch (err) {
                console.error('[okbot] patch aborted squad trace failed', err);
              }
            } else if (lastSealedCaptainId) {
              try {
                ctx.storage.patchMessage(squad.id, lastSealedCaptainId, { trace: abortTrace });
              } catch (err) {
                console.error('[okbot] patch aborted sealed captain trace failed', err);
              }
            }
          }
          emitTurn({
            type: 'done',
            botId: squad.id,
            messageId: assistantId,
            content: assistantMsg.content,
            ...(abortTrace ? { trace: abortTrace } : {}),
            aborted: true,
          });
          return { userMessage: userMsg, assistantMessage: assistantMsg, aborted: true };
        }
        const message = handleRunFailure({
          root: ctx.storage.dataRoot,
          ownerId: squad.id,
          messageId: assistantId,
          phase: 'squadChat',
          err,
          guards,
        });
        console.error('[okbot] squadChat failed', err);
        if (!assistantMsg.content) {
          assistantMsg.content = `错误：${message}`;
          const errTrace = guards.trace.getMessageTrace();
          if (errTrace) assistantMsg.trace = errTrace;
          await ctx.storage.upsertAssistantMessage(squad.id, assistantMsg, { allowRebind: false, runId: parallelGate.runId });
        }
        emitTurn({
          type: 'error',
          botId: squad.id,
          messageId: assistantId,
          error: message,
        });
        throw err;
      } finally {
        guards.dispose();
        unregisterOwnerRun(ctx.abortControllers, squad.id, parallelGate.runId, controller);
        // Only this run's approvals: peer parallel turns keep their own waiters.
        releaseRunApprovals(ctx, squad.id, parkedRequestIds, '已结束');
        try {
          ctx.storage.clearRunCheckpoint(squad.id);
        } catch (err) {
          console.error('[okbot] clear squad run checkpoint failed', err);
        }
      }
      } finally {
        parallelGate.release();
      }
}
