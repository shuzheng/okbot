import type { RefObject } from 'react';
import { BorderBeam } from 'border-beam';
import { ThinkingOrb } from 'thinking-orbs';
import { VoiceBeam } from 'voice-glow';
import { t, type UiLang } from '../../i18n';
import {
  CloseIcon,
  MicIcon,
  MicStopIcon,
} from '../../components/ui/icons';

export type ComposerQuoteDraft = {
  messageId: string;
  preview: string;
};

export type ChatComposerProps = {
  lang: UiLang;
  listening: boolean;
  busy: boolean;
  draft: string;
  quote: ComposerQuoteDraft | null;
  micStream: MediaStream | null;
  placeholder: string;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onDraftChange: (value: string) => void;
  onClearQuote: () => void;
  onSend: () => void;
  onStop: () => void;
  onToggleVoice: () => void;
};

function resolvedOrbTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function ChatComposer({
  lang,
  listening,
  busy,
  draft,
  quote,
  micStream,
  placeholder,
  composerRef,
  onDraftChange,
  onClearQuote,
  onSend,
  onStop,
  onToggleVoice,
}: ChatComposerProps) {
  const hasDraft = Boolean(draft.trim());
  // Mid-run steer: Send stays available whenever there is draft text (not grayed solely for busy).
  const sendDisabled = listening || !hasDraft;
  // Keep Stop explicit and separate while busy; show both Stop+Send when busy+draft.
  const showStop = busy && !listening;
  const showSend = !listening && (hasDraft || !showStop);

  const inner = (
    <div className={`composer-inner${listening ? ' listening' : ''}`}>
      {listening ? (
        <ThinkingOrb
          className="composer-orb"
          state="listening"
          size={20}
          theme={resolvedOrbTheme()}
          aria-label={t(lang, 'listeningAria')}
        />
      ) : null}
      <textarea
        spellCheck={false}
        ref={composerRef}
        readOnly={listening}
        placeholder={listening ? t(lang, 'listening') : placeholder}
        value={draft}
        rows={1}
        onChange={listening ? () => undefined : (e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (listening) {
            e.preventDefault();
            return;
          }
          if (e.key !== 'Enter' || e.shiftKey) return;
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (!hasDraft) return;
          e.preventDefault();
          onSend();
        }}
      />
      <button
        className={`mic-btn${listening ? ' on' : ''}`}
        type="button"
        title={listening ? t(lang, 'stopVoice') : t(lang, 'startVoice')}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleVoice();
        }}
      >
        {listening ? <MicStopIcon /> : <MicIcon />}
      </button>
      {showStop ? (
        <button
          className="send stop"
          type="button"
          onClick={() => onStop()}
          title={t(lang, 'stopGeneration')}
          aria-label={t(lang, 'stopGeneration')}
        >
          <MicStopIcon />
        </button>
      ) : null}
      {showSend ? (
        <button
          className="send"
          type="button"
          disabled={sendDisabled}
          onClick={() => onSend()}
          title={busy && hasDraft ? t(lang, 'sendSteer') : t(lang, 'send')}
          aria-label={busy && hasDraft ? t(lang, 'sendSteer') : t(lang, 'send')}
        >
          ↑
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="composer">
      {quote ? (
        <div className="composer-quote" role="note" aria-label={t(lang, 'quoteMessage')}>
          <div className="composer-quote-bar" aria-hidden />
          <div className="composer-quote-text">{quote.preview}</div>
          <button
            type="button"
            className="composer-quote-dismiss"
            title={t(lang, 'close')}
            aria-label={t(lang, 'close')}
            onClick={onClearQuote}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}
      {listening ? (
        <VoiceBeam
          className="composer-beam"
          type="default"
          theme={resolvedOrbTheme()}
          colorVariant="ocean"
          stream={micStream}
          strength={0.95}
          active
        >
          {inner}
        </VoiceBeam>
      ) : busy ? (
        <BorderBeam
          className="composer-beam"
          size="md"
          theme={resolvedOrbTheme()}
          colorVariant="ocean"
          strength={0.95}
          borderRadius={20}
          duration={2.4}
          active
        >
          {inner}
        </BorderBeam>
      ) : (
        <div className="composer-beam">{inner}</div>
      )}
    </div>
  );
}
