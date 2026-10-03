import { BrowserWindow, app, dialog } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateInfo, ProgressInfo } from 'electron-updater';
import { setAllowQuit } from './quitState';
import { IpcChannels, type AppSettings, type UpdaterStatus } from '@okbot/shared';

const { autoUpdater } = electronUpdater;

type SettingsReader = () => AppSettings;

let status: UpdaterStatus = {
  phase: 'idle',
  currentVersion: app.getVersion(),
};

let initialized = false;
let getSettings: SettingsReader = () => ({ autoUpdate: true } as AppSettings);

/** Lowest percent we will show during the current download session (monotonic UI). */
let downloadProgressFloor = 0;

/** In-flight download promise for single-flight; cleared when download settles. */
let downloadInFlight: Promise<UpdaterStatus> | null = null;

function isDownloadActive(): boolean {
  return (
    downloadInFlight != null ||
    status.phase === 'downloading' ||
    status.phase === 'downloaded'
  );
}

function broadcast() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.updaterEvent, status);
    }
  }
}

function setStatus(patch: Partial<UpdaterStatus>) {
  status = {
    ...status,
    currentVersion: app.getVersion(),
    ...patch,
  };
  broadcast();
}

export function getUpdaterStatus(): UpdaterStatus {
  return { ...status, currentVersion: app.getVersion() };
}

export function initAutoUpdater(readSettings: SettingsReader) {
  if (initialized) return;
  initialized = true;
  getSettings = readSettings;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Dev / unpackaged: skip network checks unless explicitly forced.
  autoUpdater.forceDevUpdateConfig = false;
  // Windows NSIS: skip blockmap/differential → full package only (avoids ~90%→1% jumps on slow nets).
  autoUpdater.disableDifferentialDownload = true;

  autoUpdater.on('checking-for-update', () => {
    // Background re-checks must not hide an active download.
    if (isDownloadActive()) return;
    setStatus({ phase: 'checking', error: undefined });
  });
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    // Keep downloading/downloaded UI; still refresh availableVersion if useful.
    if (status.phase === 'downloading' || status.phase === 'downloaded') {
      setStatus({
        availableVersion: info.version,
        error: undefined,
      });
      return;
    }
    setStatus({
      phase: 'available',
      availableVersion: info.version,
      error: undefined,
    });
    // Auto-update ON → download in background (header shows downloading → install).
    if (getSettings().autoUpdate !== false) {
      void downloadUpdate();
    }
  });
  autoUpdater.on('update-not-available', () => {
    if (isDownloadActive()) return;
    setStatus({
      phase: 'not-available',
      availableVersion: undefined,
      error: undefined,
    });
  });
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    const next = Math.max(downloadProgressFloor, Math.round(p.percent));
    downloadProgressFloor = next;
    setStatus({
      phase: 'downloading',
      progress: next,
      error: undefined,
    });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    downloadProgressFloor = 100;
    setStatus({
      phase: 'downloaded',
      availableVersion: info.version,
      progress: 100,
      error: undefined,
    });
  });
  autoUpdater.on('error', (err: Error) => {
    // Errors during download must still surface.
    setStatus({
      phase: 'error',
      error: err?.message || String(err),
    });
  });

  // Background check shortly after launch (always when packaged).
  // autoUpdate preference controls auto-download, not discovery.
  setTimeout(() => {
    if (app.isPackaged) {
      void checkForUpdates(false);
    }
  }, 8_000);
}

export async function checkForUpdates(manual: boolean): Promise<UpdaterStatus> {
  if (!app.isPackaged) {
    if (isDownloadActive()) return getUpdaterStatus();
    setStatus({
      phase: 'not-available',
      error: manual ? '开发模式下不检查更新' : undefined,
    });
    return getUpdaterStatus();
  }
  // Don't clobber an in-progress or finished download with a check.
  if (isDownloadActive()) {
    return getUpdaterStatus();
  }
  try {
    setStatus({ phase: 'checking', error: undefined });
    await autoUpdater.checkForUpdates();
  } catch (err) {
    if (isDownloadActive()) return getUpdaterStatus();
    setStatus({
      phase: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return getUpdaterStatus();
}

export async function downloadUpdate(): Promise<UpdaterStatus> {
  if (!app.isPackaged) {
    setStatus({ phase: 'error', error: '开发模式下无法下载更新' });
    return getUpdaterStatus();
  }
  // Single-flight: already downloading (or promise in flight) → return current status.
  if (downloadInFlight) {
    return downloadInFlight;
  }
  if (status.phase === 'downloading') {
    return getUpdaterStatus();
  }
  if (status.phase === 'downloaded') {
    return getUpdaterStatus();
  }

  downloadProgressFloor = 0;
  setStatus({ phase: 'downloading', progress: 0, error: undefined });

  downloadInFlight = (async () => {
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      setStatus({
        phase: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      downloadInFlight = null;
    }
    return getUpdaterStatus();
  })();

  return downloadInFlight;
}

export async function installUpdate(): Promise<void> {
  if (status.phase !== 'downloaded') return;
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const boxOpts = {
    type: 'info' as const,
    buttons: ['立即重启', '稍后'],
    defaultId: 0,
    cancelId: 1,
    message: '更新已下载完成',
    detail: `新版本 ${status.availableVersion ?? ''} 已就绪。重启 OkBot 以完成安装。`,
  };
  const result = win
    ? await dialog.showMessageBox(win, boxOpts)
    : await dialog.showMessageBox(boxOpts);
  if (result.response === 0) {
    setAllowQuit(true);
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  }
}

/** Call when settings.autoUpdate flips on — schedule a check / resume download. */
export function onAutoUpdatePreferenceChanged(enabled: boolean) {
  if (!enabled || !app.isPackaged) return;
  if (status.phase === 'available') {
    void downloadUpdate();
    return;
  }
  void checkForUpdates(false);
}
