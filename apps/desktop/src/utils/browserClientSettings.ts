import {
  DEFAULT_CLIENT_SETTINGS,
  normalizeClientSettings,
  type ClientSettings,
} from '@okbot/shared';

const STORAGE_KEY = 'okbot.clientSettings';

/**
 * Web UI / pure browser client chrome. Electron attach uses IPC instead.
 * Persists in localStorage so theme/language don’t write into gateway server.json.
 */
export function loadBrowserClientSettings(): ClientSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_CLIENT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CLIENT_SETTINGS };
    return normalizeClientSettings(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_CLIENT_SETTINGS };
  }
}

export function saveBrowserClientSettings(settings: ClientSettings): ClientSettings {
  const next = normalizeClientSettings(settings);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* quota / private mode */
    }
  }
  return next;
}
