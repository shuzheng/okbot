import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package version when Electron `app.getVersion()` is unavailable (`okbot serve`). */
export function readDesktopAppVersion(fromDir = path.dirname(fileURLToPath(import.meta.url))): string {
  const candidates = [
    path.join(fromDir, '..', 'package.json'),
    path.join(fromDir, '..', '..', 'package.json'),
    path.join(fromDir, '..', '..', 'desktop', 'package.json'),
  ];
  for (const file of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: unknown; version?: unknown };
      const name = typeof raw?.name === 'string' ? raw.name : '';
      const version = typeof raw.version === 'string' ? raw.version.trim() : '';
      if (!version) continue;
      if (name === '@okbot/gateway' || name === '@okbot/desktop') return version;
      if (path.basename(path.dirname(file)) === 'gateway' || path.basename(path.dirname(file)) === 'desktop') {
        return version;
      }
    } catch {
      /* try next */
    }
  }
  return '';
}
