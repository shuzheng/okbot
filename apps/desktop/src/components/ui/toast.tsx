import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './icons';

export type ToastKind = 'error' | 'success' | 'info';

type ToastItem = {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: number;
  duration: number;
};

const DEFAULT_MS = 3500;
const DEDUPE_MS = 1500;

let seq = 0;
let items: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function dismiss(id: string) {
  const next = items.filter((t) => t.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
}

function push(kind: ToastKind, message: string, duration = DEFAULT_MS) {
  const text = String(message ?? '').trim();
  if (!text) return;
  const now = Date.now();
  if (
    items.some(
      (t) => t.kind === kind && t.message === text && now - t.createdAt < DEDUPE_MS,
    )
  ) {
    return;
  }
  const id = `toast_${++seq}_${now}`;
  items = [...items, { id, kind, message: text, createdAt: now, duration }];
  emit();
  window.setTimeout(() => dismiss(id), duration);
}

export const toast = {
  error(message: string, opts?: { duration?: number }) {
    push('error', message, opts?.duration ?? DEFAULT_MS);
  },
  success(message: string, opts?: { duration?: number }) {
    push('success', message, opts?.duration ?? DEFAULT_MS);
  },
  info(message: string, opts?: { duration?: number }) {
    push('info', message, opts?.duration ?? DEFAULT_MS);
  },
  dismiss,
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return items;
}

/** Fixed stack host — mount once at App root. */
export function ToastHost({ closeLabel = '关闭' }: { closeLabel?: string }) {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="toast-stack" aria-live="polite" aria-relevant="additions">
      {list.map((item) => (
        <div
          key={item.id}
          className={`toast toast-${item.kind}`}
          role={item.kind === 'error' ? 'alert' : 'status'}
        >
          <span className="toast-message">{item.message}</span>
          <button
            type="button"
            className="toast-close"
            title={closeLabel}
            aria-label={closeLabel}
            onClick={() => dismiss(item.id)}
          >
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
