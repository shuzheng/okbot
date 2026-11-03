import {
  createId,
  effectiveModelKey,
  isTransientRunError,
  resolveModelConfig,
  type ChatMessage,
  type QuickChoice,
} from '@okbot/shared';
import {
  runAgentChat,
  resumeAgentChatFromCheckpoint,
  createOkbotFileSession,
  resolveSessionInputCallbackForTurn,
  createMeshFollowUpStripper,
  stripLeadingCommittedInterim,
  type RunAgentChatInput,
  type ResumeAgentChatFromCheckpointInput,
} from '@okbot/agent';
import { normalizeMessageAttachments } from '../../storage/sessionJsonl';
import {
  ensureSessionCompressed,
  mergeCompressForce,
  resolveModelChangeCompressForce,
  resolveTopicCompressForce,
} from '../../storage/sessionCompression';
import {
  extractMemoriesFromFoldedHistory,
  runThrottledPostTurnMaintenance,
} from '../../contextMaterials';
import { onboardingRunExtras, scheduleOnboardingEvolution } from './botOnboarding';
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
  setOwnerRunCheckpointFlush,
  releaseOwnerBusyHold,
  unregisterOwnerRun,
  withOwnerMaintenanceLock,
} from '../ownerRuns';
import { createApprovalWaiter, releaseRunApprovals } from '../approvalWaiter';
import { mcpToolsForRun } from '../../mcpRuntime';
import { buildMeshPeerSpecs, computerRouteFor, createMeshExchangeHandler, skillLookupFor } from '../chatTurnHelpers';
import { historySearchForOwner } from '../historySearchTool';
import { scheduleManageForOwner } from '../scheduleTool';
import { memoryManageForBot } from '../memoryTool';
import { taskProgressManageForOwner } from '../taskProgressTool';
import { noteManageForOwner } from '../noteTool';
import { libraryWriteGateForOwner } from '../sameTopicArtifactGate';
import {
  buildInterruptedRunResumeContext,
  formatRunCheckpointToolDigest,
  type InterruptedRunReason,
} from './softSteerResumeContext';
import {
  clearSoftSteerCheckpointHandoff,
  shouldKeepRunCheckpointOnTurnEnd,
} from '../softSteerGate';
import { applyAssistantSendMessage, applyEmojiOnlyFinalGuard } from '../messageReaction';
import {
  clearLiveAssistantForTools,
  commitLiveAssistantBubble,
  createTurnEmitter,
  emitAssistantMessageBubble,
  persistAssistantContent,
  resolveQuoteFields,
  isQuietChatOrigin,
  mayConsumeKeptRunCheckpoint,
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
      const attachments = normalizeMessageAttachments(payload.attachments, bot.id, {
        dataRoot: ctx.storage.dataRoot,
      });
      const isAutoContinue = isQuietChatOrigin(payload.origin);
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
      let keepForTransientFailure = false;
      const controller = new AbortController();
      registerOwnerRun(ctx.abortControllers, bot.id, parallelGate.runId, controller);
      const turnRunId = parallelGate.runId;
      const clientTurnId = (payload.clientTurnId || '').trim() || undefined;
      const emitTurnRaw = createTurnEmitter(ctx, turnRunId);
      /** Last reply bubble sealed this turn (quick-choice fallback target). */
      let lastSealedAssistant: ChatMessage | null = null;
      const emitTurn: typeof emitTurnRaw = (event) => {
        if (
          event.type === 'assistant_message' &&
          event.botId === bot.id &&
          event.message.role === 'assistant' &&
          !event.message.meshExchange
        ) {
          lastSealedAssistant = event.message;
        }
        emitTurnRaw(event);
      };
      /** Quick-choice card the model asked for this turn (`ask_choice`). */
      let turnChoice: QuickChoice | null = null;
      let turnNoteCard: import('@okbot/shared').NoteCardMeta | null = null;
      const onboarding = onboardingRunExtras(ctx.storage, bot, (choice) => {
        turnChoice = choice;
      });
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
        const soulMd = ctx.storage.readSoulMd(bot.id);
        const skillsText = ctx.storage.formatSkillsForPrompt(bot.id);
        const skillLookup = skillLookupFor(ctx.storage, bot.id);
        const turnGlobalHitIds = new Set<string>();
        const memoriesText = ctx.storage.formatMemoriesForPrompt(bot.id, {
          query: text,
          recordHits: true,
          recordedGlobalHitIds: turnGlobalHitIds,
        });

        // All prior turns (exclude the empty streaming assistant placeholder).
        const allMessages = ctx.storage
          .getMessages(bot.id)
          .filter((m) => m.id !== live.assistantId)
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .filter((m) => !m.meshExchange && !m.meshInterim)
          .filter((m) => (m.id === userMsg.id ? true : Boolean(m.content?.trim())));

        const prior = allMessages.filter((m) => m.id !== userMsg.id);
        const staticText = [soulMd, skillsText, memoriesText, bot.name, bot.description, text]
          .filter(Boolean)
          .join('\n');
        const existingSummary = ctx.storage.readSessionSummary(bot.id);
        const nextModelKey = effectiveModelKey(modelConfig);
        const modelForce = resolveModelChangeCompressForce({
          lastEffectiveModel: ctx.storage.readLastEffectiveModel(bot.id),
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
          const compressed = await withOwnerMaintenanceLock(bot.id, () => ensureSessionCompressed({
            storage: ctx.storage,
            ownerId: bot.id,
            model: modelConfig,
            contextCompression: settings.contextCompression,
            staticText,
            prior,
            sessionRows: ctx.storage.listSessionBudgetRows(bot.id),
            signal: controller.signal,
            force: compressForce,
            enforceBudget: true,
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
          // Seed / advance lastEffectiveModel only after a successful compress phase
          // so a failed forced pass can retry on the next turn.
          try {
            ctx.storage.writeLastEffectiveModel(bot.id, nextModelKey);
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

        const meshPeers = buildMeshPeerSpecs(ctx.storage, bot.id, {
          recordedGlobalHitIds: turnGlobalHitIds,
        });
        const resourcesDir = ctx.storage.ownerResourcesDir(bot.id);
        // Soft-steer handoff OR leftover after manual Stop: read+consume the
        // kept mid-run checkpoint so this turn can resume RunState / inject digest.
        // Soft-steered or composer (unset) consume-once; reaction/schedule/api leave
        // a Stop leftover for a real composer「继续」.
        let steeredCheckpoint: ReturnType<typeof ctx.storage.loadRunCheckpoint> = null;
        let resumeReason: InterruptedRunReason | undefined = payload.softSteered
          ? 'soft_steer'
          : undefined;
        const mayConsumeKeptCheckpoint = mayConsumeKeptRunCheckpoint(
          payload.origin,
          payload.softSteered,
        );
        if (mayConsumeKeptCheckpoint) {
          try {
            const loaded = ctx.storage.loadRunCheckpoint(bot.id);
            if (loaded?.serializedRunState) {
              // Consume-once before resume so a second start cannot double-apply.
              ctx.storage.clearRunCheckpoint(bot.id);
              steeredCheckpoint = loaded;
              if (!resumeReason) resumeReason = 'manual_stop';
            }
          } catch (err) {
            console.error('[okbot] load kept run checkpoint failed', err);
            steeredCheckpoint = null;
          }
          if (payload.softSteered) {
            clearSoftSteerCheckpointHandoff(bot.id);
          }
        }
        const steeredToolDigest = steeredCheckpoint
          ? formatRunCheckpointToolDigest(steeredCheckpoint.serializedRunState)
          : '';
        const resumeContextText = resumeReason
          ? buildInterruptedRunResumeContext(ctx.storage, bot.id, resumeReason, {
              interruptUserText: text,
              runCheckpoint: steeredCheckpoint
                ? {
                    runId: steeredCheckpoint.runId,
                    createdAt: steeredCheckpoint.createdAt,
                    toolDigest: steeredToolDigest,
                    resumedFromRunState: true,
                  }
                : null,
            })
          : undefined;
        const assertLibraryWriteAllowed = libraryWriteGateForOwner(
          ctx.storage,
          bot.id,
          resourcesDir,
        );

        type SoftSteerSharedAgentInput = Omit<
          RunAgentChatInput,
          'history' | 'sessionInputCallback' | 'hasVisionInput' | 'userText'
        >;
        const agentTurnInput: SoftSteerSharedAgentInput = {

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
          noteManage: noteManageForOwner(ctx.storage, bot.id, (card) => {
            turnNoteCard = card;
          }),
          web: settings.web,
          memoriesText,
          sessionSummary: sessionSummary || undefined,
          taskProgressText: ctx.storage.formatTaskProgressForPrompt(bot.id) || undefined,
          ...(resumeContextText ? { resumeContextText } : {}),
          assistantRoleTemplate: settings.instructions?.assistantRoleTemplate,
          isDefaultAssistant: settings.defaultAssistantId === bot.id,
          model: modelConfig,
          tools: settings.tools,
          security: settings.security,
          toolRunBudget: guards.budget,
          extraTools: [
            ...(await mcpToolsForRun(settings, guards.budget)),
            ...onboarding.tools,
          ],
          ...(onboarding.onboardingGuide ? { onboardingGuide: onboarding.onboardingGuide } : {}),
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
          computerRoute: computerRouteFor(settings, text, payload.computerId),
          meshPeers,
          meshSettings: settings.mesh,
          meshDepth: 0,
          meshStack: [bot.id],
          signal: controller.signal,
          transientRetries: settings.watchdog?.transientRetries,
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
          emitAssistantMessage: async (input) => {
            await applyAssistantSendMessage(
              ctx,
              bot.id,
              input,
              async (content) => {
                await emitAssistantMessageBubble(live, content, {
                  ownerId: bot.id,
                  runId: parallelGate.runId,
                  showThinking: modelConfig.showThinking,
                  storage: ctx.storage,
                  emit: emitTurn,
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
          registerCheckpointFlush: (flush) => {
            setOwnerRunCheckpointFlush(bot.id, turnRunId, flush);
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
        };

        const result = steeredCheckpoint
          ? await resumeAgentChatFromCheckpoint({
              ...agentTurnInput,
              serializedRunState: steeredCheckpoint.serializedRunState,
            } satisfies ResumeAgentChatFromCheckpointInput)
          : await runAgentChat({
              ...agentTurnInput,
              history: [], // model history via session
              sessionInputCallback,
              hasVisionInput,
              userText: text,
            } satisfies RunAgentChatInput);
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
          { ownerId: bot.id, storage: ctx.storage },
        );
        live.assistantMsg.content = await applyEmojiOnlyFinalGuard(
          ctx,
          bot.id,
          live.assistantMsg.content,
          {
            reactedEmojisThisTurn: live.reactedEmojisThisTurn,
            targetUserMessageId: userMsg.id,
          },
        );
        if (result.usage) live.assistantMsg.usage = result.usage;
        // Quick-choice + note preview cards: attach to the final reply when it has
        // content; otherwise merge both onto the last bubble sealed this turn.
        // (Independent attach — previously choice sealed-fallback was nested under
        // the noteCard else-chain and got dropped when both needed fallback.)
        const choice = turnChoice as QuickChoice | null;
        const noteCard = turnNoteCard;
        const liveHasContent = !!(live.assistantMsg.content || '').trim();
        if (liveHasContent) {
          if (choice) live.assistantMsg.choice = choice;
          if (noteCard) live.assistantMsg.noteCard = noteCard;
        } else if (
          (choice || noteCard) &&
          lastSealedAssistant &&
          !controller.signal.aborted
        ) {
          const target: ChatMessage = { ...(lastSealedAssistant as ChatMessage) };
          if (choice) target.choice = choice;
          if (noteCard) target.noteCard = noteCard;
          try {
            await ctx.storage.upsertAssistantMessage(bot.id, target, {
              allowRebind: false,
              runId: parallelGate.runId,
            });
            emitTurn({ type: 'assistant_message', botId: bot.id, message: target });
          } catch (err) {
            console.error('[okbot] attach choice/note card failed', err);
          }
        } else if ((noteCard || choice) && !controller.signal.aborted) {
          // manage_note / ask_choice succeeded but final text empty and nothing sealed —
          // still park the card(s) on this turn's assistant row so UI can show them.
          if (noteCard) live.assistantMsg.noteCard = noteCard;
          if (choice) live.assistantMsg.choice = choice;
        }
        const botTrace = sealMessageTrace(
          guards,
          resolveRunFinishStatus({ aborted: controller.signal.aborted }),
        );
        if (botTrace) live.assistantMsg.trace = botTrace;
        // Empty + no session row for this streaming id: skip upsert. Abort during
        // HITL clears streamed text; unconditional upsert used to rebind/wipe the
        // previous assistant turn (see FileStorage.upsertAssistantMessage).
        // Keep card-only rows (noteCard and/or choice) so desktop does not drop them.
        if (
          (live.assistantMsg.content || '').trim() ||
          live.assistantMsg.noteCard ||
          live.assistantMsg.choice
        ) {
          await ctx.storage.upsertAssistantMessage(bot.id, live.assistantMsg, { runId: parallelGate.runId });
        }
        if (result.usage && (result.usage.input || result.usage.output || result.usage.cache)) {
          try {
            ctx.storage.recordUsage(bot.id, result.usage, { modelId: modelConfig.model });
            if (payload.apiTokenId) {
              try {
                ctx.storage.recordApiTokenUsage(payload.apiTokenId, bot.id, {
                  messages: 1,
                  tokens: result.usage,
                });
              } catch (err) {
                console.error('[okbot] record api-token usage failed', err);
              }
            }
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
          ...(live.assistantMsg.choice ? { choice: live.assistantMsg.choice } : {}),
          ...(live.assistantMsg.noteCard ? { noteCard: live.assistantMsg.noteCard } : {}),
          ...(controller.signal.aborted ? { aborted: true } : {}),
        });
        // New-assistant onboarding: every answered step evolves SOUL.md + description
        // in the background (never blocks this reply or the next turn); onboarding
        // completes after the model says done and that final evolution ran.
        const onboardingOpen =
          ctx.storage.listBots().find((b) => b.id === bot.id)?.onboardingComplete === false;
        if (onboardingOpen) {
          if (!isAutoContinue && !controller.signal.aborted) {
            void scheduleOnboardingEvolution(ctx.storage, bot.id, text);
          }
        } else {
          // Silent SOUL.md / skills / memory maintenance (throttled) — next turn reloads from disk.
          try {
            if (!controller.signal.aborted) {
              await withOwnerMaintenanceLock(bot.id, () =>
                runThrottledPostTurnMaintenance({
                  storage: ctx.storage,
                  botId: bot.id,
                  botName: bot.name,
                  model: modelConfig,
                  soulMd,
                  userText: text,
                  signal: controller.signal,
                }),
              );
            }
          } catch (err) {
            console.error('[okbot] SOUL.md/skills/memory refresh failed', err);
          }
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
        if (isTransientRunError(err)) {
          keepForTransientFailure = true;
        }
        const message = handleRunFailure({
          root: ctx.storage.dataRoot,
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
        // Clear mid-run checkpoint on successful finish / softSteered fail-before-consume.
        // Soft-steer abort, manual Stop, and exhausted transient failures keep it.
        // A softSteered replacement that fails before consume must abandon handoff
        // so later successful finishes do not keep a sticky ckpt.
        // Quiet reaction (etc.) successful finish must not wipe an unconsumed Stop leftover
        // (foreign runId still on disk) — composer「继续」still needs it.
        // Crash (no finally) also leaves it for cold resume / Watchdog.
        try {
          const aborted = controller.signal.aborted;
          let existingCheckpointRunId: string | null | undefined;
          try {
            existingCheckpointRunId = ctx.storage.loadRunCheckpoint(bot.id)?.runId ?? null;
          } catch {
            existingCheckpointRunId = undefined;
          }
          if (
            shouldKeepRunCheckpointOnTurnEnd({
              ownerId: bot.id,
              softSteered: payload.softSteered,
              aborted,
              transientFailure: keepForTransientFailure,
              currentRunId: turnRunId,
              existingCheckpointRunId,
            })
          ) {
            // keep run-checkpoint.json for soft-steer handoff or post-Stop continue
          } else {
            if (payload.softSteered) {
              clearSoftSteerCheckpointHandoff(bot.id);
            }
            ctx.storage.clearRunCheckpoint(bot.id);
          }
        } catch (err) {
          console.error('[okbot] clear run checkpoint failed', err);
        }
      }
      } finally {
        parallelGate.release();
      }
}
