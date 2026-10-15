export function updateScrollFade(el: HTMLElement | null) {
  if (!el) return;
  const { scrollTop, scrollHeight, clientHeight } = el;
  const canScroll = scrollHeight > clientHeight + 1;
  el.classList.toggle('can-scroll', canScroll);
  el.classList.toggle('fade-top', canScroll && scrollTop > 1);
  el.classList.toggle('fade-bottom', canScroll && scrollTop + clientHeight < scrollHeight - 1);
}

/** Nearest ancestor that can accept vertical scroll (overflow auto/scroll). */
export function findVerticalScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.documentElement) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Resolve the outer pane for nested-list wheel passthrough.
 * Prefer `selector` when it is itself scrollable; otherwise walk to a scroll parent
 * (e.g. `.modal` is overflow:hidden while `.form-drawer-body` scrolls).
 */
export function resolveWheelPassOuter(
  el: HTMLElement,
  selector?: string,
): HTMLElement | null {
  if (selector) {
    const hit = el.closest(selector);
    if (hit instanceof HTMLElement) {
      const oy = getComputedStyle(hit).overflowY;
      if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return hit;
    }
  }
  return findVerticalScrollParent(el);
}
