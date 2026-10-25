import type { ThemeMode } from '@okbot/shared';

/**
 * Main-process window chrome (nativeTheme / vibrancy) is defined in main.ts.
 * Attach + owner both need IPC access; bind once from main before registering handlers.
 */
let applyWindowTranslucentImpl: ((translucent: boolean) => void) | null = null;
let applyThemeImpl: ((theme: ThemeMode) => void) | null = null;

export function bindWindowChromeFns(fns: {
  applyWindowTranslucent: (translucent: boolean) => void;
  applyTheme: (theme: ThemeMode) => void;
}): void {
  applyWindowTranslucentImpl = fns.applyWindowTranslucent;
  applyThemeImpl = fns.applyTheme;
}

export function invokeApplyWindowTranslucent(translucent: boolean): void {
  applyWindowTranslucentImpl?.(translucent);
}

export function invokeApplyTheme(theme: ThemeMode): void {
  applyThemeImpl?.(theme);
}
