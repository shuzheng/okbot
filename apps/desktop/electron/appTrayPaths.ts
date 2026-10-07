import fs from 'node:fs';
import path from 'node:path';

/**
 * Candidate icon paths for the system tray / macOS menu bar.
 * On darwin, prefer dedicated black+alpha template assets when present.
 */
export function listTrayIconCandidates(
  resourcesDir: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === 'darwin') {
    return [
      path.join(resourcesDir, 'trayTemplate.png'),
      path.join(resourcesDir, 'trayTemplate@2x.png'),
      path.join(resourcesDir, 'icon.png'),
      path.join(resourcesDir, 'icon-256.png'),
    ];
  }
  return [path.join(resourcesDir, 'icon.png'), path.join(resourcesDir, 'icon-256.png')];
}

/** First existing candidate path, or null when none are on disk. */
export function pickTrayIconPath(
  resourcesDir: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  for (const p of listTrayIconCandidates(resourcesDir, platform)) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Resource dir next to packaged / dev electron output (`out/main` → `resources`). */
export function trayResourcesDir(fromDir: string): string {
  return path.join(fromDir, '../../resources');
}
