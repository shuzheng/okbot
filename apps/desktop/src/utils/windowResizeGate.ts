/**
 * Shared window-resize gate for the renderer.
 *
 * While the user is dragging the Electron window edge, Chromium already
 * reflows heavily. Extra JS (scroll-pin, scroll-fade mask toggles) and GPU
 * effects (backdrop-filter / Darwin vibrancy) on every resize event make
 * the drag feel stuttery. Consumers skip per-frame work while
 * `isWindowResizing()` is true and flush once on settle. Sidebar
 * auto-collapse writes `--sidebar-w` immediately (CSS) but defers React
 * setState until settle; CSS snaps `--sidebar-w` (no transition) while
 * this class is on. Main also parks Darwin vibrancy for the drag.
 *
 * Also toggles `html.is-window-resizing` so CSS can drop expensive effects
 * for the duration of the drag without a React re-render.
 *
 * Call `installWindowResizeGate()` once from main.tsx so the class toggles
 * even before chat effects subscribe.
 */

const SETTLE_MS = 120;

let resizing = false;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let listening = 0;
const settleListeners = new Set<() => void>();

function onWindowResize() {
  if (!resizing) {
    resizing = true;
    document.documentElement.classList.add('is-window-resizing');
  }
  if (settleTimer != null) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    resizing = false;
    document.documentElement.classList.remove('is-window-resizing');
    for (const fn of [...settleListeners]) {
      try {
        fn();
      } catch {
        /* ignore listener errors */
      }
    }
  }, SETTLE_MS);
}

export function isWindowResizing(): boolean {
  return resizing;
}

/**
 * Subscribe to resize-settle. Starts the shared window listener on first
 * subscriber; tears it down when the last one unsubscribes.
 */
export function subscribeWindowResizeGate(onSettle: () => void): () => void {
  settleListeners.add(onSettle);
  if (listening === 0) {
    window.addEventListener('resize', onWindowResize);
  }
  listening += 1;
  return () => {
    settleListeners.delete(onSettle);
    listening -= 1;
    if (listening <= 0) {
      listening = 0;
      window.removeEventListener('resize', onWindowResize);
      if (settleTimer != null) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      if (resizing) {
        resizing = false;
        document.documentElement.classList.remove('is-window-resizing');
      }
    }
  };
}

/** Keep the gate listening for the page lifetime (no React dependency). */
let bootUnsub: (() => void) | null = null;
export function installWindowResizeGate(): void {
  if (typeof window === 'undefined') return;
  if (bootUnsub) return;
  bootUnsub = subscribeWindowResizeGate(() => {});
}
