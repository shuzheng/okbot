import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Desktop package version when Electron `app.getVersion()` is unavailable (okbot serve). */
export function readDesktopAppVersion(fromDir = path.dirname(fileURLToPath(import.meta.url))): string {
  const candidates = [
    path.join(fromDir, '..', 'package.json'),
    path.join(fromDir, '..', '..', 'package.json'),
  ];
  for (const file of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: unknown; version?: unknown };
      if (raw?.name === '@okbot/desktop' && typeof raw.version === 'string' && raw.version.trim()) {
        return raw.version.trim();
      }
      if (typeof raw.version === 'string' && raw.version.trim() && path.basename(path.dirname(file)) === 'desktop') {
        return raw.version.trim();
      }
    } catch {
      /* try next */
    }
  }
  return '';
}
