/**
 * Renderer navigation + IPC sender trust for the desktop shell.
 * Blocks main-frame navigations away from the app origin (e.g. dragged HTML)
 * and rejects IPC from non-app frames (preload / window.okbot must not leak).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserWindow, IpcMainInvokeEvent, IpcMainEvent } from 'electron';

function rendererDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer');
}

/** True when `url` is our packaged renderer or the vite ELECTRON_RENDERER_URL origin. */
export function isAllowedRendererUrl(url: string): boolean {
  const raw = (url || '').trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    const devUrl = process.env.ELECTRON_RENDERER_URL?.trim();
    if (devUrl) {
      try {
        const d = new URL(devUrl);
        if (u.origin === d.origin) return true;
      } catch {
        /* ignore */
      }
    }
    if (u.protocol === 'file:') {
      let filePath = decodeURIComponent(u.pathname || '');
      if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
        filePath = filePath.slice(1);
      }
      const resolved = path.resolve(filePath);
      const root = rendererDir();
      if (resolved === root || resolved.startsWith(root + path.sep)) return true;
      // loadFile may navigate to index.html under renderer/
      if (path.basename(resolved) === 'index.html') {
        const parent = path.dirname(resolved);
        if (parent === root || parent.startsWith(root + path.sep)) return true;
      }
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

export function installWebContentsNavigationGuard(win: BrowserWindow): void {
  const wc = win.webContents;
  const block = (event: { preventDefault: () => void }, url: string) => {
    if (isAllowedRendererUrl(url)) return;
    console.warn('[okbot] blocked renderer navigation', url);
    event.preventDefault();
  };
  wc.on('will-navigate', (event, url) => block(event, url));
  // Some Electron versions emit will-redirect for meta-refresh / server redirects.
  wc.on('will-redirect', (event, url) => block(event, url));
}

export function isTrustedIpcSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  try {
    const frameUrl =
      typeof (event as IpcMainInvokeEvent).senderFrame?.url === 'string'
        ? (event as IpcMainInvokeEvent).senderFrame!.url
        : '';
    const senderUrl = (() => {
      try {
        return event.sender.getURL();
      } catch {
        return '';
      }
    })();
    const url = frameUrl || senderUrl;
    return isAllowedRendererUrl(url);
  } catch {
    return false;
  }
}

/**
 * Wrap ipcMain.handle / ipcMain.on so only the app renderer may invoke.
 * Call once before registering any IPC handlers.
 */
export function installTrustedIpcGuard(ipcMain: import('electron').IpcMain): void {
  const origHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = ((channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any) => {
    return origHandle(channel, (event, ...args) => {
      if (!isTrustedIpcSender(event)) {
        console.warn('[okbot] rejected IPC from untrusted sender', channel);
        throw new Error('untrusted_ipc_sender');
      }
      return listener(event, ...args);
    });
  }) as typeof ipcMain.handle;

  const origOn = ipcMain.on.bind(ipcMain);
  ipcMain.on = ((channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void) => {
    return origOn(channel, (event, ...args) => {
      if (!isTrustedIpcSender(event)) {
        console.warn('[okbot] rejected IPC on from untrusted sender', channel);
        try {
          (event as IpcMainEvent & { returnValue?: unknown }).returnValue = null;
        } catch {
          /* ignore */
        }
        return;
      }
      return listener(event, ...args);
    });
  }) as typeof ipcMain.on;
}
