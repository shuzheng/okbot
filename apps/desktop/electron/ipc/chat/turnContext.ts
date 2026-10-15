/**
 * Shared turn plumbing for 1:1 / squad / cold-restore paths.
 * Public chat IPC still enters via registerChat.ts.
 */
import {
  clipQuotePreview,
  formatUserTextWithQuote,
  type ChatMessage,
} from '@okbot/shared';
import {
  normalizeReplyMediaMarkdown,
  quoteSessionInputCallback,
  stripImageLinesFromAttachedBlock,
} from '@okbot/agent';
import type { IpcContext } from '../context';

/** Alias kept for turn modules — same shape as IpcContext today. */
export type TurnContext = IpcContext;

export type ChatStartPayload = {
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
};

export type ChatStartResult = {
  userMessage: ChatMessage;
  assistantMessage?: ChatMessage;
  superseded?: boolean;
  aborted?: boolean;
};

export function resolveQuoteFields(
  storage: TurnContext['storage'],
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
 * Persist assistant text. showThinking only affects renderer projection;
 * stripping on write used to irreversibly truncate when parseThink misfired.
 * Also rewrite legacy okbot-asset: / file://…/.okbot/…/resources/ img srcs to
 * absolute gateway `/v1/media/…` (never leave data:/file:// as the canonical form).
 */
export function persistAssistantContent(content: string, _showThinking: boolean): string {
  return normalizeReplyMediaMarkdown(content);
}

/** Stamp runId onto runtime events for a parallel turn (except roster/skill broadcasts). */
export function createTurnEmitter(ctx: TurnContext, turnRunId: string) {
  return (event: Parameters<TurnContext['sendRuntimeEvent']>[0]) => {
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
}
