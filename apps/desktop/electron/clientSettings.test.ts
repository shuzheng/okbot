import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getWindowBounds,
  loadClientSettings,
  migrateClientSettingsFromGatewayRaw,
  migrateWindowBoundsFromGatewayRoot,
  saveClientSettings,
  saveWindowBounds,
} from './clientSettings';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-client-settings-'));

{
  const defaults = loadClientSettings(tmp);
  assert.equal(defaults.theme, 'system');
  assert.equal(defaults.closeAction, 'ask');
  assert.ok(fs.existsSync(path.join(tmp, 'client.json')));
}

{
  const saved = saveClientSettings(
    {
      theme: 'dark',
      translucent: false,
      language: 'en',
      microphoneId: '',
      hardwareAcceleration: false,
      autoUpdate: true,
      sidebarDockMagnify: true,
      closeAction: 'tray',
      notifications: false,
      developerMode: true,
      settingsNavTab: 'general',
      settingsClientGroupExpanded: true,
      settingsGatewayGroupExpanded: false,
    },
    tmp,
  );
  assert.equal(saved.theme, 'dark');
  assert.equal(loadClientSettings(tmp).closeAction, 'tray');
  assert.ok(fs.existsSync(path.join(tmp, 'client.json')));
  assert.ok(!fs.existsSync(path.join(tmp, 'client-settings.json')));
}

{
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-client-mig-'));
  const migrated = migrateClientSettingsFromGatewayRaw(
    { theme: 'light', language: 'zh', timezone: 'Asia/Shanghai', model: {} },
    other,
  );
  assert.equal(migrated.theme, 'light');
  assert.equal(migrated.language, 'zh');
  // Second migrate must not clobber an explicit client file with peeled defaults.
  saveClientSettings({ ...migrated, theme: 'dark' }, other);
  const again = migrateClientSettingsFromGatewayRaw(
    { theme: 'light', language: 'zh' },
    other,
  );
  assert.equal(again.theme, 'dark');
}

{
  const gw = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-gw-win-'));
  fs.writeFileSync(
    path.join(gw, 'window.json'),
    JSON.stringify({ x: 10, y: 20, width: 800, height: 600 }),
    'utf8',
  );
  const bounds = migrateWindowBoundsFromGatewayRoot(gw, gw);
  assert.deepEqual(bounds, { x: 10, y: 20, width: 800, height: 600 });
  assert.deepEqual(getWindowBounds(gw), bounds);
  // Nested in client.json — no standalone window.json write path for live config.
  const raw = JSON.parse(fs.readFileSync(path.join(gw, 'client.json'), 'utf8')) as {
    window?: { width: number };
  };
  assert.equal(raw.window?.width, 800);
  saveWindowBounds({ x: 1, y: 2, width: 900, height: 700 }, gw);
  assert.equal(getWindowBounds(gw)?.width, 900);
  const raw2 = JSON.parse(fs.readFileSync(path.join(gw, 'client.json'), 'utf8')) as {
    window?: { width: number };
  };
  assert.equal(raw2.window?.width, 900);
}


{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-client-gw-preserve-'));
  // Seed chrome + nested gateways the way clientGatewayPrefs writes them.
  fs.writeFileSync(
    path.join(root, 'client.json'),
    `${JSON.stringify(
      {
        theme: 'light',
        language: 'en',
        microphoneId: '',
        hardwareAcceleration: true,
        autoUpdate: true,
        sidebarDockMagnify: false,
        translucent: true,
        developerMode: false,
        notifications: true,
        closeAction: 'ask',
        window: { x: 5, y: 6, width: 900, height: 700 },
        gateways: {
          activeId: 'local',
          gateways: [{ id: 'local', label: 'Local', kind: 'local' }],
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  saveClientSettings(
    {
      theme: 'dark',
      translucent: false,
      language: 'zh',
      microphoneId: '',
      hardwareAcceleration: false,
      autoUpdate: false,
      sidebarDockMagnify: true,
      closeAction: 'tray',
      notifications: false,
      developerMode: true,
      settingsNavTab: 'model',
      settingsClientGroupExpanded: true,
      settingsGatewayGroupExpanded: true,
    },
    root,
  );
  saveWindowBounds({ x: 9, y: 9, width: 1000, height: 800 }, root);
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'client.json'), 'utf8')) as {
    theme?: string;
    window?: { width: number };
    gateways?: { activeId?: string; gateways?: unknown[] };
  };
  assert.equal(raw.theme, 'dark');
  assert.equal(raw.window?.width, 1000);
  assert.equal(raw.gateways?.activeId, 'local');
  assert.equal(raw.gateways?.gateways?.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
}


{
  // Atomic write: destination must be complete JSON after save (tmp+rename).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-client-atomic-'));
  saveClientSettings(
    {
      theme: 'light',
      translucent: true,
      language: 'en',
      microphoneId: '',
      hardwareAcceleration: true,
      autoUpdate: true,
      sidebarDockMagnify: false,
      closeAction: 'quit',
      notifications: true,
      developerMode: false,
      settingsNavTab: 'general',
      settingsClientGroupExpanded: false,
      settingsGatewayGroupExpanded: false,
    },
    root,
  );
  const file = path.join(root, 'client.json');
  const raw = fs.readFileSync(file, 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw));
  assert.ok(!fs.existsSync(`${file}.${process.pid}.tmp`));
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('clientSettings.test.ts: ok');
