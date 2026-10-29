import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  DEFAULT_CLIENT_SETTINGS,
  normalizeClientSettings,
  peelClientSettingsFromRaw,
  type ClientSettings,
} from '@okbot/shared';

const CLIENT_FILE = 'client.json';
const LEGACY_USERDATA_SETTINGS = 'client-settings.json';
const LEGACY_WINDOW_FILE = 'window.json';
const require = createRequire(import.meta.url);

export type WindowBounds = { x: number; y: number; width: number; height: number };

/**
 * On-disk shape: client chrome + optional nested window bounds + gateway prefs.
 * `gateways` is the former standalone gateways.json body (opaque here to avoid
 * a cycle with clientGatewayPrefs).
 */
export type ClientJsonFile = ClientSettings & {
  window?: WindowBounds;
  gateways?: Record<string, unknown>;
};

/**
 * Directory that holds `client.json` (default `~/.okbot`).
 * Pass `okbotRoot` in tests; production uses homedir `.okbot`.
 */
export function resolveClientSettingsDir(okbotRoot?: string): string {
  if (typeof okbotRoot === 'string' && okbotRoot.trim()) {
    return okbotRoot.trim();
  }
  return path.join(os.homedir(), '.okbot');
}

function clientPath(okbotRoot?: string): string {
  return path.join(resolveClientSettingsDir(okbotRoot), CLIENT_FILE);
}

function resolveElectronUserData(): string | null {
  try {
    const { app } = require('electron') as typeof import('electron');
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch {
    /* node tests / no Electron */
  }
  return null;
}

function readJsonFile(file: string): unknown | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function writeClientJsonFile(file: string, data: ClientJsonFile): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, payload, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch (err) {
    console.error('[okbot] chmod client.json failed', err);
  }
}

function normalizeWindowBounds(raw: unknown): WindowBounds | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { x, y, width, height } = raw as Record<string, unknown>;
  if (
    ![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n)) ||
    (width as number) < 400 ||
    (height as number) < 300
  ) {
    return null;
  }
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

function roundWindow(bounds: WindowBounds): WindowBounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  };
}

function readNestedGateways(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return raw as Record<string, unknown>;
}

function readClientJson(okbotRoot?: string): ClientJsonFile | null {
  const raw = readJsonFile(clientPath(okbotRoot));
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const settings = normalizeClientSettings(obj);
  const window = normalizeWindowBounds(obj.window);
  const gateways = readNestedGateways(obj.gateways);
  const base: ClientJsonFile = window ? { ...settings, window } : { ...settings };
  return gateways ? { ...base, gateways } : base;
}

function withPreservedExtras(
  settings: ClientSettings,
  prev: ClientJsonFile | null | undefined,
  windowOverride?: WindowBounds | null,
): ClientJsonFile {
  const window =
    windowOverride !== undefined
      ? windowOverride ?? undefined
      : prev?.window
        ? normalizeWindowBounds(prev.window) ?? undefined
        : undefined;
  const gateways = prev?.gateways ? readNestedGateways(prev.gateways) : undefined;
  const next: ClientJsonFile = { ...settings };
  if (window) next.window = window;
  if (gateways) next.gateways = gateways;
  return next;
}

/**
 * One-shot: seed `~/.okbot/client.json` from userData `client-settings.json`,
 * legacy `window.json` (userData or ~/.okbot), or defaults. Never writes a
 * standalone window.json afterward.
 */
export function ensureClientJsonMigrated(
  okbotRoot?: string,
  legacyUserDataPath?: string,
): ClientJsonFile {
  const root = resolveClientSettingsDir(okbotRoot);
  fs.mkdirSync(root, { recursive: true });
  const file = clientPath(root);
  const existing = readClientJson(root);

  const userData =
    typeof legacyUserDataPath === 'string' && legacyUserDataPath.trim()
      ? legacyUserDataPath.trim()
      : resolveElectronUserData();

  let settingsPart: ClientSettings | null = existing
    ? normalizeClientSettings(existing)
    : null;
  let windowPart: WindowBounds | null = existing?.window
    ? normalizeWindowBounds(existing.window)
    : null;

  if (settingsPart == null && userData) {
    const legacySettings = readJsonFile(path.join(userData, LEGACY_USERDATA_SETTINGS));
    if (legacySettings != null) {
      settingsPart = normalizeClientSettings(legacySettings);
    }
  }

  if (windowPart == null) {
    // Prefer userData window.json, then ~/.okbot/window.json.
    const candidates = [
      userData ? path.join(userData, LEGACY_WINDOW_FILE) : null,
      path.join(root, LEGACY_WINDOW_FILE),
    ].filter(Boolean) as string[];
    for (const cand of candidates) {
      const w = normalizeWindowBounds(readJsonFile(cand));
      if (w) {
        windowPart = w;
        break;
      }
    }
  }

  if (settingsPart == null) {
    settingsPart = { ...DEFAULT_CLIENT_SETTINGS };
  }

  const next: ClientJsonFile = withPreservedExtras(
    settingsPart,
    existing,
    windowPart ? roundWindow(windowPart) : windowPart,
  );

  // Write when missing or when we folded window into chrome-only file.
  const needsWrite =
    !fs.existsSync(file) ||
    (windowPart != null && !(existing && existing.window));
  if (needsWrite) {
    writeClientJsonFile(file, next);
  }
  return next;
}

export function loadClientSettings(okbotRoot?: string): ClientSettings {
  const file = ensureClientJsonMigrated(okbotRoot);
  return normalizeClientSettings(file);
}

export function saveClientSettings(settings: ClientSettings, okbotRoot?: string): ClientSettings {
  const root = resolveClientSettingsDir(okbotRoot);
  const prev = readClientJson(root);
  const nextSettings = normalizeClientSettings(settings);
  const next = withPreservedExtras(nextSettings, prev);
  writeClientJsonFile(clientPath(root), next);
  return nextSettings;
}

/**
 * Merge peeled / partial client prefs into client.json when the file is
 * missing or incomplete (first upgrade after the client/gateway settings split).
 * Existing explicit client.json values win over peeled ones.
 */
export function migrateClientSettingsFromGatewayRaw(
  gatewayRaw: unknown,
  okbotRoot?: string,
): ClientSettings {
  const root = resolveClientSettingsDir(okbotRoot);
  fs.mkdirSync(root, { recursive: true });
  const file = clientPath(root);
  // Do not seed defaults here — that would mask peeled chrome on first upgrade.
  const existingRaw = readJsonFile(file);
  const { client: peeled, hadClientKeys } = peelClientSettingsFromRaw(gatewayRaw);
  if (!hadClientKeys && existingRaw != null) {
    return normalizeClientSettings(existingRaw);
  }
  const prevWindow =
    existingRaw && typeof existingRaw === 'object' && !Array.isArray(existingRaw)
      ? normalizeWindowBounds((existingRaw as Record<string, unknown>).window)
      : null;
  if (existingRaw == null) {
    const nextSettings = hadClientKeys ? peeled : { ...DEFAULT_CLIENT_SETTINGS };
    const next: ClientJsonFile = prevWindow
      ? { ...nextSettings, window: prevWindow }
      : { ...nextSettings };
    writeClientJsonFile(file, next);
    return nextSettings;
  }
  // Client file exists: fill only keys that were never written (incomplete file).
  const existingObj =
    existingRaw && typeof existingRaw === 'object' && !Array.isArray(existingRaw)
      ? (existingRaw as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = { ...peeled, ...existingObj };
  const nextSettings = normalizeClientSettings(merged);
  const window = normalizeWindowBounds(existingObj.window) ?? prevWindow;
  const gateways = readNestedGateways(existingObj.gateways);
  const next: ClientJsonFile = { ...nextSettings };
  if (window) next.window = window;
  if (gateways) next.gateways = gateways;
  writeClientJsonFile(file, next);
  return nextSettings;
}

export function getWindowBounds(okbotRoot?: string): WindowBounds | null {
  const file = ensureClientJsonMigrated(okbotRoot);
  return file.window ? normalizeWindowBounds(file.window) : null;
}

export function saveWindowBounds(bounds: WindowBounds, okbotRoot?: string): void {
  const root = resolveClientSettingsDir(okbotRoot);
  ensureClientJsonMigrated(root);
  const prev = readClientJson(root) ?? { ...DEFAULT_CLIENT_SETTINGS };
  const next = withPreservedExtras(normalizeClientSettings(prev), prev, roundWindow(bounds));
  writeClientJsonFile(clientPath(root), next);
}

/**
 * Fold legacy `~/.okbot/window.json` (and userData window.json via ensure)
 * into `client.json`. Stops writing standalone window.json.
 */
export function migrateWindowBoundsFromGatewayRoot(
  gatewayRoot: string,
  okbotRoot?: string,
): WindowBounds | null {
  const root = resolveClientSettingsDir(okbotRoot ?? gatewayRoot);
  // Seed from gatewayRoot/window.json if present.
  const legacy = path.join(gatewayRoot, LEGACY_WINDOW_FILE);
  const existing = readClientJson(root);
  if (existing?.window) return normalizeWindowBounds(existing.window);

  const fromLegacy = normalizeWindowBounds(readJsonFile(legacy));
  const file = ensureClientJsonMigrated(root);
  if (file.window) return file.window;
  if (fromLegacy) {
    saveWindowBounds(fromLegacy, root);
    return fromLegacy;
  }
  return null;
}

/** Full client.json document (after chrome/window ensure). */
export function loadClientJsonFile(okbotRoot?: string): ClientJsonFile {
  return ensureClientJsonMigrated(okbotRoot);
}

/**
 * Replace nested `gateways` while preserving chrome + window.
 * Used by clientGatewayPrefs after folding standalone gateways.json.
 */
export function saveClientGatewaysSection(
  gateways: Record<string, unknown>,
  okbotRoot?: string,
): ClientJsonFile {
  const root = resolveClientSettingsDir(okbotRoot);
  ensureClientJsonMigrated(root);
  const prev = readClientJson(root) ?? { ...DEFAULT_CLIENT_SETTINGS };
  const next = withPreservedExtras(normalizeClientSettings(prev), prev);
  next.gateways = gateways;
  writeClientJsonFile(clientPath(root), next);
  return next;
}
