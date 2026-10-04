import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateLocalHttpApiToken, type AppSettings, type RuntimeEvent } from '@okbot/shared';
import { createSkillHotReloadHub } from '@okbot/agent';
import { FileStorage } from './storage';

/**
 * Reuse the saved gateway token. Generate and save one only when none is stored.
 * Does not flip the desktop HTTP API switch. Call only when this process owns
 * the server; attaching to one that is already running must not mint a token.
 */
export function ensureGatewayToken(storage: FileStorage): AppSettings {
  const settings = storage.getSettings();
  if (settings.localHttpApi.token) return settings;
  return storage.saveSettings({
    ...settings,
    localHttpApi: {
      ...settings.localHttpApi,
      token: generateLocalHttpApiToken(),
    },
  });
}

/** Built renderer used when serveUi is on. Dev (`electron/`) and `out/main` both resolve. */
export function resolveGatewayUiRoot(moduleDir = path.dirname(fileURLToPath(import.meta.url))): string {
  // cli.js lives in out/main; the helper is bundled under out/main/chunks.
  const candidates = [
    path.join(moduleDir, '../renderer'),
    path.join(moduleDir, '../../renderer'),
    path.join(moduleDir, '../out/renderer'),
    path.join(moduleDir, '../../out/renderer'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return candidates[0] || path.join(moduleDir, '../renderer');
}

/** Same skill watcher the Electron main process used to start inline. */
export function startSkillWatch(
  storage: FileStorage,
  sendRuntimeEvent: (event: RuntimeEvent) => void,
): () => void {
  const hub = createSkillHotReloadHub({
    resolveBotSkillsDir: (botId) => storage.botSkillsDirPublic(botId),
    globalSkillsDir: storage.globalAgentsSkillsDirPublic(),
    onChange: (change) => {
      if (!change.botId) return;
      sendRuntimeEvent({
        type: 'skills_changed',
        botId: change.botId,
        paths: change.paths,
        at: change.at,
      });
    },
  });
  const sync = () => {
    try {
      hub.watchAll(storage.listBots().map((b) => b.id));
    } catch (err) {
      console.error('[okbot] skill hot-reload watch failed', err);
    }
  };
  sync();
  const timer = setInterval(sync, 15_000);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    hub.stopAll();
  };
}
