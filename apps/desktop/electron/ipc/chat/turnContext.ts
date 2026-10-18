/**
 * Shared turn plumbing for 1:1 / squad / cold-restore paths.
 * Public chat IPC still enters via registerChat.ts.
 */
import {
  clipQuotePreview,
  createId,
  formatUserTextWithQuote,
  stripThinkContent,
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

export type ChatStartOrigin =
  | 'composer'
  | 'schedule'
  | 'api'
  | 'auto_continue'
  /** Quiet first turn after user skips new-bot onboarding (hidden user row). */
  | 'onboarding_skip';

/** Synthetic user text for host auto-continue (hidden from UI transcript). */
export const AUTO_CONTINUE_USER_TEXT =
  '[继续未完成任务] tasks.jsonl 仍有 pending/in_progress 任务。请按添加顺序立刻继续推进并用 manage_task_progress(update) 同步状态；禁止只回复确认、询问是否继续、或「核对/继续/落盘中」等口头表态就结束本轮——本轮必须调用工具推进。';

/**
 * Quiet seed after onboarding skip — model writes the visible opener.
 * Keep system-ish so it does not read like a normal user chat turn.
 * ZH: visible ask must stay ≤50 Chinese characters (scope + collaboration).
 */
export const ONBOARDING_SKIP_GREETING_TEXT_ZH =
  '[新助手开场] 用户跳过了新建偏好。请只输出一句中文开场，用户可见全文必须≤50字，直接问两件事：工作范围、协作方式。可参考：「你好。你希望我主要负责什么？协作上偏好先确认还是直接办？」不要长自我介绍，不要提跳过/问卷/引导，不要列选项。等用户答复后再展开。';

export const ONBOARDING_SKIP_GREETING_TEXT_EN =
  '[New assistant opener] The user skipped preference setup. Reply in one short English line only: ask (1) what work/scope they want you to own and (2) how they prefer to collaborate (confirm first vs just do it). Keep it brief — two short questions, no long intro. Do not mention skipping, questionnaires, or onboarding; do not list options. Wait for their reply before diving into tasks.';

export function onboardingSkipGreetingText(lang: 'zh' | 'en'): string {
  return lang === 'en' ? ONBOARDING_SKIP_GREETING_TEXT_EN : ONBOARDING_SKIP_GREETING_TEXT_ZH;
}

/**
 * Escalated auto-continue after a stall (fingerprint unchanged).
 * Kept while unfinished tasks remain; unchanged fingerprint alone does not stop AC.
 */
export const AUTO_CONTINUE_STALL_ESCALATION_TEXT =
  '[继续未完成任务·加严] 上一轮没有改动未完成任务。禁止再只回复「核对/继续/落盘」；本轮必须立刻调用工具（如 read_file / write_file / manage_task_progress）推进未完成任务并用 update 同步状态。';

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
  /**
   * Who initiated the turn. Soft-steer (abort newest run) only for `composer`
   * (or unset, for backward compat). Schedule/API never abort the user's turn.
   */
  origin?: ChatStartOrigin;
};

/** True when the user row must stay in the model session but out of the UI transcript. */
export function isQuietChatOrigin(origin: ChatStartPayload['origin']): boolean {
  return origin === 'auto_continue' || origin === 'onboarding_skip';
}

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


/** Mutable live streaming assistant bubble (1:1 turn / cold-restore). */
export type LiveAssistantState = {
  assistantId: string;
  assistantMsg: ChatMessage;
  /** Last user-visible assistant text emitted this turn (for consecutive-ack dedupe). */
  lastEmittedVisible?: string;
};

export type LiveAssistantHost = {
  ownerId: string;
  runId: string;
  showThinking: boolean;
  storage: TurnContext['storage'];
  emit: (event: Parameters<TurnContext['sendRuntimeEvent']>[0]) => void;
  /** Optional mesh follow-up stripper (noteCommitted after seal/emit). */
  noteCommitted?: (text: string) => void;
};

/**
 * Normalize assistant text for near-identical ack comparison:
 * strip think, collapse whitespace/punct, lowercase.
 */
export function normalizeAssistantAckKey(text: string): string {
  return stripThinkContent(text || '')
    .replace(/\s+/g, '')
    .replace(/[。.!！？?~～、，,;；:：…·\-—_]/g, '')
    .toLowerCase();
}

/** Includes mid-run「继续」 for short↔short near-dup checks. */
const OPENING_ACK_RE = /^(收到|好的|继续|明白|了解|好|嗯|ok|okay|got\s*it)/i;

/** Turn-opening only (excludes「继续」) — used for short→long opening-window dedupe. */
const STRICT_OPENING_ACK_RE = /^(收到|好的|明白|了解|好|嗯|ok|okay|got\s*it)/i;

/**
 * True when two assistant bubbles are consecutive near-identical opening acks
 * (e.g. streamed「收到，开始 Kimi…」+ send_message「收到，Kimi 调研分 5 步…」).
 * Also true when a short strict opening (收到/好的/…) was already emitted and a
 * later sealed/final again starts with the same class — even if the second is a
 * long bullet-plan intro (>120 chars). Mid-run「继续」+ progress stays distinct.
 */
export function isDuplicateOpeningAck(a: string, b: string): boolean {
  const va = stripThinkContent(a || '').trim();
  const vb = stripThinkContent(b || '').trim();
  if (!va || !vb) return false;
  const na = normalizeAssistantAckKey(va);
  const nb = normalizeAssistantAckKey(vb);
  if (!na || !nb) return false;
  if (na === nb) return true;

  // Short vs short opening-ack shaped (includes「继续」).
  if (va.length <= 120 && vb.length <= 120) {
    if (!OPENING_ACK_RE.test(va) || !OPENING_ACK_RE.test(vb)) return false;
    return true;
  }

  // Short strict opening already out + later text also opens with 收到/好的/…
  // (covers bullet-plan second bubble that the ≤120 gate used to miss).
  const short = va.length <= 120 ? va : vb.length <= 120 ? vb : null;
  const other = short === va ? vb : short === vb ? va : null;
  if (
    short &&
    other &&
    STRICT_OPENING_ACK_RE.test(short) &&
    STRICT_OPENING_ACK_RE.test(other)
  ) {
    return true;
  }
  return false;
}

/**
 * Strip a leading turn-opening ack sentence/line (收到/好的/…).
 * Multiline: drop the first line when it is an opening ack and keep the body.
 */
export function stripLeadingOpeningAckSentence(text: string): string {
  const v = stripThinkContent(text || '').trim();
  if (!STRICT_OPENING_ACK_RE.test(v)) return v;
  const nl = v.search(/\r?\n/);
  if (nl >= 0) {
    const first = v.slice(0, nl).trim();
    const rest = v.slice(nl).replace(/^\r?\n/, '').trim();
    if (STRICT_OPENING_ACK_RE.test(first) && rest) return rest;
  }
  const m = v.match(
    /^(?:收到|好的|明白|了解|好|嗯|ok|okay|got\s*it)[^。.!！？?\n]*(?:[。.!！？?]\s*|[：:]\s*)?/i,
  );
  if (m) return v.slice(m[0].length).trim();
  return v;
}

/**
 * Seal current live text as its own persisted bubble and rotate to a fresh
 * streaming id. No-op when live content is empty. Returns whether a bubble was sealed.
 */
export async function commitLiveAssistantBubble(
  state: LiveAssistantState,
  host: LiveAssistantHost,
  opts?: { meshInterim?: boolean; logLabel?: string },
): Promise<boolean> {
  let raw = state.assistantMsg.content || '';
  if (!raw.trim()) return false;
  let visible = stripThinkContent(raw).trim();
  if (visible && state.lastEmittedVisible && isDuplicateOpeningAck(state.lastEmittedVisible, visible)) {
    const last = stripThinkContent(state.lastEmittedVisible).trim();
    // Short opening already emitted; longer re-open → strip leading 收到, keep body.
    if (
      last.length <= 120 &&
      STRICT_OPENING_ACK_RE.test(last) &&
      STRICT_OPENING_ACK_RE.test(visible)
    ) {
      const rest = stripLeadingOpeningAckSentence(visible);
      if (rest && rest !== visible) {
        raw = rest;
        visible = rest;
        state.assistantMsg.content = rest;
      } else {
        state.assistantMsg.content = '';
        return false;
      }
    } else {
      // Consecutive near-identical opening ack — drop without emitting.
      state.assistantMsg.content = '';
      return false;
    }
  }
  const sealed = persistAssistantContent(raw, host.showThinking);
  state.assistantMsg = {
    ...state.assistantMsg,
    content: sealed,
    ...(opts?.meshInterim ? { meshInterim: true } : {}),
  };
  try {
    await host.storage.upsertAssistantMessage(host.ownerId, { ...state.assistantMsg }, {
      allowRebind: false,
      runId: host.runId,
    });
  } catch (err) {
    console.error(`[okbot] ${opts?.logLabel || 'commit live assistant'} failed`, err);
  }
  host.emit({
    type: 'assistant_message',
    botId: host.ownerId,
    message: { ...state.assistantMsg },
  });
  host.noteCommitted?.(sealed);
  if (visible) state.lastEmittedVisible = visible;
  state.assistantId = createId('msg');
  state.assistantMsg = {
    id: state.assistantId,
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
  };
  return true;
}

/**
 * send_message host: seal any live text, persist a new bubble from `content`,
 * emit to UI, rotate live streaming id (allowRebind: false on emitted rows).
 */
export async function emitAssistantMessageBubble(
  state: LiveAssistantState,
  content: string,
  host: LiveAssistantHost,
): Promise<void> {
  const text = (content || '').trim();
  if (!text) return;

  const liveVisible = stripThinkContent(state.assistantMsg.content || '').trim();
  if (liveVisible && isDuplicateOpeningAck(liveVisible, text)) {
    // Streamed ack ≈ send_message ack: discard live; send_message is canonical.
    state.assistantMsg.content = '';
  } else {
    // Preserve distinct pre-tool streamed narration as its own bubble.
    await commitLiveAssistantBubble(state, host, {
      meshInterim: true,
      logLabel: 'commit live before send_message',
    });
  }

  const sendVisible = stripThinkContent(text).trim();
  if (
    sendVisible &&
    state.lastEmittedVisible &&
    isDuplicateOpeningAck(state.lastEmittedVisible, sendVisible)
  ) {
    // Other tool already sealed a near-identical opening ack this turn.
    return;
  }

  const sealed = persistAssistantContent(text, host.showThinking);
  state.assistantMsg = {
    ...state.assistantMsg,
    content: sealed,
  };
  try {
    await host.storage.upsertAssistantMessage(host.ownerId, { ...state.assistantMsg }, {
      allowRebind: false,
      runId: host.runId,
    });
  } catch (err) {
    console.error('[okbot] emit assistant message failed', err);
  }
  host.emit({
    type: 'assistant_message',
    botId: host.ownerId,
    message: { ...state.assistantMsg },
  });
  host.noteCommitted?.(sealed);
  if (sendVisible) state.lastEmittedVisible = sendVisible;

  state.assistantId = createId('msg');
  state.assistantMsg = {
    id: state.assistantId,
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Tool-interrupt live reset (non-streaming friendly):
 * - User-visible narration → seal as its own bubble (`assistant_message`), rotate id.
 * - Think-only / empty → discard silently (never emit a blank UI row).
 */
export async function clearLiveAssistantForTools(
  state: LiveAssistantState,
  host: LiveAssistantHost,
): Promise<void> {
  const raw = state.assistantMsg.content || '';
  if (!raw.trim()) return;
  const visible = stripThinkContent(raw).trim();
  if (visible) {
    await commitLiveAssistantBubble(state, host, {
      meshInterim: true,
      logLabel: 'commit live before tools',
    });
    return;
  }
  state.assistantMsg.content = '';
}

