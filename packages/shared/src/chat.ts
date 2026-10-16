/** Chat message types and ChatStartPayload contract. */

import type { TokenUsage } from './usage.js';
import type { MessageTrace } from './trace.js';
import type { BotAvatarKind, BotAvatarShape } from './settings.js';

export type ChatRole = 'user' | 'assistant' | 'system';

/** Renderer-only lifecycle for optimistic user bubbles (not persisted). */
export type MessageSendStatus = 'pending' | 'sent' | 'failed';

/** User-message file/folder/image attachment (UI chips; paths also kept in content for the model). */
export type MessageAttachmentKind = 'image' | 'file' | 'folder';

export interface MessageAttachment {
  kind: MessageAttachmentKind;
  /** Absolute path on the local machine. */
  path: string;
  /** Display basename. */
  name: string;
}

/**
 * 1:1 mesh status row meta: compact「已发消息给」/「消息来自」chips in chat;
 * ask/reply bodies open in a read-only dialog (not main bubbles).
 */
export type MeshExchangeDirection = 'sent' | 'received';

export interface MeshExchangeMeta {
  /** Pairs ask + reply for one peer hop. */
  exchangeId: string;
  peerBotId: string;
  peerName: string;
  callerBotId: string;
  callerName: string;
  ask: string;
  askAt: string;
  reply?: string;
  replyAt?: string;
  /**
   * `sent` = 「已发消息给」(outbound ask; default for legacy rows).
   * `received` = 「消息来自」(inbound: caller after peer reply, or callee session).
   */
  direction?: MeshExchangeDirection;
}

/** Sanitize mesh exchange meta from disk / IPC. */
export function normalizeMeshExchange(raw: unknown): MeshExchangeMeta | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const exchangeId = typeof o.exchangeId === 'string' ? o.exchangeId.trim() : '';
  const peerBotId = typeof o.peerBotId === 'string' ? o.peerBotId.trim() : '';
  const peerName = typeof o.peerName === 'string' ? o.peerName.trim() : '';
  const callerBotId = typeof o.callerBotId === 'string' ? o.callerBotId.trim() : '';
  const callerName = typeof o.callerName === 'string' ? o.callerName.trim() : '';
  const ask = typeof o.ask === 'string' ? o.ask : '';
  const askAt = typeof o.askAt === 'string' ? o.askAt.trim() : '';
  if (!exchangeId || !peerBotId || !askAt) return undefined;
  const direction: MeshExchangeDirection =
    o.direction === 'received' ? 'received' : 'sent';
  const out: MeshExchangeMeta = {
    exchangeId,
    peerBotId,
    peerName: peerName || peerBotId,
    callerBotId,
    callerName: callerName || callerBotId,
    ask,
    askAt,
    direction,
  };
  if (typeof o.reply === 'string') out.reply = o.reply;
  if (typeof o.replyAt === 'string' && o.replyAt.trim()) out.replyAt = o.replyAt.trim();
  return out;
}

/**
 * Avatar+name chip subject for a mesh status row in `sessionOwnerId`'s transcript.
 * Sent → peer; received on callee session → caller; received on caller → peer.
 */
export function meshExchangeChipRef(
  meta: MeshExchangeMeta,
  sessionOwnerId: string,
): { id: string; name: string } {
  const direction = meta.direction === 'received' ? 'received' : 'sent';
  if (direction === 'received' && sessionOwnerId === meta.peerBotId) {
    return {
      id: meta.callerBotId,
      name: meta.callerName || meta.callerBotId,
    };
  }
  return {
    id: meta.peerBotId,
    name: meta.peerName || meta.peerBotId,
  };
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  /** @deprecated Unused. Full context is projected live from Session; kept optional for old payloads. */
  hasPromptContext?: boolean;
  /** Squad chat: member bot id, or SQUAD_CAPTAIN_SPEAKER_ID for the virtual captain. */
  speakerBotId?: string;
  /**
   * 1:1 mesh only: centered status row («已发消息给» / «消息来自» + chip). When set,
   * render as status (not a normal bubble); click opens the read-only peer dialog.
   * Squad ask_* exchanges do not use this field.
   */
  meshExchange?: MeshExchangeMeta;
  /**
   * 1:1 mesh: sealed ask_assistant interim bubble (message A). Follow-up streams into a
   * new id; reload hides SDK rows that exactly duplicate this text.
   */
  meshInterim?: boolean;
  /**
   * Host auto-continue of an unfinished task-progress checklist.
   * Persisted for the model session; UI transcript hides these user rows.
   */
  autoContinue?: boolean;
  /** When set, this user message quotes another transcript message (UI strip; not `>` in content). */
  quoteMessageId?: string;
  /** Short plain snapshot of the quoted message for the quote strip / composer preview. */
  quotePreview?: string;
  /**
   * User attachments shown as chips outside the text bubble.
   * Wire `content` may still include an `[Attached]` block so tools see file/folder paths.
   * Image attachments are also injected as multimodal vision (`input_image` / data URL) for the current turn.
   */
  attachments?: MessageAttachment[];
  /** Token usage for this assistant turn (omitted for user / legacy rows). */
  usage?: TokenUsage;
  /** Waterfall timeline for this assistant turn (model / tools / approval). */
  trace?: MessageTrace;
  /**
   * Renderer-only: optimistic user bubble send state.
   * `pending` while chatStart awaits; `failed` shows retry; cleared/`sent` after IPC succeeds.
   */
  sendStatus?: MessageSendStatus;
}

/** One page of session messages (jsonl tail / older pages). */
export interface MessagesPage {
  messages: ChatMessage[];
  /** Pass as beforeMessageId to load the next older page. null = no older messages. */
  nextBeforeMessageId: string | null;
  hasMore: boolean;
}

export const MESSAGE_PAGE_SIZE = 50;

/** One chat-history hit from global search (assistant and squad chats). */
export interface MessageSearchHit {
  /** Chat owner id (bot or squad). */
  botId: string;
  /** Owner type; omitted means `bot`. */
  ownerKind?: 'bot' | 'squad';
  botName: string;
  botEmoji: string;
  botColor: string;
  botAvatarKind: BotAvatarKind;
  botAvatarType?: BotAvatarShape;
  message: ChatMessage;
  /** Short plain-text snippet around the match. */
  snippet: string;
  /** Squad hits: name of the member who wrote the message (assistant rows). */
  speakerName?: string;
}


/** Optional fields shared by bot and squad chatStart bridges. */
export type ChatStartOpts = {
  quoteMessageId?: string;
  attachments?: MessageAttachment[];
  computerId?: string;
  clientTurnId?: string;
};

/**
 * IPC / HTTP body for starting a chat turn.
 * Exactly one of `botId` or `squadId` is set by the caller (preload uses botId or squadId;
 * HTTP routes encode the owner in the path and send only the body fields).
 */
export type ChatStartPayload = {
  botId?: string;
  squadId?: string;
  text: string;
} & ChatStartOpts;

/** Body keys sent on HTTP POST /v1/{bots|squads}/:id/messages (owner is in the path). */
export const CHAT_START_BODY_KEYS = [
  'text',
  'quoteMessageId',
  'attachments',
  'computerId',
  'clientTurnId',
] as const;

/** Full IPC invoke payload keys for `IpcChannels.chatStart`. */
export const CHAT_START_PAYLOAD_KEYS = [
  'botId',
  'squadId',
  'text',
  'quoteMessageId',
  'attachments',
  'computerId',
  'clientTurnId',
] as const;

export type ChatStartBodyKey = (typeof CHAT_START_BODY_KEYS)[number];
export type ChatStartPayloadKey = (typeof CHAT_START_PAYLOAD_KEYS)[number];

/** Pick known ChatStartOpts fields so bridges cannot invent divergent option bags. */
export function pickChatStartFields(opts?: ChatStartOpts | null): ChatStartOpts {
  if (!opts || typeof opts !== 'object') return {};
  const out: ChatStartOpts = {};
  if (typeof opts.quoteMessageId === 'string' && opts.quoteMessageId.trim()) {
    out.quoteMessageId = opts.quoteMessageId.trim();
  }
  if (typeof opts.computerId === 'string' && opts.computerId.trim()) {
    out.computerId = opts.computerId.trim();
  }
  if (typeof opts.clientTurnId === 'string' && opts.clientTurnId.trim()) {
    out.clientTurnId = opts.clientTurnId.trim();
  }
  if (Array.isArray(opts.attachments)) {
    out.attachments = opts.attachments;
  }
  return out;
}

/** Build the HTTP JSON body (no botId/squadId — those are in the URL). */
export function buildChatStartBody(text: string, opts?: ChatStartOpts | null): Record<string, unknown> {
  const fields = pickChatStartFields(opts);
  return {
    text,
    quoteMessageId: fields.quoteMessageId,
    attachments: fields.attachments,
    computerId: fields.computerId,
    clientTurnId: fields.clientTurnId,
  };
}

/** Build the IPC invoke payload for a bot or squad turn. */
export function buildChatStartPayload(
  owner: { botId: string } | { squadId: string },
  text: string,
  opts?: ChatStartOpts | null,
): ChatStartPayload {
  const fields = pickChatStartFields(opts);
  if ('botId' in owner) {
    return { botId: owner.botId, text, ...fields };
  }
  return { squadId: owner.squadId, text, ...fields };
}

/**
 * Normalize a raw chat-start body (HTTP JSON or IPC payload).
 * Does not require botId/squadId (HTTP puts owner in the path).
 */
export function normalizeChatStartPayload(raw: unknown): {
  text: string;
  quoteMessageId?: string;
  computerId?: string;
  clientTurnId?: string;
  attachments?: MessageAttachment[];
  botId?: string;
  squadId?: string;
} | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'invalid_payload' };
  }
  const src = raw as Record<string, unknown>;
  const text = typeof src.text === 'string' ? src.text.trim() : '';
  if (!text) return { error: 'text_required' };

  const out: {
    text: string;
    quoteMessageId?: string;
    computerId?: string;
    clientTurnId?: string;
    attachments?: MessageAttachment[];
    botId?: string;
    squadId?: string;
  } = { text };

  if (typeof src.botId === 'string' && src.botId.trim()) out.botId = src.botId.trim();
  if (typeof src.squadId === 'string' && src.squadId.trim()) out.squadId = src.squadId.trim();
  if (typeof src.quoteMessageId === 'string' && src.quoteMessageId.trim()) {
    out.quoteMessageId = src.quoteMessageId.trim();
  }
  if (typeof src.computerId === 'string' && src.computerId.trim()) {
    out.computerId = src.computerId.trim();
  }
  if (typeof src.clientTurnId === 'string' && src.clientTurnId.trim()) {
    out.clientTurnId = src.clientTurnId.trim();
  }
  if (Array.isArray(src.attachments)) {
    const atts: MessageAttachment[] = [];
    for (const item of src.attachments) {
      if (!item || typeof item !== 'object') continue;
      const a = item as Record<string, unknown>;
      const kind = a.kind;
      if (kind !== 'image' && kind !== 'file' && kind !== 'folder') continue;
      const attPath = typeof a.path === 'string' ? a.path : '';
      const name = typeof a.name === 'string' ? a.name : '';
      if (!attPath) continue;
      atts.push({
        kind,
        path: attPath,
        name: name || attPath.split(/[/\\]/).pop() || attPath,
      });
    }
    if (atts.length) out.attachments = atts;
  }
  return out;
}
