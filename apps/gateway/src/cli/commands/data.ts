import { spawn } from 'node:child_process';
import path from 'node:path';
import { emptyUsageStats } from '@okbot/shared';
import { FileStorage } from '../../storage';
import { resetCorruptJsonFile } from '../../storage/fs';
import { emptyApiTokenUsageStats } from '../../storage/apiTokenUsageStore';
import type { CliMessages } from '../i18n';
import { peelDataDirFlag, reportInstanceFlagError, resolveOkbotRoot } from '../instanceArgs';

function openPath(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'explorer' : 'xdg-open';
    const child = spawn(cmd, [dir], { detached: true, stdio: 'ignore' });
    child.on('error', reject);
    child.unref();
    // Give spawn a tick; open/xdg-open usually exit 0 quickly but we don't wait for the GUI.
    child.on('spawn', () => resolve());
    // If 'spawn' already happened (rare), resolve on next tick
    setTimeout(() => resolve(), 50);
  });
}

/** Basename → default JSON when no corrupt backup is usable. */
const RESET_JSON_FALLBACKS: Record<string, unknown> = {
  'bots.json': [],
  'squads.json': [],
  'usage.json': emptyUsageStats(),
  'server.json': {},
  'settings.json': {},
  'api-token-usage.json': emptyApiTokenUsageStats(),
};

/** Settings live at okbot root; roster/usage live under data/. */
const RESET_JSON_AT_ROOT = new Set(['server.json', 'settings.json']);

/** Resolve absolute path for a reset-json basename (exported for tests). */
export function resolveResetJsonPath(storage: FileStorage, base: string): string {
  const root = RESET_JSON_AT_ROOT.has(base) ? storage.root : storage.dataRoot;
  return path.join(root, base);
}

export async function dataCommand(args: string[], t: CliMessages): Promise<number> {
  const peeled = peelDataDirFlag(args);
  if (!peeled.ok) return reportInstanceFlagError(t, peeled.error);
  const force = peeled.rest.includes('--force');
  const rest = peeled.rest.filter((a) => a !== '--force');
  const storage = new FileStorage(resolveOkbotRoot(peeled.dataDir));
  const root = storage.root;
  const sub = rest[0];

  if (!sub || sub === 'path') {
    console.log(t.dataPath(root));
    return 0;
  }

  if (sub === 'open') {
    console.log(t.dataPath(root));
    try {
      await openPath(root);
      console.log(t.dataOpened(root));
      return 0;
    } catch (err) {
      console.error(t.dataOpenFailed(err instanceof Error ? err.message : String(err)));
      return 1;
    }
  }

  if (sub === 'reset-json') {
    const rel = (rest[1] || '').trim();
    if (
      !rel ||
      rel.includes('..') ||
      path.isAbsolute(rel) ||
      rel.includes('/') ||
      rel.includes('\\')
    ) {
      console.error(t.dataResetJsonUsage);
      return 1;
    }
    const base = path.basename(rel);
    if (!(base in RESET_JSON_FALLBACKS)) {
      console.error(t.dataResetJsonUnknown(base, Object.keys(RESET_JSON_FALLBACKS).join(', ')));
      return 1;
    }
    const unknown = rest.slice(2);
    if (unknown.length > 0) {
      console.error(t.dataResetJsonUsage);
      return 1;
    }
    const file = resolveResetJsonPath(storage, base);
    const result = resetCorruptJsonFile(file, RESET_JSON_FALLBACKS[base], { force });
    if (!result.ok) {
      if (result.code === 'not_corrupt') {
        console.error(t.dataResetJsonNotCorrupt(file));
      } else {
        console.error(t.dataResetJsonFailed(result.error));
      }
      return 1;
    }
    if (result.restored === 'backup' && result.backupPath) {
      console.log(t.dataResetJsonFromBackup(file, result.backupPath));
    } else {
      console.log(t.dataResetJsonFallback(file));
    }
    console.log(t.dataResetJsonRestartHint);
    return 0;
  }

  console.error(t.dataUnknownSub(sub));
  return 1;
}
