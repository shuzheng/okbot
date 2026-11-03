import {
  createId,
  effectiveModelKey,
  isTransientRunError,
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
  mergeCompressForce,
  resolveModelChangeCompressForce,
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
  setOwnerRunCheckpointFlush,
  unregisterOwnerRun,
  withOwnerMaintenanceLock,
} from '../ownerRuns';
import {
  shouldKeepRunCheckpointOnTurnEnd,
} from '../softSteerGate';
import { createApprovalWaiter, releaseRunApprovals } from '../approvalWaiter';
import { mcpToolsForRun } from '../../mcpRuntime';
import { buildSquadMemberSpecs, computerRouteFor } from '../chatTurnHelpers';
import { historySearchForOwner } from '../historySearchTool';
import { scheduleManageForOwner } from '../scheduleTool';
import { taskProgressManageForOwner } from '../taskProgressTool';
import { noteManageForOwner } from '../noteTool';
import { libraryWriteGateForOwner } from '../sameTopicArtifactGate';
import { memoryManageForSquad } from '../memoryTool';
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
      const attachments = normalizeMessageAttachments(payload.attachments, squad.id, {
        dataRoot: ctx.storage.dataRoot,
      });
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
      let keepForTransientFailure = false;

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
          { ownerId: squad.id, storage: ctx.storage },
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
        const memberSpecs = buildSquadMemberSpecs(ctx.storage, squad, {
          query: text,
          recordedGlobalHitIds: new Set<string>(),
        });

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
        const nextModelKey = effectiveModelKey(modelConfig);
        const modelForce = resolveModelChangeCompressForce({
          lastEffectiveModel: ctx.storage.readLastEffectiveModel(squad.id),
          nextEffectiveModel: nextModelKey,
        });
        const topicForce = await resolveTopicCompressForce({
          model: modelConfig,
          contextCompression: settings.contextCompression,
          prior,
          sessionSummary: existingSummary?.summary,
          coveredThroughId: existingSummary?.coveredThroughId,
          newUserText: text,
          signal: controller.signal,
        });
        const compressForce = mergeCompressForce(topicForce, modelForce);
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
              force: compressForce,
              enforceBudget: true,
            }),
          );
          sessionSummary = compressed.sessionSummary;
          summaryState = compressed.summaryState;
          omitRecordIds = compressed.omitRecordIds;
          try {
            ctx.storage.writeLastEffectiveModel(squad.id, nextModelKey);
          } catch (err) {
            console.error('[okbot] write lastEffectiveModel failed', err);
          }
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

        let turnNoteCard: import('@okbot/shared').NoteCardMeta | null = null;
        const resourcesDir = ctx.storage.ownerResourcesDir(squad.id);
        const assertLibraryWriteAllowed = libraryWriteGateForOwner(
          ctx.storage,
          squad.id,
          resourcesDir,
        );
        const result = await runSquadChat({
          squadName: squad.name,
          squadDescription: squad.description,
          squadSettings: settings.squad,
          members: memberSpecs,
          sessionSummary: sessionSummary || undefined,
          historySearch: historySearchForOwner(ctx.storage, squad.id),
          scheduleManage: scheduleManageForOwner(ctx.storage, squad.id),
          memoryManage: memoryManageForSquad(ctx.storage),
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
          noteManage: noteManageForOwner(ctx.storage, squad.id, (card) => {
            turnNoteCard = card;
          }),
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
          computerRoute: computerRouteFor(settings, text, payload.computerId),
          userText: text,
          signal: controller.signal,
          transientRetries: settings.watchdog?.transientRetries,
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
          registerCheckpointFlush: (flush) => {
            setOwnerRunCheckpointFlush(squad.id, turnRunId, flush);
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
            const body = persistAssistantContent(content, modelConfig.showThinking, {
              ownerId: squad.id,
              storage: ctx.storage,
            });
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
              return;
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
            { ownerId: squad.id, storage: ctx.storage },
          );
          assistantMsg.createdAt = new Date().toISOString();
          if (result.usage) assistantMsg.usage = result.usage;
          if (assistantMsg.content.trim()) {
            if (turnNoteCard) assistantMsg.noteCard = turnNoteCard;
            await ctx.storage.upsertAssistantMessage(squad.id, assistantMsg, { runId: parallelGate.runId });
          }
        } else if (sealedCaptainSegments === 0 && (result.content || '').trim()) {
          assistantMsg.content = persistAssistantContent(
            result.content,
            modelConfig.showThinking,
            { ownerId: squad.id, storage: ctx.storage },
          );
          assistantMsg.createdAt = new Date().toISOString();
          if (result.usage) assistantMsg.usage = result.usage;
          if (assistantMsg.content.trim()) {
            if (turnNoteCard) assistantMsg.noteCard = turnNoteCard;
            await ctx.storage.upsertAssistantMessage(squad.id, assistantMsg, { runId: parallelGate.runId });
          }
        } else if (
          !assistantMsg.content.trim() &&
          sealedCaptainSegments > 0 &&
          lastSealedCaptainId
        ) {
          // Final bubble empty after seals — park aggregate usage and/or noteCard
          // on last sealed captain. noteCard must not depend on the usage-only path
          // (align with startBotTurn sealed fallback for manage_note preview cards).
          const patch: Partial<ChatMessage> = {};
          if (
            result.usage &&
            (result.usage.input || result.usage.output || result.usage.cache)
          ) {
            patch.usage = result.usage;
          }
          if (turnNoteCard && !controller.signal.aborted) {
            patch.noteCard = turnNoteCard;
          }
          if (Object.keys(patch).length > 0) {
            const patched = ctx.storage.patchMessage(squad.id, lastSealedCaptainId, patch);
            if (patched) {
              emitTurn({
                type: 'assistant_message',
                botId: squad.id,
                message: patched,
              });
            }
          }
        } else if (
          !assistantMsg.content.trim() &&
          sealedCaptainSegments === 0 &&
          turnNoteCard &&
          !controller.signal.aborted
        ) {
          // manage_note succeeded but final text empty and nothing sealed — still
          // park the preview card on this turn's captain row so UI can show it
          // (align with startBotTurn empty-text noteCard branch).
          assistantMsg.noteCard = turnNoteCard;
          assistantMsg.createdAt = new Date().toISOString();
          if (result.usage) assistantMsg.usage = result.usage;
          await ctx.storage.upsertAssistantMessage(squad.id, assistantMsg, {
            runId: parallelGate.runId,
          });
        }
        if (result.usage && (result.usage.input || result.usage.output || result.usage.cache)) {
          try {
            // Aggregate under squad only (member slices stay on exchange bubbles).
            ctx.storage.recordUsage(squad.id, result.usage, { modelId: modelConfig.model });
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
          ...(assistantMsg.noteCard ? { noteCard: assistantMsg.noteCard } : {}),
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
            ...(assistantMsg.noteCard ? { noteCard: assistantMsg.noteCard } : {}),
            aborted: true,
          });
          return { userMessage: userMsg, assistantMessage: assistantMsg, aborted: true };
        }
        if (isTransientRunError(err)) {
          keepForTransientFailure = true;
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
          const aborted = controller.signal.aborted;
          let existingCheckpointRunId: string | null | undefined;
          try {
            existingCheckpointRunId = ctx.storage.loadRunCheckpoint(squad.id)?.runId ?? null;
          } catch {
            existingCheckpointRunId = undefined;
          }
          if (
            !shouldKeepRunCheckpointOnTurnEnd({
              ownerId: squad.id,
              aborted,
              transientFailure: keepForTransientFailure,
              currentRunId: parallelGate.runId,
              existingCheckpointRunId,
            })
          ) {
            ctx.storage.clearRunCheckpoint(squad.id);
          }
        } catch (err) {
          console.error('[okbot] clear squad run checkpoint failed', err);
        }
      }
      } finally {
        parallelGate.release();
      }
}
