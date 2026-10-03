import { ipcMain } from 'electron';
import {
  IpcChannels,
  createId,
  clipQuotePreview,
  formatUserTextWithQuote,
  resolveModelConfig,
  resolveAutoApproval,
  SQUAD_CAPTAIN_SPEAKER_ID,
  type ChatMessage,
} from '@okbot/shared';
import {
  runAgentChat,
  runSquadChat,
  resumeAgentChatAfterHitl,
  refreshAgentsMd,
  refreshBotSkills,
  refreshMemories,
  createOkbotFileSession,
  quoteSessionInputCallback,
  resolveSessionInputCallbackForTurn,
  stripImageLinesFromAttachedBlock,
  type SkillLookup,
  type ComputerRoute,
} from '@okbot/agent';
import type { IpcContext } from './context';
import { isSquadOwnerId } from '../storage/ids';
import { normalizeMessageAttachments } from '../storage/sessionJsonl';
import {
  ensureSessionCompressed,
  resolveTopicCompressForce,
} from '../storage/sessionCompression';
import {
  createRunGuards,
  handleRunFailure,
  isAbortLikeError,
  resolveRunFinishStatus,
} from './runGuards';
import {
  acquireRunSlot,
  acquireSteerGate,
} from './steerGate';
import { abortChatOwner, resolveLiveToolApproval } from './chatControl';

/** Bind `read_skill` to this bot's local + enabled-global skills. */
function skillLookupFor(storage: IpcContext['storage'], botId: string): SkillLookup {
  return (slug) => {
    const hit = storage.resolveEnabledSkill(botId, slug);
    if (!hit) return null;
    return {
      slug: hit.slug,
      name: hit.name,
      description: hit.description,
      body: hit.body,
      global: hit.source === 'global',
    };
  };
}

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

function computerRouteFor(
  settings: { defaultComputerId?: string; computers?: ComputerRoute['computers'] },
  userText?: string,
  turnComputerId?: string,
): ComputerRoute {
  return {
    defaultComputerId: settings.defaultComputerId,
    turnComputerId,
    computers: settings.computers,
    userText,
  };
}

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
        // Persist steer text before abort+restart so rapid sends keep full history.
        ctx.storage.appendMessage(squad.id, userMsg);
        ctx.storage.touchSquad(squad.id);

        const steerGate = await acquireSteerGate(ctx, squad.id);
        try {
          if (!steerGate.proceed) {
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

        const controller = new AbortController();
        ctx.abortControllers.set(squad.id, controller);
        const settings = ctx.storage.getSettings();
        const modelConfig = resolveModelConfig(settings.model, { providerId: squad.providerId, modelId: squad.modelId });
        const guards = createRunGuards({
          ownerDir: ctx.storage.ownerDir(squad.id),
          toolRun: settings.toolRun,
          controller,
        });

        /** Persist captain text streamed so far, then rotate to a new bubble id. */
        const sealCaptainSegment = () => {
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
          const memberSpecs = squad.members.map((m) => {
            const bot = byId.get(m.botId)!;
            return {
              botId: bot.id,
              name: bot.name,
              description: bot.description,
              role: m.role,
              agentsMd: ctx.storage.readAgentsMd(bot.id),
              skillsText: ctx.storage.formatSkillsForPrompt(bot.id),
              skillLookup: skillLookupFor(ctx.storage, bot.id),
              memoriesText: ctx.storage.formatMemoriesForPrompt(bot.id),
            };
          });

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
          const { sessionSummary, summaryState } = await ensureSessionCompressed({
            storage: ctx.storage,
            ownerId: squad.id,
            model: modelConfig,
            contextCompression: settings.contextCompression,
            staticText,
            prior,
            signal: controller.signal,
            force: topicForce,
          });

          ctx.sendRuntimeEvent({ type: 'user_message', botId: squad.id, message: userMsg });

          const fileSession = createOkbotFileSession(
            ctx.storage.createSessionStore(squad.id, {
              afterMessageId: summaryState?.coveredThroughId ?? null,
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
            model: modelConfig,
            tools: settings.tools,
            security: settings.security,
            toolRunBudget: guards.budget,
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
              ctx.sendRuntimeEvent({
                type: 'assistant_message',
                botId: squad.id,
                message: { ...assistantMsg },
              });
            },
            onDelta: (delta) => {
              assistantMsg.content += delta;
              ctx.sendRuntimeEvent({
                type: 'delta',
                botId: squad.id,
                messageId: assistantId,
                delta,
              });
            },
            onToolApprovalRequest: ({ requestId, toolName, arguments: toolArgs, serializedRunState }) =>
              new Promise<{ approved: boolean; message?: string }>((resolve) => {
                if (controller.signal.aborted) {
                  resolve({ approved: false, message: '已取消' });
                  return;
                }
                const decision = resolveAutoApproval(
                  settings.autoApprovalEnabled === true,
                  settings.autoApprovalRules,
                  toolName,
                  toolArgs,
                );
                if (decision === 'allow') {
                  resolve({ approved: true, message: '自动审批规则已允许' });
                  return;
                }
                ctx.pendingToolApprovals.set(requestId, {
                  computerId: payload.computerId,
                  botId: squad.id,
                  messageId: assistantId,
                  toolName,
                  arguments: toolArgs,
                  resolve,
                });
                if (serializedRunState) {
                  try {
                    ctx.storage.savePendingHitl(squad.id, {
                      computerId: payload.computerId,
                      userText: text,
                      v: 1,
                      requestId,
                      messageId: assistantId,
                      toolName,
                      arguments: toolArgs,
                      serializedRunState,
                      createdAt: new Date().toISOString(),
                    });
                  } catch (err) {
                    console.error('[okbot] save pending hitl failed', err);
                  }
                }
                ctx.sendRuntimeEvent({
                  type: 'tool_request',
                  botId: squad.id,
                  messageId: assistantId,
                  requestId,
                  toolName,
                  arguments: toolArgs,
                });
                const onAbort = () => {
                  if (!ctx.pendingToolApprovals.has(requestId)) return;
                  ctx.pendingToolApprovals.delete(requestId);
                  ctx.storage.clearPendingHitl(squad.id);
                  resolve({ approved: false, message: '已取消' });
                };
                controller.signal.addEventListener('abort', onAbort, { once: true });
              }),
            onToolResult: ({ requestId, toolName, approved, output }) => {
              if (!approved) {
                guards.budget.recordRejection(toolName, {}, output);
              }
              ctx.sendRuntimeEvent({
                type: 'tool_result',
                botId: squad.id,
                messageId: assistantId,
                requestId,
                toolName,
                approved,
                output,
              });
            },
            onSquadExchange: ({ kind, memberBotId, memberName, content, usage }) => {
              // Keep pre-tool / between-tool captain narration where it first appeared;
              // later captain deltas create a new bubble after the exchanges.
              sealCaptainSegment();
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
              ctx.sendRuntimeEvent({
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
              ctx.storage.upsertAssistantMessage(squad.id, assistantMsg);
            }
          } else if (sealedCaptainSegments === 0 && (result.content || '').trim()) {
            assistantMsg.content = persistAssistantContent(
              result.content,
              modelConfig.showThinking,
            );
            assistantMsg.createdAt = new Date().toISOString();
            if (result.usage) assistantMsg.usage = result.usage;
            if (assistantMsg.content.trim()) {
              ctx.storage.upsertAssistantMessage(squad.id, assistantMsg);
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
              ctx.sendRuntimeEvent({
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
          ctx.sendRuntimeEvent({
            type: 'done',
            botId: squad.id,
            messageId: assistantId,
            content: assistantMsg.content,
            usage: result.usage,
            ...(controller.signal.aborted ? { aborted: true } : {}),
          });
          guards.finish(
            resolveRunFinishStatus({
              aborted: controller.signal.aborted,
              breakReason: guards.budget.getBreakReason(),
            }),
          );
          return { userMessage: userMsg, assistantMessage: assistantMsg };
        } catch (err) {
          if (
            !guards.budget.getBreakReason() &&
            (controller.signal.aborted || isAbortLikeError(err))
          ) {
            guards.finish(
              resolveRunFinishStatus({
                aborted: true,
                breakReason: null,
              }),
            );
            ctx.sendRuntimeEvent({
              type: 'done',
              botId: squad.id,
              messageId: assistantId,
              content: assistantMsg.content,
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
            ctx.storage.upsertAssistantMessage(squad.id, assistantMsg, { allowRebind: false });
          }
          ctx.sendRuntimeEvent({
            type: 'error',
            botId: squad.id,
            messageId: assistantId,
            error: message,
          });
          throw err;
        } finally {
          guards.dispose();
          ctx.abortControllers.delete(squad.id);
          ctx.rejectPendingApprovalsForBot(squad.id, '已结束');
        }
        } finally {
          steerGate.release();
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
      // Persist steer text before abort+restart so rapid sends keep full history.
      ctx.storage.appendMessage(bot.id, userMsg);
      ctx.storage.touchBot(bot.id);

      const steerGate = await acquireSteerGate(ctx, bot.id);
      try {
        if (!steerGate.proceed) {
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

      const controller = new AbortController();
      ctx.abortControllers.set(bot.id, controller);

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
        const { sessionSummary, summaryState } = await ensureSessionCompressed({
          storage: ctx.storage,
          ownerId: bot.id,
          model: modelConfig,
          contextCompression: settings.contextCompression,
          staticText,
          prior,
          signal: controller.signal,
          force: topicForce,
        });

        ctx.sendRuntimeEvent({
          type: 'user_message',
          botId: bot.id,
          message: userMsg,
        });

        // Model session view = yet-uncompressed tail after coveredThroughId (full jsonl unchanged).
        const fileSession = createOkbotFileSession(
          ctx.storage.createSessionStore(bot.id, {
            afterMessageId: summaryState?.coveredThroughId ?? null,
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
          memoriesText,
          sessionSummary: sessionSummary || undefined,
          assistantRoleTemplate: settings.instructions?.assistantRoleTemplate,
          model: modelConfig,
          tools: settings.tools,
          security: settings.security,
          maxTurns: settings.maxTurns,
          toolRunBudget: guards.budget,
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
          onToolApprovalRequest: ({ requestId, toolName, arguments: toolArgs, serializedRunState }) =>
            new Promise<{ approved: boolean; message?: string }>((resolve) => {
              if (controller.signal.aborted) {
                resolve({ approved: false, message: '已取消' });
                return;
              }
              const decision = resolveAutoApproval(
                settings.autoApprovalEnabled === true,
                settings.autoApprovalRules,
                toolName,
                toolArgs,
              );
              if (decision === 'allow') {
                resolve({ approved: true, message: '自动审批规则已允许' });
                return;
              }
              ctx.pendingToolApprovals.set(requestId, {
                computerId: payload.computerId,
                botId: bot.id,
                messageId: assistantId,
                toolName,
                arguments: toolArgs,
                resolve,
              });
              if (serializedRunState) {
                try {
                  ctx.storage.savePendingHitl(bot.id, {
                    computerId: payload.computerId,
                    userText: text,
                    v: 1,
                    requestId,
                    messageId: assistantId,
                    toolName,
                    arguments: toolArgs,
                    serializedRunState,
                    createdAt: new Date().toISOString(),
                  });
                } catch (err) {
                  console.error('[okbot] save pending hitl failed', err);
                }
              }
              ctx.sendRuntimeEvent({
                type: 'tool_request',
                botId: bot.id,
                messageId: assistantId,
                requestId,
                toolName,
                arguments: toolArgs,
              });
              const onAbort = () => {
                if (!ctx.pendingToolApprovals.has(requestId)) return;
                ctx.pendingToolApprovals.delete(requestId);
                ctx.storage.clearPendingHitl(bot.id);
                resolve({ approved: false, message: '已取消' });
              };
              controller.signal.addEventListener('abort', onAbort, { once: true });
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
        // Empty + no session row for this streaming id: skip upsert. Abort during
        // HITL clears streamed text; unconditional upsert used to rebind/wipe the
        // previous assistant turn (see FileStorage.upsertAssistantMessage).
        if ((assistantMsg.content || '').trim()) {
          ctx.storage.upsertAssistantMessage(bot.id, assistantMsg);
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
          ...(controller.signal.aborted ? { aborted: true } : {}),
        });
        guards.finish(
          resolveRunFinishStatus({
            aborted: controller.signal.aborted,
            breakReason: guards.budget.getBreakReason(),
          }),
        );
        // First real chat closes optional onboarding without forcing answers.
        // Abort before a completed turn must not mark onboarding done.
        if (bot.onboardingComplete === false && !controller.signal.aborted) {
          try {
            ctx.storage.finishBotOnboarding(bot.id, {});
          } catch (err) {
            console.error('[okbot] soft onboarding close failed', err);
          }
        }
        // Silent AGENTS.md + skills maintenance — next turn reloads from disk.
        try {
          if (!controller.signal.aborted) {
            const agentsLimit = settings.instructions.agentsMdRecentMessageLimit;
            const skillsLimit = settings.instructions.skillsRecentMessageLimit;
            const memoryLimit = settings.memory.recentMessageLimit;
            const recent = ctx.storage.getMessagesPage(bot.id, {
              limit: Math.max(agentsLimit, skillsLimit, memoryLimit),
            }).messages;
            const nextMd = await refreshAgentsMd({
              model: modelConfig,
              botName: bot.name,
              currentAgentsMd: agentsMd,
              recentMessages: recent,
              systemPrompt: settings.instructions.agentsMdRefreshSystemPrompt,
              recentMessageLimit: agentsLimit,
              signal: controller.signal,
            });
            if (nextMd) ctx.storage.writeAgentsMd(bot.id, nextMd);

            const skillResult = await refreshBotSkills({
              model: modelConfig,
              botName: bot.name,
              existingSkills: ctx.storage.listSkills(bot.id),
              recentMessages: recent,
              createUpdateInstruction: settings.instructions.skillsCreateUpdateInstruction,
              recentMessageLimit: skillsLimit,
              signal: controller.signal,
            });
            if (skillResult.action === 'upsert') {
              ctx.storage.writeSkill(bot.id, skillResult.skill);
            }

            const memResult = await refreshMemories({
              model: modelConfig,
              botId: bot.id,
              botName: bot.name,
              existingGlobal: ctx.storage.listGlobalMemories(),
              existingBot: ctx.storage.listBotMemories(bot.id),
              recentMessages: recent,
              scopeInstruction: settings.memory.scopeInstruction,
              recentMessageLimit: memoryLimit,
              signal: controller.signal,
            });
            if (memResult.action === 'upsert') {
              for (const e of memResult.entries) {
                ctx.storage.upsertMemory(e.scope, {
                  id: createId('mem'),
                  bot_id: bot.id,
                  memory: e.memory,
                  expires: e.expires,
                });
              }
            }
          }
        } catch (err) {
          console.error('[okbot] AGENTS.md/skills/memory refresh failed', err);
        }
        return { userMessage: userMsg, assistantMessage: assistantMsg };
      } catch (err) {
        // Mid-run steer / Stop: settle quietly. Circuit-breaker sets getBreakReason()
        // before aborting — surface that to the user instead of a silent done.
        if (
          !guards.budget.getBreakReason() &&
          (controller.signal.aborted || isAbortLikeError(err))
        ) {
          guards.finish(
            resolveRunFinishStatus({
              aborted: true,
              breakReason: null,
            }),
          );
          ctx.sendRuntimeEvent({
            type: 'done',
            botId: bot.id,
            messageId: assistantId,
            content: assistantMsg.content,
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
          ctx.storage.upsertAssistantMessage(bot.id, assistantMsg, { allowRebind: false });
        }
        ctx.sendRuntimeEvent({
          type: 'error',
          botId: bot.id,
          messageId: assistantId,
          error: message,
        });
        throw err;
      } finally {
        guards.dispose();
        ctx.abortControllers.delete(bot.id);
        ctx.rejectPendingApprovalsForBot(bot.id, '已结束');
      }
      } finally {
        steerGate.release();
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
        // Cold-start resume for squad captain local-tool HITL: rebuild is not yet
        // wired (member ask_* graph). Keep pending and ask user to finish while live,
        // or clear so the next turn is clean — prefer clear + honest error.
        ctx.storage.clearPendingHitl(disk.botId);
        return {
          ok: false,
          error:
            '小队工具审批无法在应用重启后恢复，请重新发送该轮消息并再次批准。',
        };
      }

      const bot = ctx.storage.listBots().find((b) => b.id === disk.botId);
      if (!bot) {
        ctx.storage.clearPendingHitl(disk.botId);
        return { ok: false, error: '助手不存在' };
      }

      if (ctx.abortControllers.has(bot.id)) {
        return { ok: false, error: '该助手已有进行中的任务' };
      }

      const runSlot = await acquireRunSlot(bot.id);
      // Re-check after waiting on the per-owner chain (steer may have started).
      if (ctx.abortControllers.has(bot.id)) {
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
      ctx.abortControllers.set(bot.id, controller);
      ctx.storage.clearPendingHitl(bot.id);

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
          }),
        );

        const result = await resumeAgentChatAfterHitl({
          botName: bot.name,
          botDescription: bot.description,
          agentsMd,
          skillsText,
          skillLookup,
          memoriesText,
          sessionSummary: sessionSummary || undefined,
          assistantRoleTemplate: settings.instructions?.assistantRoleTemplate,
          model: modelConfig,
          tools: settings.tools,
          security: settings.security,
          maxTurns: settings.maxTurns,
          toolRunBudget: guards.budget,
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
          onToolApprovalRequest: ({ requestId, toolName, arguments: toolArgs, serializedRunState }) =>
            new Promise<{ approved: boolean; message?: string }>((resolve) => {
              if (controller.signal.aborted) {
                resolve({ approved: false, message: '已取消' });
                return;
              }
              const auto = resolveAutoApproval(
                settings.autoApprovalEnabled === true,
                settings.autoApprovalRules,
                toolName,
                toolArgs,
              );
              if (auto === 'allow') {
                resolve({ approved: true, message: '自动审批规则已允许' });
                return;
              }
              ctx.pendingToolApprovals.set(requestId, {
                computerId: disk.computerId,
                botId: bot.id,
                messageId: assistantId,
                toolName,
                arguments: toolArgs,
                resolve,
              });
              if (serializedRunState) {
                try {
                  ctx.storage.savePendingHitl(bot.id, {
                    computerId: disk.computerId,
                    userText: disk.userText,
                    v: 1,
                    requestId,
                    messageId: assistantId,
                    toolName,
                    arguments: toolArgs,
                    serializedRunState,
                    createdAt: new Date().toISOString(),
                  });
                } catch (err) {
                  console.error('[okbot] save pending hitl failed', err);
                }
              }
              ctx.sendRuntimeEvent({
                type: 'tool_request',
                botId: bot.id,
                messageId: assistantId,
                requestId,
                toolName,
                arguments: toolArgs,
              });
              const onAbort = () => {
                if (!ctx.pendingToolApprovals.has(requestId)) return;
                ctx.pendingToolApprovals.delete(requestId);
                ctx.storage.clearPendingHitl(bot.id);
                resolve({ approved: false, message: '已取消' });
              };
              controller.signal.addEventListener('abort', onAbort, { once: true });
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
        // Empty + no session row for this streaming id: skip upsert. Abort during
        // HITL clears streamed text; unconditional upsert used to rebind/wipe the
        // previous assistant turn (see FileStorage.upsertAssistantMessage).
        if ((assistantMsg.content || '').trim()) {
          ctx.storage.upsertAssistantMessage(bot.id, assistantMsg);
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
          ...(controller.signal.aborted ? { aborted: true } : {}),
        });
        guards.finish(
          resolveRunFinishStatus({
            aborted: controller.signal.aborted,
            breakReason: guards.budget.getBreakReason(),
          }),
        );
        return { ok: true, resumed: true };
      } catch (err) {
        // Circuit-breaker aborts the same controller; surface getBreakReason() first
        // so the user sees the limit message instead of a silent stop.
        if (
          !guards.budget.getBreakReason() &&
          (controller.signal.aborted || isAbortLikeError(err))
        ) {
          guards.finish(
            resolveRunFinishStatus({
              aborted: true,
              breakReason: null,
            }),
          );
          ctx.sendRuntimeEvent({
            type: 'done',
            botId: bot.id,
            messageId: assistantId,
            content: assistantMsg.content,
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
          ctx.storage.upsertAssistantMessage(bot.id, assistantMsg, { allowRebind: false });
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
        ctx.abortControllers.delete(bot.id);
        ctx.rejectPendingApprovalsForBot(bot.id, '已结束');
        runSlot.release();
      }
}

export function registerChatIpc(ctx: IpcContext): void {
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

  /**
   * Manual Summary+Buffer: bypass ratio threshold.
   * mode=compress → keep recent buffer per settings; mode=newTopic → cover all prior (keep=0).
   * UI transcript (session.jsonl) is never trimmed. Disabled while owner is streaming.
   */
  ipcMain.handle(
    IpcChannels.compressSessionNow,
    async (
      _e,
      payload: { botId?: string; squadId?: string; mode: 'compress' | 'newTopic' },
    ): Promise<{
      ok: boolean;
      didCompress?: boolean;
      coveredThroughId?: string | null;
      error?: string;
    }> => {
      const mode = payload?.mode === 'newTopic' ? 'newTopic' : 'compress';
      const botId = typeof payload?.botId === 'string' ? payload.botId.trim() : '';
      const squadId = typeof payload?.squadId === 'string' ? payload.squadId.trim() : '';
      if ((botId && squadId) || (!botId && !squadId)) {
        return { ok: false, error: 'invalid_owner' };
      }

      const ownerId = botId || squadId;
      if (ctx.abortControllers.has(ownerId)) {
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
      // Reuse abortControllers so chatStart/chatAbort treat compress as busy.
      ctx.abortControllers.set(ownerId, controller);
      try {
        const { summaryState, didCompress } = await ensureSessionCompressed({
          storage: ctx.storage,
          ownerId,
          model: modelConfig,
          contextCompression: settings.contextCompression,
          staticText,
          prior,
          signal: controller.signal,
          force: mode,
        });
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
        // Only clear if we still own the slot — a raced chatStart must keep Stop working.
        if (ctx.abortControllers.get(ownerId) === controller) {
          ctx.abortControllers.delete(ownerId);
        }
      }
    },
  );

}
