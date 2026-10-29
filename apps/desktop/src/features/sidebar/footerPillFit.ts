export type FooterPillId = 'settings' | 'market' | 'update';

export type FooterPillExtras = 0 | 1 | 2;

export type FooterPillFit = {
  /** Visible pills left→right (subset of candidates). */
  visible: FooterPillId[];
  /**
   * Extra segments the sticky-expanded pill may reveal (0–2).
   * 0 = primary icon only (circle); 2 = full three-slot expand
   * (settings: gear + site + about; market: gallery + assistants + connectors;
   * update: icon + label).
   */
  extras: FooterPillExtras;
};

/** All pills currently cap at two extra slots. */
export function capFooterPillExtras(
  _pill: FooterPillId,
  extras: FooterPillExtras,
): FooterPillExtras {
  return extras > 2 ? 2 : extras;
}

const DEFAULT_CIRCLE = 36;
const DEFAULT_GAP = 8;

function widthNeeded(
  visibleCount: number,
  extras: FooterPillExtras,
  circle: number,
  gap: number,
): number {
  if (visibleCount <= 0) return 0;
  const gaps = (visibleCount - 1) * gap;
  const expandedW = circle * (1 + extras);
  return expandedW + (visibleCount - 1) * circle + gaps;
}

/**
 * Pick which footer pills fit in `availableWidth`.
 *
 * Shrink priority (must match product copy):
 * 1. Keep all candidate buttons; reduce expanded-group extras (2 → 1 → 0).
 * 2. Then drop whole buttons right→left (更新 → 市场 → 设置).
 *
 * Widen restores in reverse (buttons before extras, left before right).
 */
export function fitFooterPills(
  availableWidth: number,
  opts: {
    hasUpdate: boolean;
    circle?: number;
    gap?: number;
  },
): FooterPillFit {
  const circle = opts.circle ?? DEFAULT_CIRCLE;
  const gap = opts.gap ?? DEFAULT_GAP;
  const all: FooterPillId[] = opts.hasUpdate
    ? ['settings', 'market', 'update']
    : ['settings', 'market'];

  const budget = Number.isFinite(availableWidth) ? availableWidth : 0;

  for (let drop = 0; drop < all.length; drop++) {
    const visible = all.slice(0, all.length - drop);
    for (const extras of [2, 1, 0] as const) {
      if (widthNeeded(visible.length, extras, circle, gap) <= budget + 0.5) {
        return { visible, extras };
      }
    }
  }

  return { visible: all.slice(0, 1), extras: 0 };
}

/** Keep sticky expand on a still-visible pill; prefer market, else leftmost. */
export function resolveFooterPillExpanded(
  current: FooterPillId,
  visible: FooterPillId[],
): FooterPillId {
  if (visible.includes(current)) return current;
  if (visible.includes('market')) return 'market';
  return visible[0] ?? 'market';
}
