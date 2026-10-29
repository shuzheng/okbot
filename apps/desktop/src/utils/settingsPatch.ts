import {
  CLIENT_SETTINGS_KEYS,
  stripClientSettingsKeys,
  type AppSettings,
  type ClientSettingsKey,
} from '@okbot/shared';

/**
 * Re-base a partial settings write on the latest disk snapshot so fields the
 * main process may have written (e.g. remembered `closeAction`) are not rolled
 * back by a stale renderer copy.
 */
export function mergeSettingsPatch(disk: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return { ...disk, ...patch };
}

/**
 * Strip client chrome keys before a gateway HTTP settings write.
 * Theme/language/closeAction/etc. live in Electron userData or Web localStorage.
 */
export function omitGatewayDesktopOnlySettings<T extends Partial<AppSettings>>(
  patch: T,
): Omit<T, ClientSettingsKey> {
  return stripClientSettingsKeys(patch as Record<string, unknown>) as Omit<T, ClientSettingsKey>;
}
export { CLIENT_SETTINGS_KEYS };
