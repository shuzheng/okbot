import { createRequire } from 'node:module';
import type { IpcMain } from 'electron';

/** Loaded only when registering IPC, so `okbot serve` can import chat turns under plain Node. */
function loadIpcMain(): IpcMain {
  const require = createRequire(import.meta.url);
  return (require('electron') as { ipcMain: IpcMain }).ipcMain;
}

import {
  IpcChannels,
  createId,
  clipQuotePreview,
  formatUserTextWithQuote,
  resolveModelConfig,
  SQUAD_CAPTAIN_SPEAKER_ID,
  type ChatMessage,
} from '@okbot/shared';
import {
  runAgentChat,
  runSquadChat,
  resumeAgentChatAfterHitl,
  createOkbotFileSession,
  quoteSessionInputCallback,
  resolveSessionInputCallbackForTurn,
  stripImageLinesFromAttachedBlock,
} from '@okbot/agent';
import type { IpcContext } from './context';
import { isSquadOwnerId } from '../storage/ids';
import { normalizeMessageAttachments } from '../storage/sessionJsonl';
import {
  ensureSessionCompressed,
  resolveTopicCompressForce,
} from '../storage/sessionCompression';
import {
  extractMemoriesFromFoldedHistory,
  rememberSummaryFacts,
  runThrottledPostTurnMaintenance,
} from './chatMaintenance';
import {
  attachTraceHooks,
  createRunGuards,
  handleRunFailure,
  isAbortLikeError,
  resolveRunFinishStatus,
  sealMessageTrace,
} from './runGuards';
import {
  acquireParallelGate,
  acquireRunSlot,
  ownerHasRuns,
  registerOwnerRun,
  unregisterOwnerRun,
  withOwnerMaintenanceLock,
} from './ownerRuns';
import { abortChatOwner, resolveLiveToolApproval } from './chatControl';
import { createApprovalWaiter, releaseRunApprovals } from './approvalWaiter';
import { mcpToolsForRun } from '../mcpRuntime';
import { buildSquadMemberSpecs, computerRouteFor, skillLookupFor } from './chatTurnHelpers';
import { historySearchForOwner } from './historySearchTool';
import { scheduleManageForOwner } from './scheduleTool';
import { resumeSquadAfterRestart } from './squadResume';


function resolveQuoteFields(
  storage: IpcContext['storage'],
  ownerId: string,
  quoteMessageId: string | undefined,
  body: string,
): {
  userMsgExtra: Pick<ChatMessage, 'quoteMessageId' | 'quotePreview'>;
  modelText: string;
  sessionInputCallback?: ReturnType<typeof quoteSessionInputCallback>;
} {
  const qid = (quoteMessageId || '').trim();
  if (!qid) return { userMsgExtra: {}, modelText: body };
  const quoted = storage.getMessageById(ownerId, qid);
  const quotedRaw = (quoted?.content || '').trim();
  if (!quotedRaw) return { userMsgExtra: {}, modelText: body };
  // Image paths in a quoted [Attached] block must not leak into the preview or model text.
  const quotedContent = stripImageLinesFromAttachedBlock(quotedRaw).trim() || '（图片）';
  const preview = clipQuotePreview(quotedContent);
  const modelText = formatUserTextWithQuote(body, quotedContent);
  return {
    userMsgExtra: { quoteMessageId: qid, quotePreview: preview },
    modelText,
    sessionInputCallback: quoteSessionInputCallback(modelText),
  };
}

/**
 * Persist assistant text as-is. showThinking only affects renderer projection;
 * stripping on write used to irreversibly truncate when parseThink misfired.
 */

function persistAssistantContent(content: string, _showThinking: boolean): string {
  return content;
}

export async function startChatTurn(
  ctx: IpcContext,
  payload: {
    botId?: string;
    squadId?: string;
    text: string;
    quoteMessageId?: string;
    attachments?: ChatMessage['attachments'];
    /**
     * Optional turn default (HTTP API). Desktop chat omits this.
     * A computer named in `text` still wins; several names are routed per tool call.
     */
    computerId?: string;
    /** Renderer-correlated id for parallel task strip (optional). */
    clientTurnId?: string;
  },
): Promise<{
  userMessage: ChatMessage;
  assistantMessage?: ChatMessage;
  superseded?: boolean;
  aborted?: boolean;
}> {
      const text = (payload.text ?? '').trim();
      if (!text) throw new Error('请输入内容');

      if (payload.squadId) {
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
        const emitTurn = (event: Parameters<IpcContext['sendRuntimeEvent']>[0]) => {
          if (
            event.type === 'skills_changed' ||
            event.type === 'sessions_changed' ||
            event.type === 'turn_started'
          ) {
            ctx.sendRuntimeEvent(event);
            return;
          }
          ctx.sendRuntimeEvent({ ...event, runId: turnRunId } as typeof event);
        };
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
          ownerDir: ctx.storage.ownerDir(squad.id),
          toolRun: settings.toolRun,
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
            .map((m) => `${m.name}（${m.role || '成员'}）`)
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
              if (!assistantMsg.content) return;
              assistantMsg.content = '';
              emitTurn({
                type: 'assistant_message',
                botId: squad.id,
                message: { ...assistantMsg },
              });
            },
            onDelta: (delta) => {
              assistantMsg.content += delta;
              emitTurn({
                type: 'delta',
                botId: squad.id,
                messageId: assistantId,
                delta,
              });
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
                    ? `呼叫「${memberName}」：\n${body}`
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
            } catch (err) {
              console.error('[okbot] record squad usage failed', err);
            }
          }
          guards.throwIfBroken();
          const squadTrace = sealMessageTrace(
            guards,
            resolveRunFinishStatus({
              aborted: controller.signal.aborted,
              breakReason: guards.budget.getBreakReason(),
            }),
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
          return { userMessage: userMsg, assistantMessage: assistantMsg };
        } catch (err) {
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
            root: ctx.storage.root,
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
        }
        } finally {
          parallelGate.release();
        }
      }

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

      const assistantId = createId('msg');
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      };
      // Do not persist empty assistant placeholder — Runner/Session writes the
      // real assistant (+ tool) items; UI streams against this ephemeral id.

      /** Approvals parked by this run; only these are released at the end. */
      const parkedRequestIds = new Set<string>();
      const controller = new AbortController();
      registerOwnerRun(ctx.abortControllers, bot.id, parallelGate.runId, controller);
      const turnRunId = parallelGate.runId;
      const clientTurnId = (payload.clientTurnId || '').trim() || undefined;
      const emitTurn = (event: Parameters<IpcContext['sendRuntimeEvent']>[0]) => {
        if (event.type === 'skills_changed' || event.type === 'sessions_changed') {
          ctx.sendRuntimeEvent(event);
          return;
        }
        if (event.type === 'turn_started') {
          ctx.sendRuntimeEvent(event);
          return;
        }
        ctx.sendRuntimeEvent({ ...event, runId: turnRunId } as typeof event);
      };
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
        ownerDir: ctx.storage.ownerDir(bot.id),
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
          onDelta: (delta) => {
            assistantMsg.content += delta;
            emitTurn({
              type: 'delta',
              botId: bot.id,
              messageId: assistantId,
              delta,
            });
          },
          ...attachTraceHooks(guards),
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
        const finalized = (result.content || '').trim()
          ? result.content
          : assistantMsg.content;
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

export async function respondToToolApproval(
  ctx: IpcContext,
  payload: { requestId: string; approved: boolean; message?: string },
): Promise<{ ok: boolean; error?: string; resumed?: boolean; aborted?: boolean }> {

      const decision = {
        approved: Boolean(payload.approved),
        message: payload.message,
      };

      const live = resolveLiveToolApproval(ctx, payload);
      if (live) return live;

      // Cold start: resume from disk-persisted RunState.
      const diskEntries = ctx.storage.listAllPendingHitl();
      const disk = diskEntries.find((p) => p.requestId === payload.requestId);
      if (!disk) return { ok: false, error: '没有待处理的工具审批' };

      // disk.botId is the chat owner (bot or squad). Squad cold-resume needs the
      // captain agent graph; mis-looking-up via listBots used to wipe squad pending.
      if (isSquadOwnerId(disk.botId)) {
        const squad = ctx.storage.listSquads().find((s) => s.id === disk.botId);
        if (!squad) {
          ctx.storage.clearPendingHitl(disk.botId);
          return { ok: false, error: '小队不存在' };
        }
        return resumeSquadAfterRestart(ctx, squad, disk, decision);
      }

      const bot = ctx.storage.listBots().find((b) => b.id === disk.botId);
      if (!bot) {
        ctx.storage.clearPendingHitl(disk.botId);
        return { ok: false, error: '助手不存在' };
      }

      if (ownerHasRuns(ctx.abortControllers, bot.id)) {
        return { ok: false, error: '该助手已有进行中的任务' };
      }

      const runSlot = await acquireRunSlot(bot.id);
      // Re-check after waiting on the exclusive chain (a chat turn may have started).
      if (ownerHasRuns(ctx.abortControllers, bot.id)) {
        runSlot.release();
        return { ok: false, error: '该助手已有进行中的任务' };
      }

      const assistantId = disk.messageId;
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      };
      const controller = new AbortController();
      const resumeRunId = createId('run');
      registerOwnerRun(ctx.abortControllers, bot.id, resumeRunId, controller);
      // Only this card — sibling cold-pending approvals for the same owner must survive.
      ctx.storage.clearPendingHitlRequest(bot.id, disk.requestId);

      const settings = ctx.storage.getSettings();
      const modelConfig = resolveModelConfig(settings.model, { providerId: bot.providerId, modelId: bot.modelId });
      const guards = createRunGuards({
        ownerDir: ctx.storage.ownerDir(bot.id),
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
          onDelta: (delta) => {
            assistantMsg.content += delta;
            ctx.sendRuntimeEvent({
              type: 'delta',
              botId: bot.id,
              messageId: assistantId,
              delta,
            });
          },
          ...attachTraceHooks(guards),
          onToolApprovalRequest: createApprovalWaiter(ctx, {
            ownerId: bot.id,
            messageId: () => assistantId,
            settings,
            signal: controller.signal,
            computerId: disk.computerId,
            userText: disk.userText,
            runId: resumeRunId,
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
        const finalized = (result.content || '').trim()
          ? result.content
          : assistantMsg.content;
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
        ctx.rejectPendingApprovalsForBot(bot.id, '已结束');
        runSlot.release();
      }
}

/**
 * Manual Summary+Buffer: bypass ratio threshold.
 * mode=compress → keep recent buffer per settings; mode=newTopic → cover all prior (keep=0).
 * UI transcript (session.jsonl) is never trimmed. Disabled while owner is streaming.
 */
export async function compressSessionNow(
  ctx: IpcContext,
  payload: { botId?: string; squadId?: string; mode: 'compress' | 'newTopic' },
): Promise<{
  ok: boolean;
  didCompress?: boolean;
  coveredThroughId?: string | null;
  error?: string;
}> {
  const mode = payload?.mode === 'newTopic' ? 'newTopic' : 'compress';
  const botId = typeof payload?.botId === 'string' ? payload.botId.trim() : '';
  const squadId = typeof payload?.squadId === 'string' ? payload.squadId.trim() : '';
  if ((botId && squadId) || (!botId && !squadId)) {
    return { ok: false, error: 'invalid_owner' };
  }

  const ownerId = botId || squadId;
  if (ownerHasRuns(ctx.abortControllers, ownerId)) {
    return { ok: false, error: 'busy' };
  }

  const settings = ctx.storage.getSettings();
  let modelConfig;
  let staticText: string;

  if (botId) {
    const bot = ctx.storage.listBots().find((b) => b.id === botId);
    if (!bot) return { ok: false, error: 'not_found' };
    modelConfig = resolveModelConfig(settings.model, {
      providerId: bot.providerId,
      modelId: bot.modelId,
    });
    const agentsMd = ctx.storage.readAgentsMd(bot.id);
    const skillsText = ctx.storage.formatSkillsForPrompt(bot.id);
    const memoriesText = ctx.storage.formatMemoriesForPrompt(bot.id);
    staticText = [agentsMd, skillsText, memoriesText, bot.name, bot.description]
      .filter(Boolean)
      .join('\n');
  } else {
    const squad = ctx.storage.listSquads().find((s) => s.id === squadId);
    if (!squad) return { ok: false, error: 'not_found' };
    modelConfig = resolveModelConfig(settings.model, {
      providerId: squad.providerId,
      modelId: squad.modelId,
    });
    const bots = ctx.storage.listBots();
    const rosterText = squad.members
      .map((m) => {
        const b = bots.find((x) => x.id === m.botId);
        return b ? `${b.name}（${m.role || '成员'}）` : '';
      })
      .filter(Boolean)
      .join('、');
    staticText = [
      squad.name,
      squad.description,
      settings.squad?.captainPersona,
      settings.squad?.playbook,
      rosterText,
    ]
      .filter(Boolean)
      .join('\n');
  }

  const prior = ctx.storage
    .getMessages(ownerId)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => Boolean(m.content?.trim()));

  if (!prior.length) {
    return { ok: true, didCompress: false, coveredThroughId: null };
  }

  const controller = new AbortController();
  const compressRunId = createId('run');
  // Register so chatStart/chatAbort treat compress as busy.
  registerOwnerRun(ctx.abortControllers, ownerId, compressRunId, controller);
  try {
    const { summaryState, didCompress } = await withOwnerMaintenanceLock(ownerId, () =>
      ensureSessionCompressed({
        storage: ctx.storage,
        ownerId,
        model: modelConfig,
        contextCompression: settings.contextCompression,
        staticText,
        prior,
        sessionRows: ctx.storage.listSessionBudgetRows(ownerId),
        signal: controller.signal,
        force: mode,
      }),
    );
    return {
      ok: true,
      didCompress,
      coveredThroughId: summaryState?.coveredThroughId ?? null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[okbot] compressSessionNow failed', err);
    return { ok: false, error: msg || 'compress_failed' };
  } finally {
    unregisterOwnerRun(ctx.abortControllers, ownerId, compressRunId, controller);
  }
}

export function registerChatIpc(ctx: IpcContext): void {
  const ipcMain = loadIpcMain();
  ipcMain.handle(
    IpcChannels.toolRespond,
    (
      _e,
      payload: { requestId: string; approved: boolean; message?: string },
    ) => respondToToolApproval(ctx, payload),
  );

  ipcMain.handle(
    IpcChannels.chatStart,
    async (
      _e,
      payload: {
        botId?: string;
        squadId?: string;
        text: string;
        quoteMessageId?: string;
        attachments?: ChatMessage['attachments'];
      },
    ) => startChatTurn(ctx, payload),
  );

  ipcMain.handle(IpcChannels.chatAbort, (_e, botId: string) => abortChatOwner(ctx, botId));

  ipcMain.handle(IpcChannels.compressSessionNow, (_e, payload) =>
    compressSessionNow(ctx, payload),
  );
}
