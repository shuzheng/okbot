import assert from 'node:assert/strict';
import {
  CLIENT_SETTINGS_KEYS,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SETTINGS,
  isClientSettingsKey,
  mergeClientGatewaySettings,
  normalizeClientSettings,
  peelClientSettingsFromRaw,
  pickClientSettings,
  splitClientGatewaySettings,
  stripClientSettingsKeys,
} from './dist/index.js';

assert.equal(isClientSettingsKey('theme'), true);
assert.equal(isClientSettingsKey('model'), false);
assert.ok(CLIENT_SETTINGS_KEYS.includes('closeAction'));
assert.ok(CLIENT_SETTINGS_KEYS.includes('translucent'));
assert.ok(CLIENT_SETTINGS_KEYS.includes('settingsNavTab'));
assert.ok(CLIENT_SETTINGS_KEYS.includes('settingsGatewayGroupExpanded'));

{
  const n = normalizeClientSettings({
    theme: 'dark',
    language: 'en',
    hardwareAcceleration: false,
    autoUpdate: false,
    sidebarDockMagnify: true,
    translucent: false,
    developerMode: true,
    notifications: false,
    closeAction: 'tray',
    microphoneId: 'mic-1',
  });
  assert.equal(n.theme, 'dark');
  assert.equal(n.language, 'en');
  assert.equal(n.hardwareAcceleration, false);
  assert.equal(n.autoUpdate, false);
  assert.equal(n.sidebarDockMagnify, true);
  assert.equal(n.translucent, false);
  assert.equal(n.developerMode, true);
  assert.equal(n.notifications, false);
  assert.equal(n.closeAction, 'tray');
  assert.equal(n.microphoneId, 'mic-1');
  assert.equal(n.settingsNavTab, 'general');
  assert.equal(n.settingsClientGroupExpanded, true);
  assert.equal(n.settingsGatewayGroupExpanded, false);
}

{
  const n = normalizeClientSettings({ theme: 'nope', closeAction: 'weird', language: 1 });
  assert.equal(n.theme, 'system');
  assert.equal(n.closeAction, 'ask');
  assert.equal(n.language, 'system');
  assert.equal(n.hardwareAcceleration, true);
  assert.equal(n.translucent, true);
  assert.equal(n.developerMode, false);
  assert.equal(n.settingsNavTab, 'general');
  assert.equal(n.settingsClientGroupExpanded, true);
  assert.equal(n.settingsGatewayGroupExpanded, false);
}

{
  const n = normalizeClientSettings({
    settingsNavTab: 'model',
    settingsClientGroupExpanded: false,
    settingsGatewayGroupExpanded: true,
  });
  assert.equal(n.settingsNavTab, 'model');
  assert.equal(n.settingsClientGroupExpanded, false);
  assert.equal(n.settingsGatewayGroupExpanded, true);
}

{
  const n = normalizeClientSettings({ settingsNavTab: 'computers' });
  assert.equal(n.settingsNavTab, 'gateway');
}


{
  const peeled = peelClientSettingsFromRaw({
    theme: 'light',
    timezone: 'Asia/Shanghai',
    model: { providers: [] },
  });
  assert.equal(peeled.hadClientKeys, true);
  assert.equal(peeled.client.theme, 'light');
}

{
  const peeled = peelClientSettingsFromRaw({ timezone: 'UTC', model: { providers: [] } });
  assert.equal(peeled.hadClientKeys, false);
}

{
  const stripped = stripClientSettingsKeys({
    theme: 'dark',
    timezone: 'UTC',
    notifications: false,
    model: { providers: [] },
  });
  assert.equal('theme' in stripped, false);
  assert.equal('notifications' in stripped, false);
  assert.equal(stripped.timezone, 'UTC');
  assert.ok(stripped.model);
}

{
  const gateway = {
    ...DEFAULT_SETTINGS,
    theme: 'system',
    timezone: 'Asia/Shanghai',
    language: 'zh',
  };
  const client = normalizeClientSettings({ theme: 'dark', language: 'en', closeAction: 'quit' });
  const merged = mergeClientGatewaySettings(gateway, client);
  assert.equal(merged.theme, 'dark');
  assert.equal(merged.language, 'en');
  assert.equal(merged.closeAction, 'quit');
  assert.equal(merged.timezone, 'Asia/Shanghai');
}

{
  const split = splitClientGatewaySettings({
    ...DEFAULT_SETTINGS,
    theme: 'dark',
    timezone: 'Europe/Paris',
  });
  assert.equal(split.client.theme, 'dark');
  assert.equal(split.gateway.timezone, 'Europe/Paris');
  // Gateway half carries default chrome placeholders (stripped on disk).
  assert.equal(split.gateway.theme, DEFAULT_CLIENT_SETTINGS.theme);
}

{
  const picked = pickClientSettings(DEFAULT_SETTINGS);
  assert.equal(picked.theme, DEFAULT_SETTINGS.theme);
  assert.equal(picked.closeAction, DEFAULT_SETTINGS.closeAction);
}

console.log('clientSettings.test.mjs: ok');
