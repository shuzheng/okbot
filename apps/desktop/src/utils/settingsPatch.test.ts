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
  const patch = {
    theme: 'light' as const,
    closeAction: 'quit' as const,
    notifications: false,
    language: 'en' as const,
    timezone: 'Asia/Shanghai',
  };
  const stripped = omitGatewayDesktopOnlySettings(patch);
  assert.equal('closeAction' in stripped, false);
  assert.equal('theme' in stripped, false);
  assert.equal('notifications' in stripped, false);
  assert.equal('language' in stripped, false);
  assert.equal(stripped.timezone, 'Asia/Shanghai');
  // Merging the stripped patch must not overwrite disk client chrome.
  const next = mergeSettingsPatch(disk, stripped);
  assert.equal(next.closeAction, 'tray');
  assert.equal(next.theme, 'dark');
  assert.equal(next.timezone, 'Asia/Shanghai');
}

console.log('settingsPatch.test.ts: ok');
