import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  loadClientJsonFile,
  resolveClientSettingsDir,
  saveClientGatewaysSection,
} from './clientSettings';

const LEGACY_PREFS_FILE = 'gateways.json';
const LEGACY_USERDATA_PREFS = 'client-gateways.json';
const require = createRequire(import.meta.url);

/** Stable id for the built-in local gateway entry. */
export const LOCAL_GATEWAY_ID = 'local';

export type GatewayKind = 'local' | 'remote';

export type ClientGatewayEntry = {
  id: string;
  label: string;
  kind: GatewayKind;
  baseUrl?: string;
  token?: string;
};

export type ClientGatewayPrefs = {
  activeId: string;
  gateways: ClientGatewayEntry[];
};

export function defaultClientGatewayPrefs(): ClientGatewayPrefs {
  return {
    activeId: LOCAL_GATEWAY_ID,
    gateways: [{ id: LOCAL_GATEWAY_ID, label: 'Local', kind: 'local' }],
  };
}
function legacyPrefsPath(okbotRoot?: string): string {
  return path.join(resolveClientSettingsDir(okbotRoot), LEGACY_PREFS_FILE);
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

function asKind(raw: unknown): GatewayKind | null {
  return raw === 'local' || raw === 'remote' ? raw : null;
}

function normalizeEntry(raw: unknown): ClientGatewayEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const label = typeof o.label === 'string' ? o.label.trim() : '';
  const kind = asKind(o.kind);
  if (!id || !label || !kind) return null;
  const entry: ClientGatewayEntry = { id, label, kind };
  if (typeof o.baseUrl === 'string' && o.baseUrl.trim()) {
    entry.baseUrl = o.baseUrl.trim();
  }
  if (typeof o.token === 'string' && o.token.trim()) {
    entry.token = o.token.trim();
  }
  return entry;
}

function normalizePrefs(raw: unknown): ClientGatewayPrefs {
  const fallback = defaultClientGatewayPrefs();
  if (!raw || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  const gateways = Array.isArray(o.gateways)
    ? o.gateways.map(normalizeEntry).filter((g): g is ClientGatewayEntry => !!g)
    : [];
  if (gateways.length === 0) return fallback;
  const activeCandidate = typeof o.activeId === 'string' ? o.activeId.trim() : '';
  const activeId =
    activeCandidate && gateways.some((g) => g.id === activeCandidate)
      ? activeCandidate
      : gateways[0]!.id;
  return {
    activeId,
    gateways,
  };
}

function prefsToJson(prefs: ClientGatewayPrefs): Record<string, unknown> {
  return {
    activeId: prefs.activeId,
    gateways: prefs.gateways,
  };
}

/**
 * Ensure nested `client.json.gateways` exists.
 * Priority: nested section → ~/.okbot/gateways.json → userData client-gateways.json → defaults.
 * Leaves standalone gateways.json in place after a successful fold (same as window.json leftover).
 */
function ensureGatewaysInClientJson(
  okbotRoot?: string,
  legacyUserDataPath?: string,
): ClientGatewayPrefs {
  const root = resolveClientSettingsDir(okbotRoot);
  const client = loadClientJsonFile(root);
  if (client.gateways != null) {
    return normalizePrefs(client.gateways);
  }

  const standalone = readJsonFile(legacyPrefsPath(root));
  if (standalone != null) {
    const prefs = normalizePrefs(standalone);
    saveClientGatewaysSection(prefsToJson(prefs), root);
    return prefs;
  }

  const userData =
    typeof legacyUserDataPath === 'string' && legacyUserDataPath.trim()
      ? legacyUserDataPath.trim()
      : resolveElectronUserData();
  if (userData) {
    const legacyUd = readJsonFile(path.join(userData, LEGACY_USERDATA_PREFS));
    if (legacyUd != null) {
      const prefs = normalizePrefs(legacyUd);
      saveClientGatewaysSection(prefsToJson(prefs), root);
      return prefs;
    }
  }

  return defaultClientGatewayPrefs();
}

export function loadPrefs(okbotRoot?: string, legacyUserDataPath?: string): ClientGatewayPrefs {
  return ensureGatewaysInClientJson(okbotRoot, legacyUserDataPath);
}

export function savePrefs(prefs: ClientGatewayPrefs, okbotRoot?: string): void {
  const next = normalizePrefs(prefs);
  saveClientGatewaysSection(prefsToJson(next), okbotRoot);
}

export function getActive(okbotRoot?: string): ClientGatewayEntry {
  const prefs = loadPrefs(okbotRoot);
  return prefs.gateways.find((g) => g.id === prefs.activeId) ?? prefs.gateways[0]!;
}

export function setActive(id: string, okbotRoot?: string): ClientGatewayPrefs {
  const prefs = loadPrefs(okbotRoot);
  const nextId = id.trim();
  if (!prefs.gateways.some((g) => g.id === nextId)) return prefs;
  prefs.activeId = nextId;
  savePrefs(prefs, okbotRoot);
  return prefs;
}

export function upsertGateway(
  entry: ClientGatewayEntry,
  okbotRoot?: string,
): ClientGatewayPrefs {
  const normalized = normalizeEntry(entry);
  if (!normalized) return loadPrefs(okbotRoot);
  const prefs = loadPrefs(okbotRoot);
  const idx = prefs.gateways.findIndex((g) => g.id === normalized.id);
  if (idx >= 0) {
    prefs.gateways[idx] = normalized;
  } else {
    prefs.gateways.push(normalized);
  }
  savePrefs(prefs, okbotRoot);
  return prefs;
}

/**
 * Remove a gateway by id. The built-in local entry cannot be removed.
 * If the active gateway is removed, activeId falls back to local (or first remaining).
 */
export function removeGateway(id: string, okbotRoot?: string): ClientGatewayPrefs {
  const prefs = loadPrefs(okbotRoot);
  const target = id.trim();
  if (!target || target === LOCAL_GATEWAY_ID) return prefs;
  const next = prefs.gateways.filter((g) => g.id !== target);
  if (next.length === prefs.gateways.length) return prefs;
  prefs.gateways = next.length > 0 ? next : defaultClientGatewayPrefs().gateways;
  if (!prefs.gateways.some((g) => g.id === prefs.activeId)) {
    prefs.activeId = prefs.gateways.some((g) => g.id === LOCAL_GATEWAY_ID)
      ? LOCAL_GATEWAY_ID
      : prefs.gateways[0]!.id;
  }
  savePrefs(prefs, okbotRoot);
  return prefs;
}

