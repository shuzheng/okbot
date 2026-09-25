import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Danger styling on the confirm button (deletes). Default true. */
  danger?: boolean;
};

type ConfirmRequest = ConfirmOptions & {
  id: number;
  resolve: (ok: boolean) => void;
};

let seq = 0;
let current: ConfirmRequest | null = null;
const pending: Array<() => void> = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return current;
}

function settle(ok: boolean) {
  const req = current;
  if (!req) return;
  current = null;
  emit();
  req.resolve(ok);
  const next = pending.shift();
  if (next) next();
}

function open(opts: ConfirmOptions): Promise<boolean> {
  const message = String(opts.message ?? '').trim();
  if (!message && !opts.title) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    current = {
      id: ++seq,
      title: opts.title,
      message,
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
      danger: opts.danger !== false,
      resolve,
    };
    emit();
  });
}

/**
 * In-app confirm (replaces `window.confirm`). Resolves true on confirm,
 * false on cancel / Escape / backdrop click. Concurrent calls queue.
 */
export function requestConfirm(opts: ConfirmOptions): Promise<boolean> {
  if (!current) return open(opts);
  return new Promise<boolean>((resolve) => {
    pending.push(() => {
      void open(opts).then(resolve);
    });
  });
}

/** Fixed host — mount once at App root (next to ToastHost). */
export function ConfirmHost() {
  const req = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const titleId = useId();
  const messageId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!req) return;
    const t = window.setTimeout(() => confirmRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        settle(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const root = document.querySelector('.confirm-modal') as HTMLElement | null;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (!active || active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (!active || active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [req]);

  if (typeof document === 'undefined' || !req) return null;

  const cancelLabel = req.cancelLabel?.trim() || 'Cancel';
  const confirmLabel = req.confirmLabel?.trim() || 'OK';
  const danger = req.danger !== false;

  return createPortal(
    <div
      className="confirm-modal-backdrop"
      role="presentation"
      onClick={() => settle(false)}
    >
      <div
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={req.title ? titleId : messageId}
        aria-describedby={req.title ? messageId : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {req.title ? (
          <h3 id={titleId} className="confirm-modal-title">
            {req.title}
          </h3>
        ) : null}
        <p id={messageId} className="confirm-modal-message">
          {req.message}
        </p>
        <div className="confirm-modal-actions">
          <button type="button" className="ghost" onClick={() => settle(false)}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={danger ? 'confirm-danger' : 'primary'}
            onClick={() => settle(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
