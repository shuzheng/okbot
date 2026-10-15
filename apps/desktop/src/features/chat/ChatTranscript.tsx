import { Fragment, memo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { BorderBeam } from 'border-beam';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import {
  SQUAD_CAPTAIN_SPEAKER_ID,
  type Bot,
  type ChatMessage,
  type MessageAttachment,
  type Squad,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { QuickTip } from '../../components/ui/QuickTip';
import type { ToolCard, TurnPhase } from '../../types';
import { FlatAvatar } from '../../components/ui/avatars';
import { BotMentionChip } from '../../components/ui/BotMentionChip';
import {
  CheckIcon,
  CopyIcon,
  FileAttachIcon,
  FolderAttachIcon,
  ImageAttachIcon,
  ChevronDownIcon,
  ImmersiveChatIcon,
} from '../../components/ui/icons';
import { resolveMessageAttachments } from '../../utils/messageAttachments';
import { isAvatarAccentHex, userBubbleTintStyle } from '../../utils/userBubbleTint';
import {
  formatSessionUpdatedAt,
  shouldShowMessageTimeDivider,
} from '../../utils/formatSessionUpdatedAt';
import { BotOnboarding } from '../bots/BotOnboarding';
import { AssistantContent } from './AssistantContent';
import { MentionsText } from './MentionsText';
import { ToolCardView } from './ToolCardView';
import { ParallelTasksStrip, type ParallelTask } from './ParallelTasksStrip';
import { TokenUsagePopover } from './TokenUsagePopover';
import { BubbleSwipeRow } from './BubbleSwipeRow';
import { MeshExchangeModal } from './MeshExchangeModal';
import {
  buildMeshReceivedCollapse,
  isMeshReceived,
  meshStatusChipRef,
} from './meshStatusDisplay';

export type ChatTranscriptProps = {
  lang: UiLang;
  messages: ChatMessage[];
  toolCards: ToolCard[];
  bots: Bot[];
  selectedBot: Bot | null;
  selectedSquad: Squad | null;
  busy: boolean;
  turnPhase: TurnPhase;
  turnStatusText: string;
  turnPhaseOrbState: Record<TurnPhase, OrbState>;
  loadingOlder: boolean;
  /** True while switching sessions until history fetch settles. */
  messagesLoading: boolean;
  hasMoreOlder: boolean;
  highlightMessageId: string | null;
  showJumpToBottom: boolean;
  error: string;
  messagesBoxRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  onOpenPromptContext: (messageId: string) => void;
  onQuoteMessage: (message: ChatMessage) => void;
  onCopyMessage: (message: ChatMessage) => boolean | Promise<boolean>;
  /** `ProviderDisplayName/modelNameOrId` for the active chat (usage popover). */
  usageModelRef?: string;
  onViewTurnTrace: (message: ChatMessage) => void;
  onJumpToQuotedMessage: (messageId: string) => void;
  onJumpToBottom: () => void;
  onRetrySend: (message: ChatMessage) => void;
  onBotOnboardingDone: (updated: Bot) => void;
  onApproveTool: (requestId: string) => void;
  onDenyTool: (requestId: string) => void;
  onApproveToolForever: (card: ToolCard) => void;
  composerSlot: ReactNode;
  /** Unfinished parallel turns for this chat (strip only when length > 1). */
  parallelTasks: ParallelTask[];
  onJumpParallelTask: (task: ParallelTask) => void;
  immersiveChat: boolean;
  onToggleImmersiveChat: () => void;
  /** Per resolved model: show `<think>` as collapsible (default true). */
  showThinking?: boolean;
  /** When false, hide view-context / usage / turn-trace bubble actions. */
  showAdvancedSettings?: boolean;
};


/** Legacy 1:1 mesh ask line (`向 @Name 求助：…`) — hide from main transcript. */
const LEGACY_MESH_ASK_RE = /^向\s*@?.+?\s*求助[：:]/;

function isLegacyMeshTrailBubble(m: ChatMessage, isSquad: boolean): boolean {
  if (isSquad || m.role !== 'assistant' || m.meshExchange) return false;
  // Pre-status-row mesh ask/reply used speakerBotId on 1:1 bubbles.
  if (m.speakerBotId?.trim()) return true;
  return LEGACY_MESH_ASK_RE.test((m.content || '').trim());
}

function AttachKindIcon({ kind }: { kind: MessageAttachment['kind'] }) {
  if (kind === 'image') return <ImageAttachIcon />;
  if (kind === 'folder') return <FolderAttachIcon />;
  return <FileAttachIcon />;
}


function BubbleUsageButton({
  lang,
  message,
  modelRef,
}: {
  lang: UiLang;
  message: ChatMessage;
  modelRef?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`bubble-action-btn${open ? ' is-active' : ''}`}
        title={t(lang, 'viewTokenUsage')}
        aria-label={t(lang, 'viewTokenUsage')}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M4 19V5M4 19h16" />
          <path d="M8 15v-4M12 15V8M16 15v-7" />
        </svg>
      </button>
      {open ? (
        <TokenUsagePopover
          lang={lang}
          usage={message.usage}
          modelRef={modelRef}
          anchorEl={btnRef.current}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function BubbleCopyButton({
  lang,
  message,
  onCopyMessage,
}: {
  lang: UiLang;
  message: ChatMessage;
  onCopyMessage: (message: ChatMessage) => boolean | Promise<boolean>;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`bubble-action-btn${copied ? ' copied' : ''}`}
      title={copied ? t(lang, 'messageCopied') : t(lang, 'copyMessage')}
      aria-label={copied ? t(lang, 'messageCopied') : t(lang, 'copyMessage')}
      onClick={() => {
        void (async () => {
          try {
            const ok = await onCopyMessage(message);
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            /* error toast handled upstream */
          }
        })();
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function MessageAttachmentChips({
  attachments,
  lang,
}: {
  attachments: MessageAttachment[];
  lang: UiLang;
}) {
  if (!attachments.length) return null;
  return (
    <div
      className="message-attachments"
      role="list"
      aria-label={t(lang, 'attachSent')}
    >
      {attachments.map((a, i) => (
        <div
          key={`${a.kind}:${a.path}:${i}`}
          className="message-attach-chip"
          role="listitem"
          title={a.path}
        >
          <span className="message-attach-chip-icon" aria-hidden>
            <AttachKindIcon kind={a.kind} />
          </span>
          <span className="message-attach-chip-name">{a.name}</span>
        </div>
      ))}
    </div>
  );
}

export const ChatTranscript = memo(function ChatTranscript({
  lang,
  messages,
  toolCards,
  bots,
  selectedBot,
  selectedSquad,
  busy,
  turnPhase,
  turnStatusText,
  turnPhaseOrbState,
  loadingOlder,
  messagesLoading,
  hasMoreOlder,
  highlightMessageId,
  showJumpToBottom,
  error,
  messagesBoxRef,
  bottomRef,
  onOpenPromptContext,
  onQuoteMessage,
  onCopyMessage,
  usageModelRef,
  onViewTurnTrace,
  onJumpToQuotedMessage,
  onJumpToBottom,
  onRetrySend,
  onBotOnboardingDone,
  onApproveTool,
  onDenyTool,
  onApproveToolForever,
  composerSlot,
  parallelTasks,
  onJumpParallelTask,
  immersiveChat,
  onToggleImmersiveChat,
  showThinking = true,
  showAdvancedSettings = false,
}: ChatTranscriptProps) {
  const [meshViewMessage, setMeshViewMessage] = useState<ChatMessage | null>(null);
  const sessionOwnerId = selectedSquad ? undefined : selectedBot?.id;
  const meshRecvCollapse = buildMeshReceivedCollapse(messages, sessionOwnerId);
  // Squad has no squad-level color; tint only when 1:1 bot accent is set.
  const userBubbleAccent =
    !selectedSquad && selectedBot && isAvatarAccentHex(selectedBot.color)
      ? selectedBot.color
      : undefined;
  const userBubbleTint = userBubbleTintStyle(userBubbleAccent);

  const renderToolCard = (card: ToolCard) => (
    <ToolCardView
      key={card.requestId}
      lang={lang}
      card={card}
      onApprove={onApproveTool}
      onDeny={onDenyTool}
      onApproveForever={onApproveToolForever}
    />
  );

  return (
    <>
      <div className="messages-shell">
        <div
          className={`messages scroll-fade${userBubbleAccent ? ' has-user-bubble-tint' : ''}`}
          style={userBubbleTint as CSSProperties | undefined}
          ref={messagesBoxRef}
        >
          {loadingOlder ? (
            <div className="messages-page-hint">{t(lang, 'loadEarlierMessages')}</div>
          ) : hasMoreOlder ? (
            <div className="messages-page-hint">{t(lang, 'scrollLoadEarlier')}</div>
          ) : null}
          {selectedBot && selectedBot.onboardingComplete === false ? (
            <BotOnboarding lang={lang} bot={selectedBot} onDone={onBotOnboardingDone} />
          ) : messagesLoading ? (
            <div
              className="placeholder messages-history-loading"
              aria-busy="true"
              aria-live="polite"
              aria-label={t(lang, 'loadingChatHistory')}
            >
              <ThinkingOrb
                state="searching"
                size={20}
                theme={resolvedOrbTheme()}
                aria-hidden
              />
              <span className="chat-turn-status-text">{t(lang, 'loadingChatHistory')}</span>
            </div>
          ) : messages.length === 0 && !busy ? (
            <div className="placeholder">
              {selectedSquad
                ? t(lang, 'squadEmptyHint', { name: selectedSquad.name })
                : t(lang, 'emptyChatHint', { name: selectedBot!.name })}
            </div>
          ) : null}
          {messages.map((m, index) => {
            const cardsForMsg = toolCards.filter(
              (c) => c.messageId === m.id && c.toolName !== 'ask_assistant',
            );
            const hideEmptyAssistant = m.role === 'assistant' && !m.content && busy;
            const showCtx = m.role === 'user';
            const isSquadAssistant = !!(selectedSquad && m.role === 'assistant');
            // 1:1 mesh exchanges also tag speakerBotId (ask/reply trail).
            const meshSpeakerId =
              !selectedSquad && m.role === 'assistant' && m.speakerBotId?.trim()
                ? m.speakerBotId.trim()
                : null;
            const speakerId = isSquadAssistant
              ? m.speakerBotId || SQUAD_CAPTAIN_SPEAKER_ID
              : meshSpeakerId;
            const isCaptainSpeaker =
              isSquadAssistant &&
              (!speakerId ||
                speakerId === SQUAD_CAPTAIN_SPEAKER_ID ||
                !bots.some((b) => b.id === speakerId));
            const speakerBot =
              speakerId && !isCaptainSpeaker
                ? bots.find((b) => b.id === speakerId) ?? null
                : null;
            // Squad members + 1:1 mesh peer bubbles keep FlatAvatar; captain has none.
            const showMemberAvatar =
              (!!isSquadAssistant && !isCaptainSpeaker) ||
              (!!meshSpeakerId && !!speakerBot);
            // Name label makes A↔B mesh / squad exchanges scannable (avatar alone is easy to miss).
            const speakerLabel = showMemberAvatar
              ? (speakerBot?.name || '').trim() || speakerId || ''
              : '';
            const userAtts = showCtx ? resolveMessageAttachments(m) : null;
            const userBody = userAtts ? userAtts.body : m.content;
            const userAttachments = userAtts?.attachments ?? [];
            const hasUserBody = Boolean((userBody || '').trim());
            const prevCreatedAt = index > 0 ? messages[index - 1]?.createdAt : null;
            const timeLabel =
              !hideEmptyAssistant && shouldShowMessageTimeDivider(prevCreatedAt, m.createdAt)
                ? formatSessionUpdatedAt(m.createdAt, lang)
                : '';
            if (!selectedSquad && isLegacyMeshTrailBubble(m, false)) {
              return null;
            }
            if (m.meshExchange) {
              if (meshRecvCollapse.skipIds.has(m.id)) {
                return null;
              }
              const chip = meshStatusChipRef(m.meshExchange, sessionOwnerId);
              const chipBot = bots.find((b) => b.id === chip.id) ?? null;
              const chipRef = chipBot
                ? chipBot
                : {
                    id: chip.id,
                    name: chip.name,
                    emoji: '🤖',
                    color: '',
                  };
              const group = meshRecvCollapse.groups.get(m.id);
              const received = isMeshReceived(m.meshExchange);
              const labelText = received
                ? group
                  ? t(lang, 'meshReceivedFromCount', { n: String(group.count) })
                  : t(lang, 'meshReceivedFrom')
                : t(lang, 'meshSentTo');
              const openMessage = group?.openMessage ?? m;
              const openLabel = `${labelText} ${chipRef.name}`;
              return (
                <Fragment key={m.id}>
                  {timeLabel ? (
                    <div className="message-time-divider" role="separator" aria-label={timeLabel}>
                      {timeLabel}
                    </div>
                  ) : null}
                  <div className="mesh-status-row" role="status">
                    <span className="mesh-status-row-text">{labelText}</span>
                    <BotMentionChip
                      bot={chipRef}
                      onClick={() => setMeshViewMessage(openMessage)}
                      aria-label={openLabel}
                    />
                  </div>
                </Fragment>
              );
            }

            return (
              <Fragment key={m.id}>
                {timeLabel ? (
                  <div className="message-time-divider" role="separator" aria-label={timeLabel}>
                    {timeLabel}
                  </div>
                ) : null}
                {cardsForMsg.map((card) => renderToolCard(card))}
                {hideEmptyAssistant ? null : (
                  <BubbleSwipeRow
                    messageId={m.id}
                    createdAt={m.createdAt}
                    role={m.role === 'user' ? 'user' : 'assistant'}
                    className={`bubble-row ${m.role === 'user' ? 'user' : 'assistant'}${
                      highlightMessageId === m.id ? ' message-highlight' : ''
                    }${showMemberAvatar ? ' has-speaker' : ''}`}
                  >
                    {showMemberAvatar ? (
                      <FlatAvatar
                        className="bubble-speaker-avatar"
                        emoji={speakerBot?.emoji || '🤖'}
                        color={speakerBot?.color || ''}
                        avatarKind={speakerBot?.avatarKind}
                        botAvatarType={speakerBot?.botAvatarType}
                        title={speakerBot?.name || speakerId || ''}
                        paused
                      />
                    ) : null}
                    {showCtx ? (
                      <div className="bubble-row-cluster">
                        {m.quoteMessageId && m.quotePreview ? (
                          <button
                            type="button"
                            className="bubble-quote"
                            title={t(lang, 'jumpToQuotedMessage')}
                            aria-label={t(lang, 'jumpToQuotedMessage')}
                            onClick={() => onJumpToQuotedMessage(m.quoteMessageId!)}
                          >
                            <span className="bubble-quote-bar" aria-hidden />
                            <span className="bubble-quote-text">{m.quotePreview}</span>
                          </button>
                        ) : null}
                        <MessageAttachmentChips attachments={userAttachments} lang={lang} />
                        <div className="bubble-body-row">
                          <div className="bubble-actions">
                            <BubbleCopyButton
                              lang={lang}
                              message={m}
                              onCopyMessage={onCopyMessage}
                            />
                            {showAdvancedSettings ? (
                              <button
                                type="button"
                                className="bubble-action-btn"
                                title={t(lang, 'viewPromptContext')}
                                aria-label={t(lang, 'viewPromptContext')}
                                onClick={() => onOpenPromptContext(m.id)}
                              >
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                                </svg>
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="bubble-action-btn"
                              title={t(lang, 'quoteMessage')}
                              aria-label={t(lang, 'quoteMessage')}
                              onClick={() => onQuoteMessage(m)}
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
                                <path d="M7.2 18c1.9 0 3.3-1.5 3.3-3.4 0-1.8-1.3-3.1-3-3.1-.2 0-.5 0-.7.1.3-1.7 1.6-3.1 3.4-3.8L9.4 6C6.3 7.2 4 10 4 14.1 4 16.4 5.4 18 7.2 18zm9.3 0c1.9 0 3.3-1.5 3.3-3.4 0-1.8-1.3-3.1-3-3.1-.2 0-.5 0-.7.1.3-1.7 1.6-3.1 3.4-3.8L18.7 6C15.6 7.2 13.3 10 13.3 14.1c0 2.3 1.4 3.9 3.2 3.9z" />
                              </svg>
                            </button>
                          </div>
                          {m.sendStatus === 'pending' ? (
                            <BorderBeam
                              className="bubble-send-beam"
                              size="pulse-outside"
                              theme={resolvedOrbTheme()}
                              colorVariant="ocean"
                              strength={0.8}
                              borderRadius={16}
                              active
                            >
                              <div
                                className={`bubble user send-pending${
                                  hasUserBody ? '' : ' bubble-attach-only'
                                }`}
                              >
                                {hasUserBody ? <MentionsText text={userBody} bots={bots} /> : null}
                              </div>
                            </BorderBeam>
                          ) : hasUserBody || m.sendStatus === 'failed' ? (
                            <div
                              className={`bubble user${
                                m.sendStatus === 'failed' ? ' send-failed' : ''
                              }${hasUserBody ? '' : ' bubble-attach-only'}`}
                            >
                              {hasUserBody ? <MentionsText text={userBody} bots={bots} /> : null}
                              {m.sendStatus === 'failed' ? (
                                <button
                                  type="button"
                                  className="bubble-send-retry"
                                  title={t(lang, 'retrySend')}
                                  aria-label={t(lang, 'retrySend')}
                                  onClick={() => onRetrySend(m)}
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    width="14"
                                    height="14"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden
                                  >
                                    <path d="M21 12a9 9 0 1 1-2.6-6.2" />
                                    <path d="M21 3v6h-6" />
                                  </svg>
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="bubble-body-row bubble-body-row-assistant">
                        <div className={`bubble assistant${showMemberAvatar ? ' has-speaker-label' : ''}`}>
                          {speakerLabel ? (
                            <div className="bubble-speaker-label">{speakerLabel}</div>
                          ) : null}
                          <AssistantContent
                            lang={lang}
                            content={m.content}
                            showThinking={showThinking}
                            bots={bots}
                          />
                        </div>
                        <div className="bubble-actions">
                          {showAdvancedSettings ? (
                            <>
                              <BubbleUsageButton lang={lang} message={m} modelRef={usageModelRef} />
                              <button
                                type="button"
                                className="bubble-action-btn"
                                title={t(lang, 'viewTurnTrace')}
                                aria-label={t(lang, 'viewTurnTrace')}
                                onClick={() => onViewTurnTrace(m)}
                              >
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                                  <path d="M4 6h8" />
                                  <path d="M4 12h14" />
                                  <path d="M4 18h10" />
                                  <path d="M4 4v16" />
                                </svg>
                              </button>
                            </>
                          ) : null}
                          <button
                            type="button"
                            className="bubble-action-btn"
                            title={t(lang, 'quoteMessage')}
                            aria-label={t(lang, 'quoteMessage')}
                            onClick={() => onQuoteMessage(m)}
                          >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
                              <path d="M7.2 18c1.9 0 3.3-1.5 3.3-3.4 0-1.8-1.3-3.1-3-3.1-.2 0-.5 0-.7.1.3-1.7 1.6-3.1 3.4-3.8L9.4 6C6.3 7.2 4 10 4 14.1 4 16.4 5.4 18 7.2 18zm9.3 0c1.9 0 3.3-1.5 3.3-3.4 0-1.8-1.3-3.1-3-3.1-.2 0-.5 0-.7.1.3-1.7 1.6-3.1 3.4-3.8L18.7 6C15.6 7.2 13.3 10 13.3 14.1c0 2.3 1.4 3.9 3.2 3.9z" />
                            </svg>
                          </button>
                          <BubbleCopyButton
                            lang={lang}
                            message={m}
                            onCopyMessage={onCopyMessage}
                          />
                        </div>
                      </div>
                    )}
                  </BubbleSwipeRow>
                )}
              </Fragment>
            );
          })}
          {toolCards
            .filter(
              (c) =>
                c.toolName !== 'ask_assistant' &&
                !messages.some((m) => m.id === c.messageId),
            )
            .map((card) => renderToolCard(card))}
          <div ref={bottomRef} />
        </div>
        {showJumpToBottom ? (
          <QuickTip text={t(lang, 'scrollToBottom')}>
            <button
              type="button"
              className="scroll-to-bottom-btn"
              aria-label={t(lang, 'scrollToBottom')}
              onClick={onJumpToBottom}
            >
              <ChevronDownIcon />
            </button>
          </QuickTip>
        ) : null}
        <QuickTip text={t(lang, immersiveChat ? 'immersiveChatExit' : 'immersiveChatEnable')}>
        <button
          type="button"
          className="immersive-chat-fab"
          aria-label={t(lang, immersiveChat ? 'immersiveChatExit' : 'immersiveChatEnable')}
          aria-pressed={immersiveChat}
          onClick={onToggleImmersiveChat}
        >
          <ImmersiveChatIcon immersive={immersiveChat} />
        </button>
        </QuickTip>
      </div>
      <ParallelTasksStrip lang={lang} tasks={parallelTasks} onJump={onJumpParallelTask} />
      {busy ? (
        <div className="chat-turn-status" aria-live="polite" aria-label={turnStatusText}>
          <ThinkingOrb
            state={turnPhaseOrbState[turnPhase]}
            size={20}
            theme={resolvedOrbTheme()}
            aria-hidden
          />
          <span className="chat-turn-status-text">{turnStatusText}</span>
        </div>
      ) : null}
      {error ? (
        <div className="hint" style={{ padding: '0 18px', color: 'var(--danger)' }}>
          {error}
        </div>
      ) : null}
      {composerSlot}
      {meshViewMessage?.meshExchange ? (
        <MeshExchangeModal
          lang={lang}
          bots={bots}
          message={meshViewMessage}
          onClose={() => setMeshViewMessage(null)}
        />
      ) : null}
    </>
  );
});function resolvedOrbTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}


