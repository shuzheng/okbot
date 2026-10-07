import type { AppSettings } from '@okbot/shared';

/**
 * Re-base a partial settings write on the latest disk snapshot so fields the
 * main process may have written (e.g. remembered `closeAction`) are not rolled
 * back by a stale renderer copy.
 */
export function mergeSettingsPatch(disk: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return { ...disk, ...patch };
}

/**
 * Desktop-only keys a gateway client must not include in a settings write.
 * Echoing a stale `closeAction` (or intentionally changing it) would 409 against
 * `resolveGatewaySettingsWrite`.
 */
export function omitGatewayDesktopOnlySettings<T extends Partial<AppSettings>>(
  patch: T,
): Omit<T, 'closeAction'> {
  const { closeAction: _closeAction, ...rest } = patch;
  return rest;
}
