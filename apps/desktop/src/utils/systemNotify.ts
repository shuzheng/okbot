/** Thin wrapper over the web Notification API (Electron renderer and browser gateway). */

export function windowIsFocused(): boolean {
  if (typeof document === 'undefined') return true;
  return document.hasFocus() && document.visibilityState !== 'hidden';
}

export function showSystemNotification(opts: {
  title: string;
  body: string;
  /** Same tag replaces the previous notification instead of stacking. */
  tag: string;
  onClick: () => void;
}): void {
  if (typeof Notification === 'undefined') return;
  // Same-origin windows first (cheap), then the host decides per device so a
  // desktop window and a gateway page on one computer do not both notify.
  if (!claimNotification(opts.tag)) return;
  const claimHost = (window as unknown as { okbot?: { claimNotification?: (tag: string) => Promise<boolean> } }).okbot
    ?.claimNotification;
  if (typeof claimHost === 'function') {
    void claimHost(opts.tag)
      .catch(() => true)
      .then((granted) => {
        if (granted) showClaimed(opts);
      });
    return;
  }
  showClaimed(opts);
}

function showClaimed(opts: { title: string; body: string; tag: string; onClick: () => void }): void {
  const show = () => {
    try {
      const n = new Notification(opts.title, { body: opts.body, tag: opts.tag, silent: false });
      n.onclick = () => {
        n.close();
        opts.onClick();
      };
    } catch {
      /* platform refused; unread badge still shows */
    }
  };
  if (Notification.permission === 'granted') {
    show();
    return;
  }
  if (Notification.permission === 'default') {
    void Notification.requestPermission()
      .then((p) => {
        if (p === 'granted') show();
      })
      .catch(() => {});
  }
}

const CLAIM_WINDOW_MS = 5000;

/**
 * Several OkBot windows on one device get the same event. The first window to
 * claim a tag shows the notification; the others skip it for a short time.
 * localStorage is shared by same-origin windows, so this works across windows.
 */
export function claimNotification(tag: string, now = Date.now()): boolean {
  try {
    const key = `okbot.notify.${tag}`;
    const last = Number(localStorage.getItem(key) || 0);
    if (Number.isFinite(last) && now - last >= 0 && now - last < CLAIM_WINDOW_MS) return false;
    localStorage.setItem(key, String(now));
  } catch {
    /* no storage: show it */
  }
  return true;
}
