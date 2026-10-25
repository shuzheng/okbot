/**
 * ~/.okbot on-disk layout helpers + one-shot migration.
 *
 * Target:
 *   ~/.okbot/
 *     client.json      # chrome + window + gateways prefs (nested) — machine-local
 *     server.json      # gateway AppSettings (0600)
 *     runtime.json     # process lock {pid,port,owner}
 *     data/            # bots, squads, usage, memory, logs, owner dirs
 *
 * Legacy names kept in KEEP_AT_ROOT so leftover gateways.json / window.json
 * are not moved into data/ after the client.json fold.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const OKBOT_DIR_NAME = '.okbot';
export const DATA_DIR_NAME = 'data';
export const SERVER_SETTINGS_NAME = 'server.json';
export const RUNTIME_LOCK_NAME = 'runtime.json';
export const LEGACY_SETTINGS_NAME = 'settings.json';
export const LEGACY_LOCK_NAME = 'server.json';
export const LEGACY_WINDOW_NAME = 'window.json';

/** Names that stay at okbotRoot (never moved into data/). */
const KEEP_AT_ROOT = new Set([
  DATA_DIR_NAME,
  'client.json',
  SERVER_SETTINGS_NAME,
  RUNTIME_LOCK_NAME,
  LEGACY_SETTINGS_NAME,
  LEGACY_WINDOW_NAME, // leftover after fold into client.json.window
  'gateways.json', // leftover after fold into client.json.gateways
  'client-gateways.json',
  'client-settings.json',
  'restore-notice.json',
  'okbot-backup.json',
]);

export function defaultOkbotRoot(): string {
  return path.join(os.homedir(), OKBOT_DIR_NAME);
}

export function dataRootFor(okbotRoot: string): string {
  return path.join(okbotRoot, DATA_DIR_NAME);
}

export function serverSettingsPath(okbotRoot: string): string {
  return path.join(okbotRoot, SERVER_SETTINGS_NAME);
}

export function runtimeLockPath(okbotRoot: string): string {
  return path.join(okbotRoot, RUNTIME_LOCK_NAME);
}

const LOCK_ONLY_KEYS = new Set(['pid', 'port', 'owner', 'startedAt', 'version']);

/** True when JSON looks like the process lock, not AppSettings. */
export function looksLikeServerLock(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  const pid = o.pid;
  const port = o.port;
  const owner = o.owner;
  if (!Number.isInteger(pid) || !Number.isInteger(port)) return false;
  if (owner !== 'serve' && owner !== 'electron') return false;
  // Settings always carry model/tools/… — never treat those as a lock.
  if (
    'model' in o ||
    'timezone' in o ||
    'tools' in o ||
    'gatewayHttpApi' in o ||
    'localHttpApi' in o ||
    'computers' in o ||
    'security' in o
  ) {
    return false;
  }
  const keys = Object.keys(o);
  if (keys.length === 0 || keys.length > 6) return false;
  return keys.every((k) => LOCK_ONLY_KEYS.has(k));
}

function readJsonUnknown(file: string): unknown | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function safeRename(from: string, to: string): void {
  if (!fs.existsSync(from)) return;
  if (fs.existsSync(to)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

/**
 * If legacy lock file `server.json` has {pid,port,owner}, rename to `runtime.json`
 * so `server.json` can mean gateway settings.
 */
export function migrateLegacyRuntimeLock(okbotRoot: string): void {
  const runtime = runtimeLockPath(okbotRoot);
  if (fs.existsSync(runtime)) return;
  const legacy = path.join(okbotRoot, LEGACY_LOCK_NAME);
  if (!fs.existsSync(legacy)) return;
  const raw = readJsonUnknown(legacy);
  if (!looksLikeServerLock(raw)) return;
  try {
    fs.renameSync(legacy, runtime);
  } catch (err) {
    console.error('[okbot] migrate runtime lock failed', err);
  }
}

function shouldMoveIntoData(name: string): boolean {
  if (KEEP_AT_ROOT.has(name)) return false;
  if (name.startsWith('settings.json')) return false;
  if (name.startsWith('server.json.')) return false;
  if (name.startsWith('runtime.json.')) return false;
  if (name.startsWith('client.json.')) return false;
  if (name.startsWith('.')) return false;
  return true;
}

/**
 * Move flat durable files/dirs from okbotRoot into okbotRoot/data/ when data/ is absent
 * or empty of the main roster files.
 */
export function migrateFlatDataIntoDataDir(okbotRoot: string): void {
  const dataRoot = dataRootFor(okbotRoot);
  fs.mkdirSync(okbotRoot, { recursive: true });

  const rosterAtData = path.join(dataRoot, 'bots.json');
  const rosterAtRoot = path.join(okbotRoot, 'bots.json');
  // Already migrated (or fresh with data/).
  if (fs.existsSync(rosterAtData) || fs.existsSync(path.join(dataRoot, 'squads.json'))) {
    fs.mkdirSync(dataRoot, { recursive: true });
    return;
  }
  // Nothing flat to move.
  if (!fs.existsSync(rosterAtRoot) && !fs.existsSync(path.join(okbotRoot, 'squads.json'))) {
    // Still ensure data/ exists for new installs; owner dirs may exist without roster.
    let hasFlatOwner = false;
    try {
      for (const name of fs.readdirSync(okbotRoot)) {
        if (!shouldMoveIntoData(name)) continue;
        const abs = path.join(okbotRoot, name);
        try {
          if (fs.statSync(abs).isDirectory() && (name.startsWith('bot_') || name.startsWith('squad_'))) {
            hasFlatOwner = true;
            break;
          }
          if (name === 'logs' || name === 'usage.json' || name === 'memory.md') {
            hasFlatOwner = true;
            break;
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    if (!hasFlatOwner) {
      fs.mkdirSync(dataRoot, { recursive: true });
      return;
    }
  }

  fs.mkdirSync(dataRoot, { recursive: true });
  let names: string[] = [];
  try {
    names = fs.readdirSync(okbotRoot);
  } catch (err) {
    console.error('[okbot] migrate data/ readdir failed', err);
    return;
  }
  for (const name of names) {
    if (!shouldMoveIntoData(name)) continue;
    const from = path.join(okbotRoot, name);
    const to = path.join(dataRoot, name);
    try {
      safeRename(from, to);
    } catch (err) {
      console.error(`[okbot] migrate into data/ failed: ${name}`, err);
    }
  }
}

/**
 * After lock disambiguation: if server.json (settings) missing and settings.json exists,
 * rename to server.json.
 */
export function migrateSettingsFileToServerJson(okbotRoot: string): void {
  const dest = serverSettingsPath(okbotRoot);
  if (fs.existsSync(dest)) {
    // If somehow lock-shaped file is still named server.json, move it aside first.
    const raw = readJsonUnknown(dest);
    if (looksLikeServerLock(raw)) {
      migrateLegacyRuntimeLock(okbotRoot);
      // If rename did not happen (runtime already there), backup lock-shaped file.
      if (fs.existsSync(dest) && looksLikeServerLock(readJsonUnknown(dest))) {
        const aside = `${dest}.lock-aside-${Date.now()}`;
        try {
          fs.renameSync(dest, aside);
        } catch (err) {
          console.error('[okbot] aside lock-shaped server.json failed', err);
          return;
        }
      } else {
        return;
      }
    } else {
      return;
    }
  }
  const legacy = path.join(okbotRoot, LEGACY_SETTINGS_NAME);
  if (!fs.existsSync(legacy)) return;
  // Never treat a lock left at settings.json (shouldn't happen).
  const raw = readJsonUnknown(legacy);
  if (looksLikeServerLock(raw)) return;
  try {
    fs.renameSync(legacy, dest);
  } catch (err) {
    console.error('[okbot] migrate settings.json → server.json failed', err);
  }
}

let migratedRoots = new Set<string>();

/**
 * Idempotent layout migration for one okbotRoot. Safe to call from FileStorage
 * construct and from client config loaders.
 */
export function migrateOkbotLayout(okbotRoot: string): void {
  const root = path.resolve(okbotRoot);
  if (migratedRoots.has(root)) return;
  try {
    fs.mkdirSync(root, { recursive: true });
    // 1) Lock name clash first — free the server.json name for settings.
    migrateLegacyRuntimeLock(root);
    // 2) Settings file rename.
    migrateSettingsFileToServerJson(root);
    // 3) Durable data under data/.
    migrateFlatDataIntoDataDir(root);
    migratedRoots.add(root);
  } catch (err) {
    console.error('[okbot] layout migration failed', err);
  }
}

/** Test helper: allow re-running migration against a fresh temp root. */
export function resetOkbotLayoutMigrationForTests(): void {
  migratedRoots = new Set();
}
