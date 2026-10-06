import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, autoUpdater as nativeAutoUpdater, dialog } from 'electron';
import electronUpdater from 'electron-updater';
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';
import {
  MAC_UPDATE_INSTALL_SCRIPT,
  isCachedUpdateZip,
  macBundleFromExe,
  macInstallTargetReady,
  macUpdaterCacheRoot,
  MAC_INSTALL_SPACE_FACTOR,
  pickDownloadedSha512,
  updateSha512ToHex,
} from './macUpdateInstall';
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

/** Zip electron-updater sha512-checked. Mac install uses this; Squirrel cannot. */
let downloadedZip: string | null = null;
/** Hex sha512 from the update manifest, re-checked by the install helper. */
let downloadedSha512Hex: string | null = null;

/** Detached mac install helper already spawned for this download. */
let macInstallStarted = false;

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

const INSTALL_FAILED_FILE = 'update-install-failed.json';

/** will-quit cannot show UI: keep the reason for the next launch, and log it. */
function rememberQuitInstallFailure(reason: string): void {
  try {
    fs.writeFileSync(
      path.join(app.getPath('userData'), INSTALL_FAILED_FILE),
      JSON.stringify({ reason, at: new Date().toISOString() }),
    );
  } catch (err) {
    console.error('[okbot] could not save update install failure', err);
  }
  try {
    fs.appendFileSync(
      path.join(app.getPath('logs'), 'update-install.log'),
      `${new Date().toISOString()} install on quit did not start: ${reason}\n`,
    );
  } catch {
    /* logs dir missing */
  }
}

function takeQuitInstallFailure(): string | undefined {
  const file = path.join(app.getPath('userData'), INSTALL_FAILED_FILE);
  try {
    if (!fs.existsSync(file)) return undefined;
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { reason?: unknown };
    fs.rmSync(file, { force: true });
    return typeof data.reason === 'string' && data.reason ? data.reason : 'unknown';
  } catch {
    // Corrupt / unreadable: drop it so the next launch does not keep failing.
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
    return undefined;
  }
}

export function initAutoUpdater(readSettings: SettingsReader) {
  if (initialized) return;
  initialized = true;
  getSettings = readSettings;
  const lastInstallFailed = takeQuitInstallFailure();
  if (lastInstallFailed) setStatus({ lastInstallFailed });

  autoUpdater.autoDownload = false;
  // MacUpdater only hooks quit-install through Squirrel, which rejects this
  // unsigned build. Windows/Linux BaseUpdater really does install on quit.
  autoUpdater.autoInstallOnAppQuit = process.platform !== 'darwin';
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
  autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
    downloadProgressFloor = 100;
    downloadedZip = info.downloadedFile || null;
    // Match the manifest entry of the file MacUpdater picked (arm64 vs x64), not files[0].
    downloadedSha512Hex =
      pickDownloadedSha512(Array.isArray(info.files) ? info.files : [], downloadedZip) ??
      (Array.isArray(info.files) && info.files.length <= 1 && typeof info.sha512 === 'string'
        ? updateSha512ToHex(info.sha512)
        : null);
    macInstallStarted = false;
    setStatus({
      phase: 'downloaded',
      availableVersion: info.version,
      progress: 100,
      error: undefined,
    });
  });
  autoUpdater.on('error', (err: Error) => {
    // Mac Squirrel emits this when the unsigned bundle fails its code
    // requirement. The zip is already verified; do not hide the install UI.
    if (status.phase === 'downloaded' && downloadedZip) return;
    setStatus({
      phase: 'error',
      error: err?.message || String(err),
    });
  });

  // Normal quit does not call quitAndInstall. On macOS Squirrel never
  // prepared an update (signature check failed), so install the zip ourselves
  // once quit is committed. Relaunch only when the user asked to restart.
  app.on('will-quit', () => {
    if (process.platform !== 'darwin') return;
    if (status.phase !== 'downloaded' || !downloadedZip) return;
    const started = startMacUpdateInstall(false);
    if (!started.ok) {
      console.error('[okbot] mac update install could not start on quit:', started.reason);
      rememberQuitInstallFailure(started.reason);
    }
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
  const boxOpts = {
    type: 'info' as const,
    buttons: ['立即重启', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: '更新已下载完成',
    detail: `新版本 ${status.availableVersion ?? ''} 已就绪。重启 OkBot 以完成安装。`,
  };
  // Not attached to a window: a macOS sheet keeps that window from closing,
  // and quitAndInstall never reaches the installer while any window is open.
  const result = await dialog.showMessageBox(boxOpts);
  if (result.response === 0) {
    restartToInstall();
  }
}

function restartToInstall(): void {
  setAllowQuit(true);
  if (process.platform === 'darwin') {
    // MacUpdater.quitAndInstall() does not quit unless native Squirrel has
    // already accepted the bundle. Unsigned builds never get there, so the
    // button returns and the app stays open. Swap the verified zip instead.
    const started = startMacUpdateInstall(true);
    if (!started.ok) {
      const detail =
        started.reason === 'not_writable'
          ? '当前应用所在目录不可写（例如还在 DMG 里运行，或没有 /Applications 的写入权限）。请先把 OkBot 复制到「应用程序」后再更新。'
          : started.reason === 'no_space'
            ? '磁盘空间不足，无法展开安装包。请腾出空间后重试。'
            : started.reason === 'no_sha'
              ? '安装包校验信息不完整。请重新检查更新并下载。'
              : '已下载的安装包不在更新缓存里。请退出 OkBot，从 Release 手动安装。';
      void dialog.showMessageBox({
        type: 'error',
        buttons: ['好'],
        message: '无法安装更新',
        detail,
      });
      return;
    }
    quitForUpdate();
    return;
  }
  // Let the dialog finish tearing down its modal session before we quit.
  setTimeout(() => {
    nativeAutoUpdater.once('before-quit-for-update', () => {
      releaseAndDestroyWindows();
    });
    autoUpdater.quitAndInstall(false, true);
  }, 0);
}

function releaseAndDestroyWindows(): void {
  // The relaunched process must be able to take the single-instance lock.
  app.releaseSingleInstanceLock();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.removeAllListeners('close');
    win.destroy();
  }
}

function quitForUpdate(): void {
  releaseAndDestroyWindows();
  app.quit();
  // before-quit can still cancel app.quit(). The helper waits on this pid,
  // so exit if quit does not finish.
  setTimeout(() => app.exit(0), 2000);
}

/**
 * Spawn a detached helper that waits for this process to exit, then replaces
 * the .app with the zip electron-updater already verified. Returns false when
 * there is nothing safe to install.
 */
type MacInstallStart =
  | { ok: true }
  | { ok: false; reason: 'platform' | 'no_zip' | 'no_bundle' | 'not_writable' | 'no_space' | 'no_sha' };

function startMacUpdateInstall(relaunch: boolean): MacInstallStart {
  if (process.platform !== 'darwin' || !app.isPackaged) return { ok: false, reason: 'platform' };
  if (macInstallStarted) return { ok: true };
  const zip = downloadedZip;
  if (!zip || !isCachedUpdateZip(zip, macUpdaterCacheRoot())) return { ok: false, reason: 'no_zip' };
  const bundle = macBundleFromExe(app.getPath('exe'));
  if (!bundle) return { ok: false, reason: 'no_bundle' };
  const sha = downloadedSha512Hex;
  if (!sha) return { ok: false, reason: 'no_sha' };
  // Writability and free-space check happen before quit.
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
  } catch {
    return { ok: false, reason: 'not_writable' };
  }
  if (!macInstallTargetReady(bundle, zip)) {
    // Distinguish space vs other readiness failures when possible.
    try {
      if (typeof fs.statfsSync === 'function') {
        const st = fs.statfsSync(path.dirname(bundle));
        const free = Number(st.bavail) * Number(st.bsize);
        const zipBytes = fs.statSync(zip).size;
        if (Number.isFinite(free) && zipBytes > 0 && free < zipBytes * MAC_INSTALL_SPACE_FACTOR) {
          return { ok: false, reason: 'no_space' };
        }
      }
    } catch {
      /* fall through */
    }
    return { ok: false, reason: 'not_writable' };
  }
  const scriptPath = path.join(app.getPath('temp'), 'okbot-update-install.sh');
  fs.writeFileSync(scriptPath, MAC_UPDATE_INSTALL_SCRIPT, { mode: 0o700 });
  const logPath = path.join(app.getPath('logs'), 'update-install.log');
  const statusPath = path.join(app.getPath('userData'), INSTALL_FAILED_FILE);
  const child = spawn(
    '/bin/bash',
    [scriptPath, String(process.pid), zip, bundle, logPath, relaunch ? '1' : '0', sha, statusPath],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  macInstallStarted = true;
  return { ok: true };
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
