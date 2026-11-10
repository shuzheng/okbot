/**
 * ChatComposer single↔multi line probe helpers.
 *
 * After composer @ mentions wrapped the editable in `.composer-input-wrap`,
 * that wrap's clientWidth is already the text slot (side buttons deducted).
 * Subtracting side chrome from the wrap again made the probe ~154px too
 * narrow and flipped `is-multiline` around ~35 CJK chars.
 */

/** Worst-case attach + gaps + mic + stop + send + inner horizontal pad. */
export const COMPOSER_SIDE_CHROME_FALLBACK = 30 + 8 + 30 + 8 + 28 + 8 + 28 + 14;

export function compactProbeWidth(innerClientWidth: number, sideChrome: number): number {
  return Math.max(64, innerClientWidth - sideChrome);
}

/**
 * Prefer `.composer-inner` width minus side chrome.
 * If only the input-wrap width is known, return it as-is — never subtract
 * chrome again from a width that already excluded the side buttons.
 */
export function resolveCompactProbeWidth(opts: {
  innerClientWidth: number | null | undefined;
  wrapClientWidth: number | null | undefined;
  editableClientWidth: number;
  sideChrome: number;
}): number {
  if (opts.innerClientWidth != null && opts.innerClientWidth > 0) {
    return compactProbeWidth(opts.innerClientWidth, opts.sideChrome);
  }
  const wrap = opts.wrapClientWidth ?? 0;
  if (wrap > 0) return Math.max(64, wrap);
  return Math.max(64, opts.editableClientWidth);
}

/** Enter/leave bandwidth so backspace near 1↔2 lines does not oscillate. */
export function decideComposerMultiline(opts: {
  compactScrollHeight: number;
  singleLinePx: number;
  currentlyMultiline: boolean;
  /** Extra px past one line before entering multiline. */
  enterBandPx?: number;
}): boolean {
  const enterBand = opts.enterBandPx ?? 4;
  const leaveAt = opts.singleLinePx + 0.5;
  const enterAt = leaveAt + enterBand;
  if (opts.currentlyMultiline) {
    return opts.compactScrollHeight > leaveAt;
  }
  return opts.compactScrollHeight > enterAt;
}

/** Animate height only when mode flips and snapped height actually changes. */
export function shouldAnimateComposerHeight(opts: {
  modeChanged: boolean;
  startH: number;
  nextH: number;
}): boolean {
  return opts.modeChanged && opts.startH > 0 && Math.abs(opts.startH - opts.nextH) > 0.5;
}

/**
 * Sum row siblings of `.composer-input-wrap` (attach/orb, mic, stop, send)
 * plus flex gaps and inner horizontal padding. Skips full-width strips
 * like `.composer-attachments`.
 */
export function measureComposerSideChrome(
  inner: HTMLElement,
  inputWrap: HTMLElement | null,
): number {
  const style = getComputedStyle(inner);
  const gap = parseFloat(style.columnGap || style.gap) || 0;
  const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  let buttons = 0;
  let n = 0;
  for (const child of Array.from(inner.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (inputWrap && child === inputWrap) continue;
    if (child.classList.contains('composer-attachments')) continue;
    buttons += child.offsetWidth;
    n += 1;
  }
  if (n === 0) return COMPOSER_SIDE_CHROME_FALLBACK;
  return buttons + n * gap + padX;
}
