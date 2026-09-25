import { BrowserWindow, clipboard, ipcMain, shell, systemPreferences, app } from 'electron';
import path from 'node:path';
import { IpcChannels } from '@okbot/shared';
import type { IpcContext } from './context';
import {
  checkForUpdates,
  downloadUpdate,
  getUpdaterStatus,
  installUpdate,
} from '../updater';

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
