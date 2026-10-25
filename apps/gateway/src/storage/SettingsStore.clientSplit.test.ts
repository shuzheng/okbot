import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from './SettingsStore';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-settings-split-'));
const settingsPath = path.join(tmp, 'server.json');

fs.writeFileSync(
  settingsPath,
  JSON.stringify(
    {
      theme: 'dark',
      language: 'en',
      closeAction: 'tray',
      notifications: false,
      timezone: 'Asia/Shanghai',
      model: { providers: [], defaultProviderId: '', defaultModelId: '' },
      developerMode: true,
    },
    null,
    2,
  ),
  'utf8',
);

const store = new SettingsStore(tmp, settingsPath);
const settings = store.getSettings();
// Gateway read returns default chrome placeholders (client overlay is Electron's job).
assert.equal(settings.theme, 'system');
assert.equal(settings.timezone, 'Asia/Shanghai');

const peeled = store.takePeeledClientSettings();
assert.ok(peeled);
assert.equal(peeled!.theme, 'dark');
assert.equal(peeled!.language, 'en');
assert.equal(peeled!.closeAction, 'tray');
assert.equal(peeled!.developerMode, true);

// Disk rewritten without client chrome.
const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
assert.equal('theme' in raw, false);
assert.equal('language' in raw, false);
assert.equal('closeAction' in raw, false);
assert.equal(raw.timezone, 'Asia/Shanghai');

const saved = store.saveSettings({
  ...settings,
  theme: 'light',
  timezone: 'UTC',
} as typeof settings);
assert.equal(saved.timezone, 'UTC');
const raw2 = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
assert.equal('theme' in raw2, false);
assert.equal(raw2.timezone, 'UTC');

console.log('SettingsStore.clientSplit.test.ts: ok');
