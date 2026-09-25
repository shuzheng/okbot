import { Fragment, memo, type ReactNode, type RefObject } from 'react';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import { SQUAD_CAPTAIN_SPEAKER_ID, type Bot, type ChatMessage, type Squad } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import type { ToolCard, TurnPhase } from '../../types';
import { FlatAvatar } from '../../components/ui/avatars';
import { CopyIcon } from '../../components/ui/icons';
import { BotOnboarding } from '../bots/BotOnboarding';
import { AssistantContent } from './AssistantContent';
import { ToolCardView } from './ToolCardView';

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
  hasMoreOlder: boolean;
  highlightMessageId: string | null;
  showJumpToBottom: boolean;
  error: string;
  messagesBoxRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  onOpenPromptContext: (messageId: string) => void;
  onQuoteMessage: (message: ChatMessage) => void;
  onCopyMessage: (message: ChatMessage) => void;
  onViewTokenUsage: (message: ChatMessage) => void;
  onJumpToQuotedMessage: (messageId: string) => void;
  onJumpToBottom: () => void;
  onRetrySend: (message: ChatMessage) => void;
  onBotOnboardingDone: (updated: Bot) => void;
  onApproveTool: (requestId: string) => void;
  onDenyTool: (requestId: string) => void;
  onApproveToolForever: (card: ToolCard) => void;
  composerSlot: ReactNode;
  /** Per resolved model: show `<think>` as collapsible (default true). */
  showThinking?: boolean;
};

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
  hasMoreOlder,
  highlightMessageId,
  showJumpToBottom,
  error,
  messagesBoxRef,
  bottomRef,
  onOpenPromptContext,
  onQuoteMessage,
  onCopyMessage,
  onViewTokenUsage,
  onJumpToQuotedMessage,
  onJumpToBottom,
  onRetrySend,
  onBotOnboardingDone,
  onApproveTool,
  onDenyTool,
  onApproveToolForever,
  composerSlot,
  showThinking = true,
}: ChatTranscriptProps) {
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
        <div className="messages scroll-fade" ref={messagesBoxRef}>
          {loadingOlder ? (
            <div className="messages-page-hint">{t(lang, 'loadEarlierMessages')}</div>
          ) : hasMoreOlder ? (
            <div className="messages-page-hint">{t(lang, 'scrollLoadEarlier')}</div>
          ) : null}
          {selectedBot && selectedBot.onboardingComplete === false ? (
            <BotOnboarding lang={lang} bot={selectedBot} onDone={onBotOnboardingDone} />
          ) : messages.length === 0 && !busy ? (
            <div className="placeholder">
              {selectedSquad
                ? t(lang, 'squadEmptyHint', { name: selectedSquad.name })
                : t(lang, 'emptyChatHint', { name: selectedBot!.name })}
            </div>
          ) : null}
          {messages.map((m) => {
            const cardsForMsg = toolCards.filter((c) => c.messageId === m.id);
            const hideEmptyAssistant = m.role === 'assistant' && !m.content && busy;
            const showCtx = m.role === 'user';
            const isSquadAssistant = !!(selectedSquad && m.role === 'assistant');
            const speakerId = isSquadAssistant ? m.speakerBotId || SQUAD_CAPTAIN_SPEAKER_ID : null;
            const isCaptainSpeaker =
              isSquadAssistant &&
              (!speakerId ||
                speakerId === SQUAD_CAPTAIN_SPEAKER_ID ||
                !bots.some((b) => b.id === speakerId));
            const speakerBot =
              speakerId && !isCaptainSpeaker
                ? bots.find((b) => b.id === speakerId) ?? null
                : null;
            // Captain replies: no avatar / no has-speaker gap. Members keep FlatAvatar.
            const showMemberAvatar = isSquadAssistant && !isCaptainSpeaker;
            return (
              <Fragment key={m.id}>
                {cardsForMsg.map((card) => renderToolCard(card))}
                {hideEmptyAssistant ? null : (
                  <div
                    data-message-id={m.id}
                    className={`bubble-row ${m.role === 'user' ? 'user' : 'assistant'}${
                      highlightMessageId === m.id ? ' message-highlight' : ''
                    }${showMemberAvatar ? ' has-speaker' : ''}`}
                  >
                    {showMemberAvatar ? (
                      <FlatAvatar
                        className="bubble-speaker-avatar"
                        emoji={speakerBot?.emoji || '🤖'}
                        color={speakerBot?.color || '#6366F1'}
                        avatarKind={speakerBot?.avatarKind}
                        botAvatarType={speakerBot?.botAvatarType}
                        title={speakerBot?.name || speakerId || ''}
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
                        <div className="bubble-body-row">
                          <div className="bubble-actions">
                            <button
                              type="button"
                              className="bubble-action-btn"
                              title={t(lang, 'copyMessage')}
                              aria-label={t(lang, 'copyMessage')}
                              onClick={() => onCopyMessage(m)}
                            >
                              <CopyIcon />
                            </button>
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
                          <div
                            className={`bubble user${
                              m.sendStatus === 'failed'
                                ? ' send-failed'
                                : m.sendStatus === 'pending'
                                  ? ' send-pending'
                                  : ''
                            }`}
                          >
                            {m.content}
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
                        </div>
                      </div>
                    ) : (
                      <div className="bubble-body-row bubble-body-row-assistant">
                        <div className="bubble assistant">
                          <AssistantContent
                            lang={lang}
                            content={m.content}
                            showThinking={showThinking}
                          />
                        </div>
                        <div className="bubble-actions">
                          <button
                            type="button"
                            className="bubble-action-btn"
                            title={t(lang, 'viewTokenUsage')}
                            aria-label={t(lang, 'viewTokenUsage')}
                            onClick={() => onViewTokenUsage(m)}
                          >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                              <path d="M4 19V5M4 19h16" />
                              <path d="M8 15v-4M12 15V8M16 15v-7" />
                            </svg>
                          </button>
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
                          <button
                            type="button"
                            className="bubble-action-btn"
                            title={t(lang, 'copyMessage')}
                            aria-label={t(lang, 'copyMessage')}
                            onClick={() => onCopyMessage(m)}
                          >
                            <CopyIcon />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Fragment>
            );
          })}
          {toolCards
            .filter((c) => !messages.some((m) => m.id === c.messageId))
            .map((card) => renderToolCard(card))}
          <div ref={bottomRef} />
        </div>
        {showJumpToBottom ? (
          <button type="button" className="scroll-to-bottom-btn" onClick={onJumpToBottom}>
            {t(lang, 'scrollToBottom')}
          </button>
        ) : null}
      </div>
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
    </>
  );
});function resolvedOrbTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}


