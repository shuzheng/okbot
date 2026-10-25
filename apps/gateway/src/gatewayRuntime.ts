import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createGatewayApiTokenEntry,
  generateDistinctGatewayHttpApiToken,
  normalizeGatewayHttpApiSettings,
  type AppSettings,
  type GatewayApiTokenEntry,
  type RuntimeEvent,
} from '@okbot/shared';
import { createSkillHotReloadHub } from '@okbot/agent';
import { FileStorage } from './storage';

/**
 * Reuse saved gateway tokens. Mint at least one access and one admin entry when
 * missing. Syncs legacy `token` / `adminToken` from the list. Does not promote
 * an old single token to admin. Call only when this process owns the server;
 * attaching to one that is already running must not mint tokens.
 */
export function ensureGatewayToken(storage: FileStorage): AppSettings {
  const settings = storage.getSettings();
  const api = normalizeGatewayHttpApiSettings(settings.gatewayHttpApi);
  let apiTokens: GatewayApiTokenEntry[] = [...(api.apiTokens || [])];
  let changed = false;
  const now = new Date().toISOString();

  const mintAvoiding = (role: 'access' | 'admin', avoid: string[]): string => {
    let token = generateDistinctGatewayHttpApiToken(avoid[0] || '', role);
    let guard = 0;
    while (avoid.includes(token) && guard++ < 8) {
      token = generateDistinctGatewayHttpApiToken(token, role);
    }
    return token;
  };

  if (!apiTokens.some((e) => e.role === 'access' && e.token)) {
    const avoid = apiTokens.map((e) => e.token).filter(Boolean);
    apiTokens.push(
      createGatewayApiTokenEntry({
        name: 'User',
        role: 'access',
        token: mintAvoiding('access', avoid),
        createdAt: now,
        updatedAt: now,
      }),
    );
    changed = true;
  }

  if (!apiTokens.some((e) => e.role === 'admin' && e.token)) {
    const avoid = apiTokens.map((e) => e.token).filter(Boolean);
    apiTokens.push(
      createGatewayApiTokenEntry({
        name: 'Admin',
        role: 'admin',
        token: mintAvoiding('admin', avoid),
        createdAt: now,
        updatedAt: now,
      }),
    );
    changed = true;
  }

  // Identical access+admin secrets: remint the admin entry (keep access).
  const accessSecrets = new Set(apiTokens.filter((e) => e.role === 'access').map((e) => e.token));
  apiTokens = apiTokens.map((e) => {
    if (e.role !== 'admin' || !accessSecrets.has(e.token)) return e;
    changed = true;
    const avoid = apiTokens.map((x) => x.token).filter(Boolean);
    return {
      ...e,
      token: mintAvoiding('admin', avoid),
      updatedAt: now,
    };
  });

  const normalized = normalizeGatewayHttpApiSettings({ ...api, apiTokens });
  const prev = settings.gatewayHttpApi;
  const sameLegacy =
    (prev?.token || '') === normalized.token && (prev?.adminToken || '') === normalized.adminToken;
  const prevList = Array.isArray(prev?.apiTokens) ? prev.apiTokens : [];
  const sameList =
    prevList.length === normalized.apiTokens.length &&
    prevList.every((e, i) => e.id === normalized.apiTokens[i]?.id && e.token === normalized.apiTokens[i]?.token);

  if (!changed && sameLegacy && sameList && prevList.length > 0) {
    return settings;
  }

  return storage.saveSettings({
    ...settings,
    gatewayHttpApi: normalized,
  });
}

/**
 * Built desktop renderer used when serveUi is on.
 * Electron: `out/main` / `out/main/chunks` / `electron/` resolve to `out/renderer`.
 * Gateway CLI (`apps/gateway/dist` or `src`): resolve to `apps/desktop/out/renderer`.
 */
export function resolveGatewayUiRoot(moduleDir = path.dirname(fileURLToPath(import.meta.url))): string {
  const candidates = [
    // Electron packaged / electron-vite out/main (+ chunks)
    path.join(moduleDir, '../renderer'),
    path.join(moduleDir, '../../renderer'),
    // Electron source tree (`apps/desktop/electron`)
    path.join(moduleDir, '../out/renderer'),
    path.join(moduleDir, '../../out/renderer'),
    // Gateway CLI: apps/gateway/{dist,src} → apps/desktop/out/renderer
    path.join(moduleDir, '../../desktop/out/renderer'),
    path.join(moduleDir, '../../../desktop/out/renderer'),
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
