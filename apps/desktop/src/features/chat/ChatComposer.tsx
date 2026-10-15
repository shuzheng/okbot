import { memo, useLayoutEffect, useState, type RefObject } from 'react';
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

export const ChatComposer = memo(function ChatComposer({
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
}: ChatComposerProps) {
  // Auto-grow up to 5 lines (matches .composer-inner textarea max-height).
  // Toggle is-multiline when taller than 1 line so CSS can stack textarea full-width
  // above the action row (GrokBot-style), without changing the compact single-line row.
  //
  // Height stability while typing in multi-line mode:
  // - Snap to whole line steps (never apply raw scrollHeight px noise).
  // - Keep CSS height transition off except on intentional single↔multi switches
  //   (grow past 1 line / shrink under 2 lines — slightly slow ease in app.css).
  // - overflow-y hidden until the 5-line cap so the scrollbar gutter cannot
  //   flip wrap width and bounce height by 1–2px every keystroke.
  // - Probe wrap at compact (side-icons) width so soft-wrap enter/exit does not
  //   oscillate when the class itself changes textarea width.
  // - Skip height=0 reset while already at max and content still overflows.
  const [isMultiline, setIsMultiline] = useState(false);
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const linePx = 18;
    const padPx = 10; // textarea vertical padding 5+5
    const maxLines = 5;
    const maxPx = maxLines * linePx + padPx;
    const singleLinePx = linePx + padPx;
    const inner = el.closest('.composer-inner');
    // Prefer live DOM class over React state so we do not re-run this effect
    // (and kill the 1↔N height animation) just to sync isMultiline.
    const currentlyMultiline = Boolean(inner?.classList.contains('is-multiline'));
    const startH = el.offsetHeight;
    const wasAtMax = startH >= maxPx - 0.5;
    // scrollHeight vs clientHeight before any probe (overflow may still be auto).
    const hadOverflow = el.scrollHeight > el.clientHeight + 0.5;

    const parentW = el.parentElement?.clientWidth ?? el.clientWidth;
    // Worst-case side chrome: + | mic | stop | send + gaps + inner horizontal pad.
    const sideChrome = 30 + 8 + 30 + 8 + 28 + 8 + 28 + 14;
    const compactW = Math.max(64, parentW - sideChrome);

    const prevWidth = el.style.width;
    const prevFlex = el.style.flex;
    const prevMinWidth = el.style.minWidth;
    const prevOrder = el.style.order;

    // Never animate through the height=0 probe or same-mode px updates.
    el.style.transition = 'none';
    // Hide scrollbar during measure so gutter cannot change wrap width.
    el.style.overflowY = 'hidden';

    // 1) Decide multi-line from compact wrap (stable vs class-driven width change).
    el.style.flex = '0 0 auto';
    el.style.width = `${compactW}px`;
    el.style.minWidth = `${compactW}px`;
    el.style.height = '0px';
    const compactSh = el.scrollHeight;
    const nextMultiline = compactSh > singleLinePx + 0.5;

    // Apply layout class immediately so display measure + chrome match final mode
    // without waiting for a second React commit (avoids remount/focus risk too).
    inner?.classList.toggle('is-multiline', nextMultiline);

    // 2) Measure display height in the layout we are about to show.
    if (nextMultiline) {
      el.style.flex = '1 0 100%';
      el.style.width = '100%';
      el.style.minWidth = '100%';
      el.style.order = '-1';
    } else {
      el.style.flex = prevFlex;
      el.style.width = prevWidth;
      el.style.minWidth = prevMinWidth;
      el.style.order = prevOrder;
    }

    let contentSh: number;
    if (wasAtMax && hadOverflow && nextMultiline === currentlyMultiline) {
      // Same mode, still over cap — skip second height=0 thrash.
      contentSh = maxPx + 1;
    } else {
      el.style.height = '0px';
      contentSh = el.scrollHeight;
    }

    // Let CSS class own width/flex/order; keep only the pixel height inline.
    el.style.flex = '';
    el.style.width = '';
    el.style.minWidth = '';
    el.style.order = '';

    // Snap to whole lines so subpixel / font-metric noise cannot bounce height.
    const rawLines = Math.max(1, Math.ceil((contentSh - padPx) / linePx - 1e-6));
    const lines = Math.min(maxLines, rawLines);
    const nextH = lines * linePx + padPx;
    const atCap = lines >= maxLines;

    const modeChanged = nextMultiline !== currentlyMultiline;
    // Freeze when already showing this snapped height (continuous typing on same line).
    if (!modeChanged && Math.abs(startH - nextH) < 0.5) {
      el.style.height = `${nextH}px`;
      el.style.overflowY = atCap ? 'auto' : 'hidden';
      // Leave transition:none — typing must not animate 1px noise.
      setIsMultiline((prev) => (prev === nextMultiline ? prev : nextMultiline));
      return;
    }

    if (modeChanged && startH > 0 && Math.abs(startH - nextH) > 0.5) {
      el.style.height = `${startH}px`;
      // Force reflow so the browser registers the start height before transitioning.
      void el.offsetHeight;
      el.style.transition = '';
      el.style.height = `${nextH}px`;
    } else {
      el.style.height = `${nextH}px`;
      // Keep transition disabled for same-mode grow/shrink (2→3 lines etc.).
    }
    el.style.overflowY = atCap ? 'auto' : 'hidden';

    setIsMultiline((prev) => (prev === nextMultiline ? prev : nextMultiline));
  }, [draft, listening, composerRef]);

  const hasDraft = Boolean(draft.trim());
  const hasAttachments = attachments.length > 0;
  const canSend = hasDraft || hasAttachments;
  // Mid-run steer: Send stays available whenever there is draft text or attachments.
  const sendDisabled = listening || !canSend;
  // Keep Stop explicit and separate while busy; show both Stop+Send when busy+draft.
  const showStop = busy && !listening;
  const showSend = !listening && (canSend || !showStop);

  const inner = (
    <div className={`composer-inner${listening ? ' listening' : ''}${isMultiline ? ' is-multiline' : ''}`}>
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
        ) : (
          // Keep BorderBeam mounted when busy toggles (evolve / wrapping_up end).
          // Swapping BorderBeam ↔ div remounted the textarea and stole focus + height.
          <BorderBeam
            className="composer-beam"
            size="md"
            theme={resolvedOrbTheme()}
            colorVariant="ocean"
            strength={0.95}
            borderRadius={20}
            duration={2.4}
            active={busy}
          >
            {inner}
          </BorderBeam>
        )}
      </div>
    </div>
  );
});
