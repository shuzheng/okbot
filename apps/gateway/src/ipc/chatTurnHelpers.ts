import { createId, stripThinkContent, type ChatMessage, type Squad, type TokenUsage } from '@okbot/shared';
import type { ComputerRoute, MeshPeerSpec, SkillLookup, SquadMemberAgentSpec } from '@okbot/agent';
import type { IpcContext } from './context';

/** Bind `read_skill` to this bot's local + enabled-global skills. */
export function skillLookupFor(storage: IpcContext['storage'], botId: string): SkillLookup {
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

export function computerRouteFor(
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

/** Member specs for a squad run (live turn and cold resume share this). Throws on a missing member. */
export function buildSquadMemberSpecs(
  storage: IpcContext['storage'],
  squad: Pick<Squad, 'members'>,
): SquadMemberAgentSpec[] {
  const byId = new Map(storage.listBots().map((b) => [b.id, b]));
  return squad.members.map((m) => {
    const bot = byId.get(m.botId);
    if (!bot) throw new Error(`成员不存在：${m.botId}`);
    return {
      botId: bot.id,
      name: bot.name,
      description: bot.description,
      soulMd: storage.readSoulMd(bot.id),
      skillsText: storage.formatSkillsForPrompt(bot.id),
      skillLookup: skillLookupFor(storage, bot.id),
      memoriesText: storage.formatMemoriesForPrompt(bot.id),
    };
  });
}

/** Other assistants for 1:1 mesh roster + ask_assistant (exclude self). Squads must not use this. */
export function buildMeshPeerSpecs(
  storage: IpcContext['storage'],
  currentBotId: string,
): MeshPeerSpec[] {
  return storage
    .listBots()
    .filter((b) => b.id !== currentBotId)
    .map((bot) => ({
      id: bot.id,
      name: bot.name,
      description: bot.description,
      soulMd: storage.readSoulMd(bot.id),
      skillsText: storage.formatSkillsForPrompt(bot.id),
      skillLookup: skillLookupFor(storage, bot.id),
      memoriesText: storage.formatMemoriesForPrompt(bot.id),
    }));
}

type MeshExchangeEmit = (event: {
  type: 'assistant_message';
  botId: string;
  message: ChatMessage;
}) => void;

/**
 * 1:1 mesh UI (per hop):
 * - On ask: this hop's caller session gets 「已发消息给」; callee session gets 「消息来自」(caller).
 * - On reply: patch both rows' meta; caller session also gets 「消息来自」(peer).
 * Nested hops (A→B→C) write chips only to that hop's caller (B for B→C), never ancestors.
 * Squad ask_* must not use this (squads keep exchange bubbles).
 */
export function createMeshExchangeHandler(input: {
  storage: {
    appendMessage: (id: string, m: ChatMessage) => void;
    patchMessage: (id: string, messageId: string, patch: Partial<ChatMessage>) => ChatMessage | null;
    getMessages: (id: string) => ChatMessage[];
  };
  emit: MeshExchangeEmit;
}): (info: {
  kind: 'ask' | 'reply';
  exchangeId: string;
  peerBotId: string;
  peerName: string;
  callerBotId: string;
  callerName: string;
  content: string;
  usage?: TokenUsage;
}) => Promise<void> {
  const { storage, emit } = input;

  const findExchange = (
    sessionId: string,
    exchangeId: string,
    direction: 'sent' | 'received',
  ): ChatMessage | undefined => {
    const messages = storage.getMessages(sessionId);
    return [...messages]
      .reverse()
      .find((m) => {
        const ex = m.meshExchange;
        if (!ex || ex.exchangeId !== exchangeId) return false;
        const dir = ex.direction === 'received' ? 'received' : 'sent';
        return dir === direction;
      });
  };

  const appendStatus = (sessionId: string, message: ChatMessage) => {
    try {
      storage.appendMessage(sessionId, message);
    } catch (err) {
      console.error('[okbot] append mesh status failed', sessionId, err);
    }
    emit({ type: 'assistant_message', botId: sessionId, message });
  };

  const patchStatus = (sessionId: string, target: ChatMessage, meshExchange: NonNullable<ChatMessage['meshExchange']>) => {
    const patched: ChatMessage = { ...target, meshExchange };
    try {
      storage.patchMessage(sessionId, target.id, { meshExchange });
    } catch (err) {
      console.error('[okbot] patch mesh status failed', sessionId, err);
    }
    emit({ type: 'assistant_message', botId: sessionId, message: patched });
  };

  return async ({ kind, exchangeId, peerBotId, peerName, callerBotId, callerName, content }) => {
    const raw = String(content ?? '');
    const body = stripThinkContent(raw).trim() || raw.trim();
    const peerLabel = peerName || peerBotId;
    const callerLabel = callerName || callerBotId;
    // Nested mesh: chips belong only on this hop's caller session, not ancestors.
    const callerSessionId = callerBotId;

    if (kind === 'ask') {
      const now = new Date().toISOString();
      const base = {
        exchangeId,
        peerBotId,
        peerName: peerLabel,
        callerBotId,
        callerName: callerLabel,
        ask: body,
        askAt: now,
      };

      // Caller session for this hop: outbound chip
      appendStatus(callerSessionId, {
        id: createId('msg'),
        role: 'assistant',
        content: `已发消息给 ${peerLabel}`,
        createdAt: now,
        meshExchange: { ...base, direction: 'sent' },
      });

      // Callee session: inbound chip so their history shows the ask
      if (peerBotId && peerBotId !== callerSessionId) {
        appendStatus(peerBotId, {
          id: createId('msg'),
          role: 'assistant',
          content: `消息来自 ${callerLabel}`,
          createdAt: now,
          meshExchange: { ...base, direction: 'received' },
        });
      }
      return;
    }

    const replyAt = new Date().toISOString();
    const sent = findExchange(callerSessionId, exchangeId, 'sent');
    if (!sent?.meshExchange) {
      console.warn('[okbot] mesh reply without matching ask row', exchangeId);
    } else {
      patchStatus(callerSessionId, sent, {
        ...sent.meshExchange,
        direction: sent.meshExchange.direction === 'received' ? 'received' : 'sent',
        reply: body,
        replyAt,
      });
    }

    // Callee inbound row: attach reply for the exchange panel
    if (peerBotId && peerBotId !== callerSessionId) {
      const inbound = findExchange(peerBotId, exchangeId, 'received');
      if (inbound?.meshExchange) {
        patchStatus(peerBotId, inbound, {
          ...inbound.meshExchange,
          direction: 'received',
          reply: body,
          replyAt,
        });
      }
    }

    // Caller session for this hop: 「消息来自: peer」 after the reply lands
    const askMeta = sent?.meshExchange;
    appendStatus(callerSessionId, {
      id: createId('msg'),
      role: 'assistant',
      content: `消息来自 ${peerLabel}`,
      createdAt: replyAt,
      meshExchange: {
        exchangeId,
        peerBotId,
        peerName: peerLabel,
        callerBotId,
        callerName: callerLabel,
        ask: askMeta?.ask ?? body,
        askAt: askMeta?.askAt ?? replyAt,
        reply: body,
        replyAt,
        direction: 'received',
      },
    });
  };
}
