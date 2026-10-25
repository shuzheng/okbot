import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeKindTimeline,
  computeWaterfallBars,
  formatCompactDurationMs,
  formatDurationMs,
  type MessageTrace,
  type TurnSpan,
  type TurnSpanKind,
  type TurnSpanStatus,
  type WaterfallBar,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { CheckIcon, CloseIcon, CopyIcon } from '../../components/ui/icons';
import { toast } from '../../components/ui/toast';
import { formatSystemError } from '../../utils/formatSystemError';
import { highlightJson } from '../../utils/highlightJson';

async function copyTextToClipboard(text: string) {
  if (typeof window.okbot?.copyText === 'function') {
    await window.okbot.copyText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

function kindLabel(lang: UiLang, kind: TurnSpanKind): string {
  switch (kind) {
    case 'model':
      return t(lang, 'turnTraceKindModel');
    case 'tool':
      return t(lang, 'turnTraceKindTool');
    case 'wait_approval':
      return t(lang, 'turnTraceKindApproval');
    case 'system':
      return t(lang, 'turnTraceKindSystem');
    default:
      return kind;
  }
}

function statusLabel(lang: UiLang, status: TurnSpanStatus): string {
  switch (status) {
    case 'ok':
      return t(lang, 'turnTraceStatusOk');
    case 'error':
      return t(lang, 'turnTraceStatusError');
    case 'denied':
      return t(lang, 'turnTraceStatusDenied');
    case 'aborted':
      return t(lang, 'turnTraceStatusAborted');
    case 'running':
      return t(lang, 'turnTraceStatusRunning');
    default:
      return status;
  }
}

function displayName(span: TurnSpan): string {
  if (span.kind === 'model') return span.name === 'model' ? 'Model' : span.name;
  if (span.kind === 'tool') return span.name.replace(/^tool:/, '');
  if (span.kind === 'wait_approval') return span.name.replace(/^wait_approval:/, '');
  if (span.name === 'compress') return 'compress';
  return span.name;
}

export function TurnTraceModal(props: {
  lang: UiLang;
  trace: MessageTrace | undefined;
  onClose: () => void;
}) {
  const { lang, trace, onClose } = props;
  const [copied, setCopied] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const bars = useMemo(() => (trace ? computeWaterfallBars(trace) : []), [trace]);
  const kindTimeline = useMemo(() => (trace ? computeKindTimeline(trace) : null), [trace]);
  /** Carved model pieces from the header track, keyed by span id (same gaps as agg). */
  const modelPiecesBySpanId = useMemo(() => {
    const map = new Map<string, WaterfallBar[]>();
    const modelRow = kindTimeline?.rows.find((r) => r.kind === 'model');
    if (!modelRow) return map;
    for (const seg of modelRow.segments) {
      const list = map.get(seg.span.id);
      if (list) list.push(seg);
      else map.set(seg.span.id, [seg]);
    }
    return map;
  }, [kindTimeline]);
  const totalMs = useMemo(() => {
    if (!trace) return undefined;
    if (trace.endedAt) {
      const a = Date.parse(trace.startedAt);
      const b = Date.parse(trace.endedAt);
      if (Number.isFinite(a) && Number.isFinite(b)) return Math.max(0, b - a);
    }
    return undefined;
  }, [trace]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current != null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const scrollListToSpan = (spanId: string) => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-span-id="${CSS.escape(spanId)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setHighlightId(spanId);
    if (highlightTimerRef.current != null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightId((cur) => (cur === spanId ? null : cur));
      highlightTimerRef.current = null;
    }, 1200);
  };

  const hasSpans = Boolean(trace && trace.spans.length > 0);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal about-modal turn-trace-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, 'turnTraceTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label={t(lang, 'close')}
        >
          <CloseIcon />
        </button>
        <h2 className="about-name" style={{ fontSize: 18, marginTop: 8 }}>
          {t(lang, 'turnTraceTitle')}
        </h2>
        {!hasSpans ? (
          <p className="about-meta">{t(lang, 'turnTraceEmpty')}</p>
        ) : (
          <>
            <p className="about-meta turn-trace-summary">
              {totalMs != null ? (
                <>
                  {t(lang, 'turnTraceTotal')}: {formatDurationMs(totalMs)}
                  {' · '}
                </>
              ) : null}
              {t(lang, 'turnTraceSteps', { count: String(bars.length) })}
            </p>
            {kindTimeline ? (
              <div className="turn-trace-agg" aria-label={t(lang, 'turnTraceTimeline')}>
                <div className="turn-trace-agg-axis" aria-hidden>
                  {kindTimeline.ticks.map((tick) => (
                    <span
                      key={`${tick.offsetMs}-${tick.label}`}
                      className="turn-trace-agg-tick"
                      style={{ left: `${tick.pct}%` }}
                    >
                      {tick.label}
                    </span>
                  ))}
                </div>
                <div className="turn-trace-agg-rows">
                  {kindTimeline.rows.map((row) => (
                    <div key={row.kind} className={`turn-trace-agg-row kind-${row.kind}`}>
                      <div className="turn-trace-agg-label">
                        <span className="turn-trace-agg-kind">{kindLabel(lang, row.kind)}</span>
                        <span className="turn-trace-agg-total">
                          {formatCompactDurationMs(row.totalMs)}
                        </span>
                      </div>
                      <div className="turn-trace-agg-track">
                        {row.segments.map((seg, index) => (
                          <div
                            key={`${seg.span.id}-${seg.offsetMs}-${index}`}
                            className={`turn-trace-agg-seg kind-${row.kind}${
                              row.kind === 'model' && index % 2 === 1 ? ' alt' : ''
                            } st-${seg.span.status}`}
                            style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
                            title={`${displayName(seg.span)} · ${formatCompactDurationMs(seg.durationMs)}`}
                            onMouseEnter={() => scrollListToSpan(seg.span.id)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div ref={listRef} className="turn-trace-list scroll-fade">
              {bars.map(({ span, leftPct, widthPct, durationMs }) => {
                const open = openId === span.id;
                const highlighted = highlightId === span.id;
                const dur = formatDurationMs(durationMs);
                // Model list bar must match header: carve tool/approval gaps (keep one row).
                const pieces =
                  span.kind === 'model'
                    ? (modelPiecesBySpanId.get(span.id) ?? [{ leftPct, widthPct }])
                    : [{ leftPct, widthPct }];
                return (
                  <div
                    key={span.id}
                    data-span-id={span.id}
                    className={`turn-trace-row kind-${span.kind} status-${span.status}${
                      highlighted ? ' is-highlight' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="turn-trace-row-main"
                      onClick={() => setOpenId(open ? null : span.id)}
                      aria-expanded={open}
                    >
                      <span className="turn-trace-kind">{kindLabel(lang, span.kind)}</span>
                      <span className="turn-trace-name" title={span.name}>
                        {displayName(span)}
                      </span>
                      <span className={`turn-trace-status st-${span.status}`}>
                        {statusLabel(lang, span.status)}
                      </span>
                      <div className="turn-trace-bar-track" aria-hidden>
                        {pieces.map((p, index) => (
                          <div
                            key={`${span.id}-bar-${index}-${'offsetMs' in p ? p.offsetMs : leftPct}`}
                            className={`turn-trace-bar kind-${span.kind}`}
                            style={{ left: `${p.leftPct}%`, width: `${p.widthPct}%` }}
                          />
                        ))}
                      </div>
                      <span className="turn-trace-dur">{dur}</span>
                    </button>
                    {open ? (
                      <div className="turn-trace-detail">
                        {span.inputSummary ? (
                          <div className="turn-trace-detail-block">
                            <div className="turn-trace-detail-label">{t(lang, 'turnTraceInput')}</div>
                            <pre className="turn-trace-detail-body">{span.inputSummary}</pre>
                          </div>
                        ) : null}
                        {span.outputSummary ? (
                          <div className="turn-trace-detail-block">
                            <div className="turn-trace-detail-label">{t(lang, 'turnTraceOutput')}</div>
                            <pre className="turn-trace-detail-body">{span.outputSummary}</pre>
                          </div>
                        ) : null}
                        {span.error ? (
                          <div className="turn-trace-detail-block">
                            <div className="turn-trace-detail-label">{t(lang, 'turnTraceError')}</div>
                            <pre className="turn-trace-detail-body">{span.error}</pre>
                          </div>
                        ) : null}
                        {!span.inputSummary && !span.outputSummary && !span.error ? (
                          <div className="turn-trace-detail-empty">{t(lang, 'turnTraceNoDetail')}</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="turn-trace-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowJson((v) => !v)}
              >
                {showJson ? t(lang, 'turnTraceHideJson') : t(lang, 'turnTraceShowJson')}
              </button>
              <button
                type="button"
                className="btn ghost"
                title={copied ? t(lang, 'turnTraceCopied') : t(lang, 'turnTraceCopy')}
                aria-label={copied ? t(lang, 'turnTraceCopied') : t(lang, 'turnTraceCopy')}
                onClick={() => {
                  if (!trace) return;
                  void (async () => {
                    try {
                      await copyTextToClipboard(JSON.stringify(trace, null, 2));
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1500);
                    } catch (err) {
                      toast.error(formatSystemError(err));
                    }
                  })();
                }}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
                <span>{copied ? t(lang, 'turnTraceCopied') : t(lang, 'turnTraceCopy')}</span>
              </button>
            </div>
            {showJson ? (
              <pre
                className="turn-trace-json"
                dangerouslySetInnerHTML={{
                  __html: highlightJson(JSON.stringify(trace, null, 2)),
                }}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
