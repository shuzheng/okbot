import type { ThemeMode } from '@okbot/shared';

/** Resolve settings theme to a concrete light|dark using OS preference for `system`. */
export function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

/**
 * Always set a concrete `data-theme` (never remove it).
 * Styles that only lighten under `:root[data-theme='light']` (no prefers-color-scheme twin)
 * would stay dark if system mode left the attribute unset while CSS variables followed the OS.
 */
export function applyTheme(theme: ThemeMode) {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved;
}

/** Subscribe to OS color-scheme flips; caller should re-call applyTheme('system'). */
export function subscribeSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = () => onChange();
  mq.addEventListener('change', listener);
  return () => mq.removeEventListener('change', listener);
}
