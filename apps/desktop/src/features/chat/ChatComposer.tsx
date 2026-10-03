import type { RefObject } from 'react';
import { BorderBeam } from 'border-beam';
import { ThinkingOrb } from 'thinking-orbs';
import { VoiceBeam } from 'voice-glow';
import { t, type UiLang } from '../../i18n';
import {
  CloseIcon,
  FileAttachIcon,
  FolderAttachIcon,
  ImageAttachIcon,
  MicIcon,
  MicStopIcon,
} from '../../components/ui/icons';
import { ComposerAttachMenu, type AttachKind } from './ComposerAttachMenu';

export type ComposerQuoteDraft = {
  messageId: string;
  preview: string;
};

export type ComposerAttachment = {
  id: string;
  kind: AttachKind;
  path: string;
  name: string;
};

export type ChatComposerProps = {
  lang: UiLang;
  listening: boolean;
  busy: boolean;
  draft: string;
  quote: ComposerQuoteDraft | null;
  attachments: ComposerAttachment[];
  micStream: MediaStream | null;
  /** Overrides placeholder while listening (e.g. recording / recognizing). */
  voiceStatusLabel?: string;
  placeholder: string;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onDraftChange: (value: string) => void;
  onClearQuote: () => void;
  onRemoveAttachment: (id: string) => void;
  onPickAttach: (kind: AttachKind) => void;
  onSend: () => void;
  onStop: () => void;
  onToggleVoice: () => void;
  computers?: Array<{ id: string; name: string }>;
  computerId?: string;
  onComputerIdChange?: (id: string) => void;
};

function resolvedOrbTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function AttachKindIcon({ kind }: { kind: AttachKind }) {
  if (kind === 'image') return <ImageAttachIcon />;
  if (kind === 'folder') return <FolderAttachIcon />;
  return <FileAttachIcon />;
}

export function ChatComposer({
  lang,
  listening,
  busy,
  draft,
  quote,
  attachments,
  micStream,
  voiceStatusLabel,
  placeholder,
  composerRef,
  onDraftChange,
  onClearQuote,
  onRemoveAttachment,
  onPickAttach,
  onSend,
  onStop,
  onToggleVoice,
  computers,
  computerId,
  onComputerIdChange,
}: ChatComposerProps) {
  const hasDraft = Boolean(draft.trim());
  const hasAttachments = attachments.length > 0;
  const canSend = hasDraft || hasAttachments;
  // Mid-run steer: Send stays available whenever there is draft text or attachments.
  const sendDisabled = listening || !canSend;
  // Keep Stop explicit and separate while busy; show both Stop+Send when busy+draft.
  const showStop = busy && !listening;
  const showSend = !listening && (canSend || !showStop);

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
      ) : (
        <ComposerAttachMenu lang={lang} onPick={onPickAttach} />
      )}
      <textarea
        spellCheck={false}
        ref={composerRef}
        readOnly={listening}
        placeholder={listening ? (voiceStatusLabel || t(lang, 'listeningRecord')) : placeholder}
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
          if (!canSend) return;
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
          title={busy && canSend ? t(lang, 'sendSteer') : t(lang, 'send')}
          aria-label={busy && canSend ? t(lang, 'sendSteer') : t(lang, 'send')}
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
      {hasAttachments ? (
        <div
          className="composer-attachments"
          role="list"
          aria-label={t(lang, 'attachPending')}
        >
          {attachments.map((a) => (
            <div key={a.id} className="composer-attach-chip" role="listitem" title={a.path}>
              <span className="composer-attach-chip-icon" aria-hidden>
                <AttachKindIcon kind={a.kind} />
              </span>
              <span className="composer-attach-chip-name">{a.name}</span>
              <button
                type="button"
                className="composer-attach-chip-x"
                title={t(lang, 'attachRemove')}
                aria-label={t(lang, 'attachRemove')}
                onClick={() => onRemoveAttachment(a.id)}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {computers && computers.length > 0 && onComputerIdChange ? (
        <div className="composer-computer">
          <label className="composer-computer-label">
            <span className="composer-computer-text">{t(lang, 'computer')}</span>
            <select
              className="composer-computer-select"
              value={computerId || 'local'}
              disabled={busy}
              aria-label={t(lang, 'computerSelect')}
              title={t(lang, 'computerSelect')}
              onChange={(e) => onComputerIdChange(e.target.value)}
            >
              {computers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <div className="composer-row">
        {listening && micStream ? (
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
        ) : listening ? (
          <div className="composer-beam composer-beam-static">{inner}</div>
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
    </div>
  );
}
