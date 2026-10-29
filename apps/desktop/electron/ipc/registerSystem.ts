import { BrowserWindow, clipboard, dialog, ipcMain, shell, systemPreferences, app } from 'electron';
import { claimNotify } from '@okbot/gateway';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { IpcChannels } from '@okbot/shared';
import type { IpcContext } from '@okbot/gateway';
import { invokeApplyWindowTranslucent } from '../windowChromeBridge';
import {
  checkForUpdates,
  dismissSoftUpdatePrompt,
  downloadUpdate,
  getChangelogHistory,
  getUpdaterStatus,
  getWhatsNewIfNeeded,
  installUpdate,
  markWhatsNewSeen,
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

  /** Numeric dock / taskbar badge (macOS & Linux via app.setBadgeCount; Windows may no-op). */
  ipcMain.handle(IpcChannels.setBadgeCount, (_e, raw: unknown) => {
    const n = typeof raw === 'number' ? raw : Number(raw);
    const count = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 99) : 0;
    try {
      return app.setBadgeCount(count);
    } catch (err) {
      console.error('[okbot] setBadgeCount failed', err);
      return false;
    }
  });

  ipcMain.handle(IpcChannels.windowIsMaximized, (e) => {
    return windowFromEvent(e)?.isMaximized() ?? false;
  });

  // Owner + attach: translucent/vibrancy must work without full entity IPC.
  ipcMain.handle(IpcChannels.applyWindowTranslucent, (_e, translucent: unknown) => {
    invokeApplyWindowTranslucent(translucent !== false);
    return true;
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

export function registerSystemIpc(ctx: IpcContext): void {
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


  ipcMain.handle(
    IpcChannels.uploadOwnerAttachment,
    async (
      _e,
      payload: {
        ownerId?: string;
        name?: string;
        localPath?: string;
        dataBase64?: string;
        mime?: string;
      },
    ): Promise<
      | {
          ok: true;
          attachment: {
            kind: 'image' | 'file';
            path: string;
            name: string;
            size: number;
            mediaPath: string;
            assetRel: string;
          };
        }
      | { ok: false; error: string }
    > => {
      const ownerId = typeof payload?.ownerId === 'string' ? payload.ownerId.trim() : '';
      if (!ownerId) return { ok: false, error: 'missing_owner' };
      const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
      const mime = typeof payload?.mime === 'string' ? payload.mime.trim() : '';
      const localPath = typeof payload?.localPath === 'string' ? payload.localPath.trim() : '';
      const dataBase64 = typeof payload?.dataBase64 === 'string' ? payload.dataBase64.trim() : '';
      try {
        let buffer: Buffer;
        let displayName = name;
        if (localPath) {
          const resolved = path.resolve(localPath);
          const st = await fs.stat(resolved);
          if (!st.isFile()) return { ok: false, error: 'not_a_file' };
          if (st.size <= 0) return { ok: false, error: 'empty_upload' };
          if (st.size > 25 * 1024 * 1024) return { ok: false, error: 'upload_too_large' };
          buffer = await fs.readFile(resolved);
          if (!displayName) displayName = path.basename(resolved);
        } else if (dataBase64) {
          buffer = Buffer.from(dataBase64, 'base64');
          if (!buffer.length) return { ok: false, error: 'empty_upload' };
          if (!displayName) displayName = 'file';
        } else {
          return { ok: false, error: 'missing_data' };
        }
        const saved = ctx.storage.saveOwnerUpload(ownerId, {
          name: displayName || 'file',
          buffer,
          mime: mime || null,
        });
        return {
          ok: true,
          attachment: {
            kind: saved.kind,
            path: saved.path,
            name: saved.name,
            size: saved.size,
            mediaPath: saved.mediaPath,
            assetRel: saved.assetRel,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );

  /** Resolve ~/.okbot/<owner>/resources images as data URLs when gateway /v1/media is unavailable. */
  ipcMain.handle(
    IpcChannels.readGeneratedAssetDataUrl,
    async (
      _e,
      payload: { assetRel?: string },
    ): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> => {
      const relRaw = typeof payload?.assetRel === 'string' ? payload.assetRel.trim() : '';
      const rel = relRaw
        .replace(/^okbot-asset:/i, '')
        .replace(/^\/v1\/media\//i, '')
        .replace(/^\/+/, '')
        .replace(/\\/g, '/');
      if (!rel || rel.includes('..') || path.isAbsolute(rel)) {
        return { ok: false, error: 'invalid asset path' };
      }
      // Expect `<ownerId>/{resources|uploads}/<fileName>`.
      const parts = rel.split('/');
      const subdir = parts[1];
      if (
        parts.length !== 3 ||
        (subdir !== 'resources' && subdir !== 'uploads') ||
        !parts[0] ||
        !parts[2] ||
        parts[0].includes('\\') ||
        parts[2].includes('\\')
      ) {
        return { ok: false, error: 'asset must be <ownerId>/{resources|uploads}/<file>' };
      }
      // Current layout: ~/.okbot/data/<owner>/{resources|uploads}/; legacy flat under ~/.okbot/.
      const okbotRoot = path.resolve(os.homedir(), '.okbot');
      const dataRoot = path.resolve(okbotRoot, 'data');
      const candidates = [
        path.resolve(dataRoot, rel),
        path.resolve(okbotRoot, rel),
      ];
      let filePath: string | null = null;
      let mediaDir: string | null = null;
      for (const candidate of candidates) {
        const root = candidate.startsWith(dataRoot + path.sep) || candidate === dataRoot ? dataRoot : okbotRoot;
        if (candidate !== root && !candidate.startsWith(root + path.sep)) continue;
        const dir = path.resolve(root, parts[0]!, subdir!);
        if (candidate !== dir && !candidate.startsWith(dir + path.sep)) continue;
        try {
          await fs.access(candidate);
          filePath = candidate;
          mediaDir = dir;
          break;
        } catch {
          /* try next */
        }
      }
      if (!filePath || !mediaDir) {
        return { ok: false, error: 'asset not found' };
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

  registerUpdaterIpc();
}

/** Desktop auto-update IPC — owner and attach windows both need these handlers. */
let updaterIpcRegistered = false;
export function registerUpdaterIpc(): void {
  if (updaterIpcRegistered) return;
  updaterIpcRegistered = true;
  ipcMain.handle(IpcChannels.updaterGetStatus, () => getUpdaterStatus());
  ipcMain.handle(IpcChannels.updaterCheck, () => checkForUpdates(true));
  ipcMain.handle(IpcChannels.updaterDownload, () => downloadUpdate());
  ipcMain.handle(IpcChannels.updaterInstall, () => installUpdate());
  ipcMain.handle(IpcChannels.updaterGetChangelogHistory, (_e, lang?: unknown) => {
    const l = lang === 'zh' || lang === 'en' ? lang : undefined;
    return getChangelogHistory(l);
  });
  ipcMain.handle(IpcChannels.updaterGetWhatsNew, (_e, lang?: unknown) => {
    const l = lang === 'zh' || lang === 'en' ? lang : undefined;
    return getWhatsNewIfNeeded(l);
  });
  ipcMain.handle(IpcChannels.updaterMarkWhatsNewSeen, (_e, version?: unknown) => {
    markWhatsNewSeen(typeof version === 'string' ? version : undefined);
    return true;
  });
  ipcMain.handle(IpcChannels.updaterDismissUpdatePrompt, (_e, version?: unknown) => {
    return dismissSoftUpdatePrompt(typeof version === 'string' ? version : undefined);
  });
}
