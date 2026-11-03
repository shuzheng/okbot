/**
 * In-place emoji reactions on chat bubbles.
 * Persist via patchMessage; user set/change on assistant bubbles wakes a quiet turn.
 */
import {
  normalizeMessageReaction,
  type ChatMessage,
  type MessageReaction,
  type MessageReactionFrom,
} from '@okbot/shared';
import type { IpcContext } from './context';

export type SetMessageReactionPayload = {
  botId?: string;
  squadId?: string;
  messageId: string;
  /** null / empty = clear. */
  emoji: string | null;
  /**
   * Who is applying the reaction.
   * Desktop IPC always uses `user`; the model tool uses `assistant`.
   */
  from?: MessageReactionFrom;
};

export type SetMessageReactionResult =
  | {
      ok: true;
      message: ChatMessage;
      /** Whether a quiet wake turn was started (user set/change only). */
      woke: boolean;
      cleared: boolean;
    }
  | { ok: false; error: string };

export type SetMessageReactionDeps = {
  /** Injected wake (tests stub; production uses startChatTurn). */
  startWake?: (
    ctx: IpcContext,
    args: { botId: string; text: string; quoteMessageId: string },
  ) => Promise<unknown>;
};

function resolveOwnerId(payload: SetMessageReactionPayload): string | null {
  const botId = (payload.botId || '').trim();
  const squadId = (payload.squadId || '').trim();
  if (botId && !squadId) return botId;
  if (squadId && !botId) return squadId;
  return null;
}

function isBotOwner(ctx: IpcContext, ownerId: string): boolean {
  return ctx.storage.listBots().some((b) => b.id === ownerId);
}

async function defaultStartWake(
  ctx: IpcContext,
  args: { botId: string; text: string; quoteMessageId: string },
): Promise<unknown> {
  const { startChatTurn } = await import('./registerChat.js');
  return startChatTurn(ctx, {
    botId: args.botId,
    text: args.text,
    quoteMessageId: args.quoteMessageId,
    origin: 'reaction',
  });
}

/**
 * Upsert or clear a reaction. Emits `message_updated`.
 * User set/change on an assistant bubble in a 1:1 bot session starts a quiet wake.
 */
export async function setMessageReaction(
  ctx: IpcContext,
  payload: SetMessageReactionPayload,
  deps?: SetMessageReactionDeps,
): Promise<SetMessageReactionResult> {
  const ownerId = resolveOwnerId(payload);
  const messageId = (payload.messageId || '').trim();
  if (!ownerId) return { ok: false, error: 'owner_required' };
  if (!messageId) return { ok: false, error: 'message_id_required' };

  const from: MessageReactionFrom = payload.from === 'assistant' ? 'assistant' : 'user';
  const emojiRaw = payload.emoji == null ? '' : String(payload.emoji).trim();
  const emoji = emojiRaw.slice(0, 32);

  const existing = ctx.storage.getMessageById(ownerId, messageId);
  if (!existing) return { ok: false, error: 'message_not_found' };

  // Role gates: user reacts on assistant bubbles; assistant reacts on user bubbles.
  if (from === 'user' && existing.role !== 'assistant') {
    return { ok: false, error: 'user_react_assistant_only' };
  }
  if (from === 'assistant' && existing.role !== 'user') {
    return { ok: false, error: 'assistant_react_user_only' };
  }

  const prev = normalizeMessageReaction(existing.reaction);
  const sameEmoji = Boolean(prev && prev.emoji === emoji && prev.from === from);
  // User UI: tap same emoji again → clear. Assistant tool: re-assert is idempotent
  // (only explicit empty emoji clears) — otherwise a later turn's duplicate react
  // wiped the badge (see bot_20261018_009 session evidence).
  if (sameEmoji && from === 'assistant' && emoji) {
    return { ok: true, message: existing, woke: false, cleared: false };
  }
  const clearing = !emoji || (from === 'user' && sameEmoji);

  let patched: ChatMessage | null;
  if (clearing) {
    patched = ctx.storage.patchMessage(ownerId, messageId, { reaction: null });
  } else {
    const next: MessageReaction = {
      emoji,
      from,
      updatedAt: new Date().toISOString(),
    };
    patched = ctx.storage.patchMessage(ownerId, messageId, { reaction: next });
  }
  if (!patched) return { ok: false, error: 'patch_failed' };

  try {
    ctx.sendRuntimeEvent({ type: 'message_updated', botId: ownerId, message: patched });
  } catch (err) {
    console.error('[okbot] message_updated emit failed', err);
  }

  // Wake only for user set/change (not clear, not assistant tool). 1:1 bots only.
  let woke = false;
  if (!clearing && from === 'user' && isBotOwner(ctx, ownerId)) {
    const startWake = deps?.startWake ?? defaultStartWake;
    try {
      void startWake(ctx, {
        botId: ownerId,
        text: emoji,
        quoteMessageId: messageId,
      }).catch((err) => {
        console.error('[okbot] reaction wake failed', err);
      });
      woke = true;
    } catch (err) {
      console.error('[okbot] reaction wake start failed', err);
    }
  }

  return { ok: true, message: patched, woke, cleared: clearing };
}

/**
 * True when trimmed text has no letters/numbers and is short (emoji / symbols only).
 * Used to drop duplicate emoji-only bubbles after a reaction-only send_message.
 */
export function isEmojiOnlyText(text: string): boolean {
  const t = (text || '').trim();
  if (!t || t.length > 24) return false;
  try {
    return !/\p{L}|\p{N}/u.test(t);
  } catch {
    return !/[A-Za-z0-9\u3400-\u9FFF]/.test(t);
  }
}

/**
 * After a reaction this turn, drop a final/stream bubble that is only the same
 * emoji (or any emoji-only string). Real prose still passes through.
 */
export function stripEmojiOnlyAfterReaction(
  content: string,
  reactedEmojis: readonly string[] | undefined,
): string {
  if (!reactedEmojis?.length) return content;
  const t = (content || '').trim();
  if (!t) return content;
  if (reactedEmojis.some((e) => e === t) || isEmojiOnlyText(t)) return '';
  return content;
}

export type EmojiOnlyFinalPlan = {
  content: string;
  /** When set, host applies this assistant reaction then keeps content empty. */
  convertToReaction?: { messageId: string; emoji: string };
};

/** Newest-first assistant reaction emojis on user bubbles (for next-turn echo drop). */
export function recentAssistantReactionEmojis(
  messages: readonly ChatMessage[],
  limit = 8,
): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const m = messages[i]!;
    if (m.role !== 'user') continue;
    const r = normalizeMessageReaction(m.reaction);
    if (r?.from === 'assistant' && r.emoji) out.push(r.emoji);
  }
  return out;
}

/** Last non-autoContinue user bubble id (optionally before an assistant id). */
export function findLatestUserMessageId(
  messages: readonly ChatMessage[],
  opts?: { beforeAssistantId?: string },
): string | undefined {
  let list = messages;
  if (opts?.beforeAssistantId) {
    const idx = messages.findIndex((m) => m.id === opts.beforeAssistantId);
    if (idx >= 0) list = messages.slice(0, idx);
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]!;
    if (m.role === 'user' && !(m as { autoContinue?: boolean }).autoContinue) return m.id;
  }
  return undefined;
}

/**
 * Product: emoji-only assistant finals must never become timeline bubbles.
 * - Same turn after react → drop (via stripEmojiOnlyAfterReaction).
 * - Equals existing assistant reaction on the target user bubble → drop duplicate.
 * - Equals a recent prior user-bubble reaction → drop next-turn echo (do not restamp).
 * - Otherwise, with a target user id → convert to reaction on that bubble.
 * - No target → still suppress the text bubble.
 */
export function planEmojiOnlyAssistantFinal(
  content: string,
  opts: {
    reactedEmojisThisTurn?: readonly string[];
    targetUserMessageId?: string;
    targetReactionEmoji?: string | null;
    recentReactionEmojis?: readonly string[];
  },
): EmojiOnlyFinalPlan {
  const stripped = stripEmojiOnlyAfterReaction(content, opts.reactedEmojisThisTurn);
  if (!stripped.trim() && (content || '').trim()) {
    return { content: '' };
  }
  const t = (stripped || content || '').trim();
  if (!t || !isEmojiOnlyText(t)) return { content: stripped === content ? content : stripped };

  if (opts.targetReactionEmoji && opts.targetReactionEmoji === t) {
    return { content: '' };
  }
  if (opts.recentReactionEmojis?.some((e) => e === t)) {
    return { content: '' };
  }
  if (opts.targetUserMessageId) {
    return {
      content: '',
      convertToReaction: { messageId: opts.targetUserMessageId, emoji: t },
    };
  }
  return { content: '' };
}

/**
 * Finalize-time guard: suppress emoji-only bubbles; convert or drop as planned.
 * Returns the content that should remain on the live assistant message.
 */
export async function applyEmojiOnlyFinalGuard(
  ctx: IpcContext,
  ownerId: string,
  content: string,
  opts: {
    reactedEmojisThisTurn?: readonly string[];
    targetUserMessageId?: string;
  },
): Promise<string> {
  const targetId =
    opts.targetUserMessageId ||
    findLatestUserMessageId(ctx.storage.getMessages(ownerId));
  const target = targetId ? ctx.storage.getMessageById(ownerId, targetId) : undefined;
  const msgs = ctx.storage.getMessages(ownerId);
  const prior = targetId ? msgs.filter((m) => m.id !== targetId) : msgs;
  const plan = planEmojiOnlyAssistantFinal(content, {
    reactedEmojisThisTurn: opts.reactedEmojisThisTurn,
    targetUserMessageId: targetId,
    targetReactionEmoji:
      target?.reaction?.from === 'assistant' ? target.reaction.emoji : null,
    recentReactionEmojis: recentAssistantReactionEmojis(prior),
  });
  if (plan.convertToReaction) {
    await setMessageReaction(ctx, {
      botId: ownerId,
      messageId: plan.convertToReaction.messageId,
      emoji: plan.convertToReaction.emoji,
      from: 'assistant',
    });
  }
  return plan.content;
}

export type ApplyAssistantSendMessageOpts = {
  /** Fired when an assistant reaction is set (not cleared). */
  onReacted?: (emoji: string) => void;
};

/** Host hook for send_message: optional in-place reaction, then optional text bubble. */
export async function applyAssistantSendMessage(
  ctx: IpcContext,
  ownerId: string,
  input: string | { content?: string; reactToMessageId?: string; emoji?: string },
  emitText: (content: string) => Promise<void>,
  opts?: ApplyAssistantSendMessageOpts,
): Promise<void> {
  const payload = typeof input === 'string' ? { content: input } : input;
  const reactToMessageId = (payload.reactToMessageId || '').trim();
  const content = typeof payload.content === 'string' ? payload.content.trim() : '';
  let reactedEmoji = '';
  if (reactToMessageId) {
    // Omit emoji ≠ clear. Explicit empty string clears (tool + design contract).
    if (!Object.prototype.hasOwnProperty.call(payload, 'emoji') || payload.emoji == null) {
      throw new Error('emoji_required_for_reaction');
    }
    const emojiRaw = String(payload.emoji).trim();
    const result = await setMessageReaction(ctx, {
      botId: ownerId,
      messageId: reactToMessageId,
      emoji: emojiRaw || null,
      from: 'assistant',
    });
    if (!result.ok) throw new Error(result.error);
    if (!result.cleared && emojiRaw) {
      reactedEmoji = emojiRaw;
      opts?.onReacted?.(emojiRaw);
    }
  }
  if (!content) return;
  // Reaction + content that is solely that emoji (or emoji-only) → badge only.
  if (reactedEmoji && (content === reactedEmoji || isEmojiOnlyText(content))) return;
  await emitText(content);
}
