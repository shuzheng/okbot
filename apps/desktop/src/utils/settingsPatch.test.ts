import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, type AppSettings } from '@okbot/shared';
import { mergeSettingsPatch, omitGatewayDesktopOnlySettings } from './settingsPatch';

const disk = { ...DEFAULT_SETTINGS, closeAction: 'tray', theme: 'dark' } as AppSettings;
const merged = mergeSettingsPatch(disk, { theme: 'light' });
assert.equal(merged.theme, 'light');
assert.equal(merged.closeAction, 'tray');

const explicit = mergeSettingsPatch(disk, { closeAction: 'ask' });
assert.equal(explicit.closeAction, 'ask');

{
  const patch = { theme: 'light' as const, closeAction: 'quit' as const, notifications: false };
  const stripped = omitGatewayDesktopOnlySettings(patch);
  assert.equal('closeAction' in stripped, false);
  assert.equal(stripped.theme, 'light');
  assert.equal(stripped.notifications, false);
  // Merging the stripped patch must not overwrite disk closeAction.
  const next = mergeSettingsPatch(disk, stripped);
  assert.equal(next.closeAction, 'tray');
  assert.equal(next.theme, 'light');
}

console.log('settingsPatch.test.ts: ok');
