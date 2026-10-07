import { BrowserWindow, clipboard, dialog, ipcMain, shell, systemPreferences, app } from 'electron';
import { claimNotify } from '../notifyClaim';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { IpcChannels } from '@okbot/shared';
import type { IpcContext } from './context';
import {
  checkForUpdates,
  downloadUpdate,
  getUpdaterStatus,
  installUpdate,
} from '../updater';

let windowControlsRegistered = false;

/** Min/max/close for frameless windows, including the attach client (no full IPC backend). */
export function registerWindowControlIpc(): void {
  if (windowControlsRegistered) return;
  windowControlsRegistered = true;

  const windowFromEvent = (e: Electron.IpcMainInvokeEvent) =>
    BrowserWindow.fromWebContents(e.sender);

  ipcMain.handle(IpcChannels.windowMinimize, (e) => {
    windowFromEvent(e)?.minimize();
    return true;
  });

  ipcMain.handle(IpcChannels.windowMaximizeToggle, (e) => {
    const win = windowFromEvent(e);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  ipcMain.handle(IpcChannels.windowClose, (e) => {
    windowFromEvent(e)?.close();
    return true;
  });

  ipcMain.handle(IpcChannels.claimNotification, (_e, payload: { tag?: unknown }) =>
    claimNotify('local', String(payload?.tag ?? '')),
  );

  ipcMain.handle(IpcChannels.windowFocus, (e) => {
    const win = windowFromEvent(e);
    if (!win || win.isDestroyed()) return false;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    // Avoid app.focus({ steal: true }) on every call — on macOS it can briefly
    // stall the cursor when OkBot regains focus from another app.
    if (!win.isFocused()) win.focus();
    return true;
  });

  ipcMain.handle(IpcChannels.windowIsMaximized, (e) => {
    return windowFromEvent(e)?.isMaximized() ?? false;
  });

  const pushMaximized = (win: BrowserWindow) => {
    if (win.isDestroyed()) return;
    win.webContents.send(IpcChannels.windowMaximizedChanged, win.isMaximized());
  };
  const attachMaximizedPush = (win: BrowserWindow) => {
    win.on('maximize', () => pushMaximized(win));
    win.on('unmaximize', () => pushMaximized(win));
  };
  for (const win of BrowserWindow.getAllWindows()) attachMaximizedPush(win);
  app.on('browser-window-created', (_e, win) => attachMaximizedPush(win));
}

export function registerSystemIpc(_ctx: IpcContext): void {
  ipcMain.handle(
    IpcChannels.setTrafficLightPosition,
    (_e, pos: { x: number; y: number }) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (!win || process.platform !== 'darwin') return false;
      win.setWindowButtonPosition({ x: Math.round(pos.x), y: Math.round(pos.y) });
      return true;
    },
  );

  registerWindowControlIpc();

  const electronAppPath = (() => {
    // .../Electron.app/Contents/MacOS/Electron → .../Electron.app
    return path.resolve(process.execPath, '..', '..', '..');
  })();

  ipcMain.handle(IpcChannels.ensureMicrophoneAccess, async () => {
    if (process.platform !== 'darwin') {
      return {
        status: 'granted' as const,
        prompted: false,
        askResult: true as boolean | null,
        electronAppPath,
      };
    }
    const before = systemPreferences.getMediaAccessStatus('microphone');
    if (before === 'granted') {
      return { status: 'granted' as const, prompted: false, askResult: null, electronAppPath };
    }
    // Shows the macOS system dialog when status is not-determined.
    // Dev note: launching via iTerm may attribute the prompt to iTerm2 — Electron
    // still needs its own toggle under System Settings → Microphone.
    let askResult: boolean | null = null;
    try {
      askResult = await systemPreferences.askForMediaAccess('microphone');
    } catch {
      askResult = false;
    }
    const after = systemPreferences.getMediaAccessStatus('microphone');
    return {
      status: after,
      prompted: true,
      askResult,
      electronAppPath,
    };
  });

  ipcMain.handle(IpcChannels.openMicrophoneSettings, async () => {
    const urls = [
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      'x-apple.systempreferences:com.apple.Settings.PrivacySecurity.extension?Privacy_Microphone',
    ];
    for (const url of urls) {
      try {
        await shell.openExternal(url);
        break;
      } catch {
        /* try next */
      }
    }
    // Reveal Electron.app so the user can add it via the Privacy list "+" button.
    try {
      await shell.openPath(electronAppPath);
    } catch {
      /* ignore */
    }
    return true;
  });

  ipcMain.handle(IpcChannels.copyText, (_e, text: string) => {
    clipboard.writeText(typeof text === 'string' ? text : String(text ?? ''));
    return true;
  });


  ipcMain.handle(
    IpcChannels.pickPaths,
    async (
      e,
      payload: { kind: 'image' | 'file' | 'folder' },
    ): Promise<{ canceled: boolean; paths: string[] }> => {
      const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow();
      const kind = payload?.kind;
      if (kind !== 'image' && kind !== 'file' && kind !== 'folder') {
        return { canceled: true, paths: [] };
      }
      const opts: Electron.OpenDialogOptions =
        kind === 'folder'
          ? {
              properties: ['openDirectory', 'createDirectory'],
            }
          : kind === 'image'
            ? {
                properties: ['openFile', 'multiSelections'],
                filters: [
                  {
                    name: 'Images',
                    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'],
                  },
                ],
              }
            : {
                properties: ['openFile', 'multiSelections'],
              };
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || !result.filePaths?.length) {
        return { canceled: true, paths: [] };
      }
      return { canceled: false, paths: result.filePaths };
    },
  );

  /** Resolve okbot-asset:… markdown images under ~/.okbot/<owner>/resources (CSP-safe data URLs). */
  ipcMain.handle(
    IpcChannels.readGeneratedAssetDataUrl,
    async (
      _e,
      payload: { assetRel?: string },
    ): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> => {
      const relRaw = typeof payload?.assetRel === 'string' ? payload.assetRel.trim() : '';
      const rel = relRaw.replace(/^okbot-asset:/i, '').replace(/^\/+/, '').replace(/\\/g, '/');
      if (!rel || rel.includes('..') || path.isAbsolute(rel)) {
        return { ok: false, error: 'invalid asset path' };
      }
      // Expect `<ownerId>/resources/<fileName>` (generated media only).
      const parts = rel.split('/');
      if (
        parts.length !== 3 ||
        parts[1] !== 'resources' ||
        !parts[0] ||
        !parts[2] ||
        parts[0].includes('\\') ||
        parts[2].includes('\\')
      ) {
        return { ok: false, error: 'asset must be <ownerId>/resources/<file>' };
      }
      const okbotRoot = path.resolve(os.homedir(), '.okbot');
      const filePath = path.resolve(okbotRoot, rel);
      if (filePath !== okbotRoot && !filePath.startsWith(okbotRoot + path.sep)) {
        return { ok: false, error: 'path outside okbot root' };
      }
      // Must stay inside that owner's resources/ dir.
      const resourcesDir = path.resolve(okbotRoot, parts[0], 'resources');
      if (filePath !== resourcesDir && !filePath.startsWith(resourcesDir + path.sep)) {
        return { ok: false, error: 'path outside owner resources' };
      }
      try {
        const buf = await fs.readFile(filePath);
        if (buf.byteLength > 25 * 1024 * 1024) {
          return { ok: false, error: 'asset too large' };
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime =
          ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.gif'
                ? 'image/gif'
                : 'image/png';
        return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );

  ipcMain.handle(IpcChannels.getAppInfo, () => {
    const buildDate =
      (typeof __OKBOT_BUILD_DATE__ !== 'undefined' && __OKBOT_BUILD_DATE__) ||
      new Date().toISOString().slice(0, 10);
    return {
      name: 'OkBot',
      version: app.getVersion(),
      buildDate,
      copyright: `© ${new Date().getFullYear()} OkBot`,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      isPackaged: app.isPackaged,
    };
  });

  ipcMain.handle(IpcChannels.updaterGetStatus, () => getUpdaterStatus());
  ipcMain.handle(IpcChannels.updaterCheck, () => checkForUpdates(true));
  ipcMain.handle(IpcChannels.updaterDownload, () => downloadUpdate());
  ipcMain.handle(IpcChannels.updaterInstall, () => installUpdate());
}
