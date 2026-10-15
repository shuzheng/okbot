import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TokenUsage } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { UsageStackIcon } from '../../components/ui/icons';

const GAP = 8;
const PANEL_MIN_W = 260;

export function formatTokCount(n: number): string {
  const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return `${v.toLocaleString('en-US')} tok`;
}

/** Map persisted TokenUsage into the round-usage popover rows. */
export function deriveRoundUsage(usage: TokenUsage | undefined | null): {
  total: number;
  uncachedInput: number;
  cacheRead: number;
  output: number;
  cacheHitPct: number;
  hasData: boolean;
} {
  const input = Number.isFinite(usage?.input) ? Math.max(0, Math.floor(usage!.input)) : 0;
  const output = Number.isFinite(usage?.output) ? Math.max(0, Math.floor(usage!.output)) : 0;
  const cacheRead = Number.isFinite(usage?.cache) ? Math.max(0, Math.floor(usage!.cache)) : 0;
  // Providers report inputTokens as total prompt tokens; cache is the cached subset.
  const uncachedInput = Math.max(0, input - cacheRead);
  const cacheHitPct = input > 0 ? Math.round((cacheRead / input) * 100) : 0;
  return {
    total: input + output,
    uncachedInput,
    cacheRead,
    output,
    cacheHitPct,
    hasData: Boolean(input || output || cacheRead),
  };
}

type Place = { top: number; left: number };

function placeNearAnchor(anchor: DOMRect): Place {
  const width = Math.max(PANEL_MIN_W, 280);
  const estHeight = 200;
  let left = anchor.right + GAP;
  let top = anchor.top;
  if (left + width > window.innerWidth - 8) {
    left = Math.max(8, anchor.left - width - GAP);
  }
  if (top + estHeight > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - estHeight - 8);
  }
  if (top < 8) top = 8;
  return { top, left };
}

export function TokenUsagePopover({
  lang,
  usage,
  modelRef,
  anchorEl,
  onClose,
}: {
  lang: UiLang;
  usage?: TokenUsage;
  /** `ProviderDisplayName/modelNameOrId` when known. */
  modelRef?: string;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Place | null>(null);
  const derived = deriveRoundUsage(usage);
  const modelLabel = (modelRef || '').trim() || '—';

  useLayoutEffect(() => {
    if (!anchorEl) {
      setBox(null);
      return;
    }
    const update = () => setBox(placeNearAnchor(anchorEl.getBoundingClientRect()));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorEl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointer = (e: MouseEvent | PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t)) return;
      if (anchorEl?.contains(t)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    // Capture so we close before other handlers swallow the event.
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [anchorEl, onClose]);

  if (!anchorEl || !box) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="token-usage-popover"
      role="dialog"
      aria-label={t(lang, 'roundUsageTitle')}
      style={{ top: box.top, left: box.left }}
    >
      <div className="token-usage-popover-header">
        <span className="token-usage-popover-title">
          <UsageStackIcon />
          <span>{t(lang, 'roundUsageTitle')}</span>
        </span>
        <span className="token-usage-popover-total">{formatTokCount(derived.total)}</span>
      </div>
      <div className="token-usage-popover-divider" aria-hidden />
      {derived.hasData ? (
        <div className="token-usage-popover-rows">
          <div className="token-usage-popover-row">
            <span className="k">{t(lang, 'roundUsageProviderModel')}</span>
            <span className="v" title={modelLabel}>
              {modelLabel}
            </span>
          </div>
          <div className="token-usage-popover-row">
            <span className="k">{t(lang, 'roundUsageCacheHit')}</span>
            <span className="v">{derived.cacheHitPct}%</span>
          </div>
          <div className="token-usage-popover-row">
            <span className="k">{t(lang, 'roundUsageUncachedInput')}</span>
            <span className="v">{formatTokCount(derived.uncachedInput)}</span>
          </div>
          <div className="token-usage-popover-row">
            <span className="k">{t(lang, 'roundUsageCacheRead')}</span>
            <span className="v">{formatTokCount(derived.cacheRead)}</span>
          </div>
          <div className="token-usage-popover-row">
            <span className="k">{t(lang, 'roundUsageOutput')}</span>
            <span className="v">{formatTokCount(derived.output)}</span>
          </div>
        </div>
      ) : (
        <p className="token-usage-popover-empty">{t(lang, 'tokenUsageEmpty')}</p>
      )}
    </div>,
    document.body,
  );
}
