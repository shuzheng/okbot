import { Tray, Menu, BrowserWindow, app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTrayIconCandidates, trayResourcesDir } from './appTrayPaths';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;

export type AppTrayLabels = {
  show: string;
  quit: string;
  tooltip: string;
};

export type AppTrayCallbacks = {
  showWindow: () => void;
  quitApp: () => void;
  labels: AppTrayLabels;
};

export { listTrayIconCandidates, pickTrayIconPath, trayResourcesDir } from './appTrayPaths';

function resolveTrayIcon(): Electron.NativeImage {
  const resourcesDir = trayResourcesDir(__dirname);
  const candidates = listTrayIconCandidates(resourcesDir);
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) continue;
    const base = path.basename(p);
    if (process.platform === 'darwin') {
      const isTemplateAsset = base.startsWith('trayTemplate');
      // @2x template is already 32px; 16px template stays as-is. Colored fallbacks resize to ~18pt.
      const resized = isTemplateAsset
        ? img
        : img.resize({ width: 18, height: 18 });
      if (resized.isEmpty()) continue;
      // Only mark true template assets — setTemplateImage on a colored PNG washes it out.
      if (isTemplateAsset) resized.setTemplateImage(true);
      return resized;
    }
    const resized = img.resize({ width: 16, height: 16 });
    if (resized.isEmpty()) continue;
    return resized;
  }
  return nativeImage.createEmpty();
}

function buildTrayMenu(cb: AppTrayCallbacks): Menu {
  return Menu.buildFromTemplate([
    { label: cb.labels.show, click: () => cb.showWindow() },
    { type: 'separator' },
    { label: cb.labels.quit, click: () => cb.quitApp() },
  ]);
}

/** Create or refresh the system tray / macOS menu bar icon. Returns false if unsupported. */
export function ensureAppTray(cb: AppTrayCallbacks): boolean {
  try {
    if (tray && !tray.isDestroyed()) {
      tray.setToolTip(cb.labels.tooltip);
      tray.setContextMenu(buildTrayMenu(cb));
      return true;
    }
    const icon = resolveTrayIcon();
    if (icon.isEmpty()) {
      console.error('[okbot] tray icon empty; refusing to create tray');
      return false;
    }
    tray = new Tray(icon);
    tray.setToolTip(cb.labels.tooltip);
    tray.setContextMenu(buildTrayMenu(cb));
    tray.on('double-click', () => cb.showWindow());
    // Windows: single-click opens (common for assistants).
    if (process.platform === 'win32') {
      tray.on('click', () => cb.showWindow());
    }
    return true;
  } catch (err) {
    console.error('[okbot] tray create failed', err);
    try {
      tray?.destroy();
    } catch {
      /* ignore */
    }
    tray = null;
    return false;
  }
}

export function destroyAppTray(): void {
  if (tray && !tray.isDestroyed()) {
    try {
      tray.destroy();
    } catch (err) {
      console.error('[okbot] tray destroy failed', err);
    }
  }
  tray = null;
}

export function hideWindowToTray(win: BrowserWindow, cb: AppTrayCallbacks): boolean {
  if (!ensureAppTray(cb)) return false;
  if (!win.isDestroyed()) win.hide();
  if (process.platform === 'darwin') {
    try {
      app.dock?.hide();
    } catch {
      /* ignore */
    }
  }
  return true;
}

export function focusOrShowWindows(createIfEmpty: () => void): void {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  if (wins.length === 0) {
    createIfEmpty();
    return;
  }
  // Focus a single window. Looping show+focus across all windows on tray /
  // second-instance caused brief mouse lag when OkBot regained foreground.
  const w = BrowserWindow.getFocusedWindow() ?? wins[0]!;
  if (w.isMinimized()) w.restore();
  if (!w.isVisible()) w.show();
  if (!w.isFocused()) w.focus();
  if (process.platform === 'darwin') {
    try {
      app.dock?.show();
    } catch {
      /* ignore */
    }
  }
}
