import { Fragment, memo, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { BorderBeam } from 'border-beam';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import {
  SQUAD_CAPTAIN_SPEAKER_ID,
  stripThinkContent,
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
  QuoteMessageIcon,
  QuoteReplyIcon,
  ViewPromptContextIcon,
  TokenUsageBarsIcon,
  TurnTraceIcon,
} from '../../components/ui/icons';
import { BubbleMoreMenu } from './BubbleMoreMenu';
import { resolveMessageAttachments } from '../../utils/messageAttachments';
import {
  mediaPathFromAbsolute,
  parseOwnerResourceSrc,
  resolveMediaAssetUrl,
} from '../../utils/mediaAsset';
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
import { OpenTasksPanel } from './OpenTasksPanel';
import type { TaskRecord } from '@okbot/shared';
import { TokenUsagePopover } from './TokenUsagePopover';
import { BubbleSwipeRow, useMessagesSwipeReveal } from './BubbleSwipeRow';
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
  /** Open multi-task queue (pending/in_progress) above the composer. */
  openTasks: TaskRecord[];
  immersiveChat: boolean;
  onToggleImmersiveChat: () => void;
  /** Per resolved model: show `<think>` as collapsible (default false). */
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


/** Usage popover opened from the assistant ··· menu (anchor = more button). */
function BubbleUsageFromMenu({
  lang,
  message,
  modelRef,
  open,
  anchorEl,
  onClose,
}: {
  lang: UiLang;
  message: ChatMessage;
  modelRef?: string;
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <TokenUsagePopover
      lang={lang}
      usage={message.usage}
      modelRef={modelRef}
      anchorEl={anchorEl}
      onClose={onClose}
    />
  );
}

function UserBubbleActions({
  lang,
  message,
  showAdvancedSettings,
  onCopyMessage,
  onOpenPromptContext,
  onQuoteMessage,
}: {
  lang: UiLang;
  message: ChatMessage;
  showAdvancedSettings: boolean;
  onCopyMessage: (message: ChatMessage) => boolean | Promise<boolean>;
  onOpenPromptContext: (messageId: string) => void;
  onQuoteMessage: (message: ChatMessage) => void;
}) {
  const moreItems = showAdvancedSettings
    ? [
        {
          id: 'prompt-context',
          label: t(lang, 'viewPromptContext'),
          icon: <ViewPromptContextIcon />,
          onSelect: () => onOpenPromptContext(message.id),
        },
      ]
    : [];
  return (
    <div className="bubble-actions">
      {moreItems.length ? (
        <BubbleMoreMenu lang={lang} items={moreItems} preferLeft={false} />
      ) : null}
      <BubbleCopyButton lang={lang} message={message} onCopyMessage={onCopyMessage} />
      <button
        type="button"
        className="bubble-action-btn"
        title={t(lang, 'quoteMessage')}
        aria-label={t(lang, 'quoteMessage')}
        onClick={() => onQuoteMessage(message)}
      >
        <QuoteMessageIcon />
      </button>
    </div>
  );
}

function AssistantBubbleActions({
  lang,
  message,
  showAdvancedSettings,
  usageModelRef,
  onCopyMessage,
  onQuoteMessage,
  onViewTurnTrace,
}: {
  lang: UiLang;
  message: ChatMessage;
  showAdvancedSettings: boolean;
  usageModelRef?: string;
  onCopyMessage: (message: ChatMessage) => boolean | Promise<boolean>;
  onQuoteMessage: (message: ChatMessage) => void;
  onViewTurnTrace: (message: ChatMessage) => void;
}) {
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const moreItems = showAdvancedSettings
    ? [
        {
          id: 'token-usage',
          label: t(lang, 'viewTokenUsage'),
          icon: <TokenUsageBarsIcon />,
          onSelect: () => setUsageOpen(true),
        },
        {
          id: 'turn-trace',
          label: t(lang, 'viewTurnTrace'),
          icon: <TurnTraceIcon />,
          onSelect: () => onViewTurnTrace(message),
        },
      ]
    : [];
  return (
    <div className={`bubble-actions${usageOpen ? ' is-pinned' : ''}`}>
      <button
        type="button"
        className="bubble-action-btn"
        title={t(lang, 'quoteMessage')}
        aria-label={t(lang, 'quoteMessage')}
        onClick={() => onQuoteMessage(message)}
      >
        <QuoteReplyIcon />
      </button>
      <BubbleCopyButton lang={lang} message={message} onCopyMessage={onCopyMessage} />
      {moreItems.length ? (
        <BubbleMoreMenu
          lang={lang}
          items={moreItems}
          preferLeft
          buttonRef={moreBtnRef}
        />
      ) : null}
      <BubbleUsageFromMenu
        lang={lang}
        message={message}
        modelRef={usageModelRef}
        open={usageOpen}
        anchorEl={moreBtnRef.current}
        onClose={() => setUsageOpen(false)}
      />
    </div>
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

function MessageAttachImage({
  attachment,
}: {
  attachment: MessageAttachment;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const parsed =
      parseOwnerResourceSrc(attachment.path) ||
      (attachment.path.startsWith('/v1/media/')
        ? parseOwnerResourceSrc(attachment.path)
        : null);
    const assetRel =
      parsed?.assetRel ||
      mediaPathFromAbsolute(attachment.path)?.assetRel ||
      null;
    if (!assetRel) {
      setSrc(null);
      return;
    }
    void resolveMediaAssetUrl(assetRel).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.path]);

  if (!src) {
    return (
      <div className="message-attach-chip" role="listitem" title={attachment.path}>
        <span className="message-attach-chip-icon" aria-hidden>
          <ImageAttachIcon />
        </span>
        <span className="message-attach-chip-name">{attachment.name}</span>
      </div>
    );
  }
  return (
    <a
      className="message-attach-image"
      href={src}
      target="_blank"
      rel="noreferrer"
      role="listitem"
      title={attachment.name}
    >
      <img src={src} alt={attachment.name} loading="lazy" />
    </a>
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
      {attachments.map((a, i) =>
        a.kind === 'image' ? (
          <MessageAttachImage key={`${a.kind}:${a.path}:${i}`} attachment={a} />
        ) : (
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
        ),
      )}
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
  openTasks,
  immersiveChat,
  onToggleImmersiveChat,
  showThinking = false,
  showAdvancedSettings = false,
}: ChatTranscriptProps) {
  const [meshViewMessage, setMeshViewMessage] = useState<ChatMessage | null>(null);
  // Close assistant-to-assistant overlay when the user switches sessions.
  useEffect(() => {
    setMeshViewMessage(null);
  }, [selectedBot?.id, selectedSquad?.id]);
  const sessionOwnerId = selectedSquad ? undefined : selectedBot?.id;
  const meshRecvCollapse = buildMeshReceivedCollapse(messages, sessionOwnerId);
  // Squad has no squad-level color; tint only when 1:1 bot accent is set.
  const userBubbleAccent =
    !selectedSquad && selectedBot && isAvatarAccentHex(selectedBot.color)
      ? selectedBot.color
      : undefined;
  const userBubbleTint = userBubbleTintStyle(userBubbleAccent);

  // Swipe-to-reveal HH:MM on the whole messages area (gaps included).
  useMessagesSwipeReveal(messagesBoxRef);

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
          <div className="messages-content">
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
              (c) => c.messageId === m.id && c.toolName !== 'ask_assistant' && c.toolName !== 'send_message',
            );
            // Hide blank shells and think-only rows (showThinking off → no visible answer).
            const hideEmptyAssistant =
              m.role === 'assistant' &&
              !stripThinkContent(m.content || '').trim() &&
              !(showThinking && (m.content || '').includes('<think'));
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
                          <UserBubbleActions
                            lang={lang}
                            message={m}
                            showAdvancedSettings={showAdvancedSettings}
                            onCopyMessage={onCopyMessage}
                            onOpenPromptContext={onOpenPromptContext}
                            onQuoteMessage={onQuoteMessage}
                          />
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
                        <AssistantBubbleActions
                          lang={lang}
                          message={m}
                          showAdvancedSettings={showAdvancedSettings}
                          usageModelRef={usageModelRef}
                          onCopyMessage={onCopyMessage}
                          onQuoteMessage={onQuoteMessage}
                          onViewTurnTrace={onViewTurnTrace}
                        />
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
                c.toolName !== 'ask_assistant' && c.toolName !== 'send_message' &&
                !messages.some((m) => m.id === c.messageId),
            )
            .map((card) => renderToolCard(card))}
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
          <div ref={bottomRef} />
          </div>
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
        <button
          type="button"
          className="immersive-chat-fab"
          aria-label={t(lang, immersiveChat ? 'immersiveChatExit' : 'immersiveChatEnable')}
          aria-pressed={immersiveChat}
          onClick={onToggleImmersiveChat}
        >
          <ImmersiveChatIcon immersive={immersiveChat} />
        </button>
      </div>
      <OpenTasksPanel lang={lang} tasks={openTasks} />
      <ParallelTasksStrip lang={lang} tasks={parallelTasks} onJump={onJumpParallelTask} />
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


