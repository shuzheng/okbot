/**
 * Desktop-only IPC: MCP status / test and full data backup / restore.
 * Neither is on the gateway RPC allowlist: MCP starts host processes, and
 * backup / restore read and replace the whole data directory.
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { IpcChannels, normalizeMcpServerEntry } from '@okbot/shared';
import type { IpcContext } from './context';
import { mcpStatus, mcpTest } from '../mcpRuntime';
import { exportDataBackup, restoreDataBackup } from '../backup';
import { setAllowQuit } from '../quitState';

function backupFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `okbot-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
}

/** A run or a waiting approval writes session / pending files: no backup or restore then. */
function dataBusy(ctx: IpcContext): boolean {
  return ctx.abortControllers.size > 0 || ctx.pendingToolApprovals.size > 0;
}

export function registerExtensionsIpc(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.mcpStatus, () => mcpStatus(ctx.storage.getSettings()));

  ipcMain.handle(IpcChannels.mcpTestServer, async (_e, raw: unknown) => {
    const entry = normalizeMcpServerEntry(raw);
    if (!entry) return { id: '', name: '', ok: false, toolCount: 0, error: 'incomplete' };
    return mcpTest(entry);
  });

  ipcMain.handle(
    IpcChannels.backupExport,
    async (e, payload: { excludeSecrets?: boolean }): Promise<{ canceled: true } | { ok: true; path: string } | { ok: false; error: string }> => {
      if (dataBusy(ctx)) return { ok: false, error: 'busy' };
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const opts: Electron.SaveDialogOptions = {
        defaultPath: path.join(app.getPath('downloads') || os.homedir(), backupFileName()),
        filters: [{ name: 'Zip', extensions: ['zip'] }],
      };
      const picked = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (picked.canceled || !picked.filePath) return { canceled: true };
      // A run may have started (for example from the gateway) while the dialog was open.
      if (dataBusy(ctx)) return { ok: false, error: 'busy' };
      try {
        const out = exportDataBackup(ctx.storage.root, picked.filePath, {
          excludeSecrets: payload?.excludeSecrets !== false,
        });
        return { ok: true, path: out };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  /** Renderer asks for confirmation first. On success the app restarts. */
  ipcMain.handle(
    IpcChannels.backupRestore,
    async (e): Promise<{ canceled: true } | { ok: true; previousDir: string } | { ok: false; error: string }> => {
      if (dataBusy(ctx)) return { ok: false, error: 'busy' };
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const opts: Electron.OpenDialogOptions = {
        properties: ['openFile'],
        filters: [{ name: 'Zip', extensions: ['zip'] }],
      };
      const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (picked.canceled || !picked.filePaths?.[0]) return { canceled: true };
      if (dataBusy(ctx)) return { ok: false, error: 'busy' };
      try {
        const { previousDir } = restoreDataBackup(ctx.storage.root, picked.filePaths[0]);
        // Reload every store from the restored directory.
        setTimeout(() => {
          setAllowQuit(true);
          app.relaunch();
          app.quit();
        }, 600);
        return { ok: true, previousDir };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}
