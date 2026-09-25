import { app, BrowserWindow, dialog, Menu, nativeTheme, screen, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IpcChannels, type AppSettings, type ChatEvent } from '@okbot/shared';
import { FileStorage } from './storage';
import { registerAllIpc, type PendingToolApproval } from './ipc';
import { initAutoUpdater, onAutoUpdatePreferenceChanged } from './updater';
import { getAllowQuit, setAllowQuit } from './quitState';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storage = new FileStorage();

// Must run before app.ready — reads persisted setting.
const hardwareAccelerationActive = storage.getSettings().hardwareAcceleration !== false;
if (!hardwareAccelerationActive) {
  app.disableHardwareAcceleration();
}

// Dev launches still use Electron.app identity for TCC; name helps in some UI.
app.setName('OkBot');

/** Only one OkBot process; a second launch focuses the existing window. */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

const abortControllers = new Map<string, AbortController>();
/** Pending HITL tool approvals: requestId -> resolve */
const pendingToolApprovals = new Map<string, PendingToolApproval>();

function snapshotActiveRuns() {
  const memoryPending = [...pendingToolApprovals.entries()].map(([requestId, p]) => ({
    requestId,
    botId: p.botId,
    messageId: p.messageId,
    toolName: p.toolName,
    arguments: p.arguments,
  }));
  const memoryIds = new Set(memoryPending.map((p) => p.requestId));
  const diskPending = storage
    .listAllPendingHitl()
    .filter((p) => !memoryIds.has(p.requestId))
    .map((p) => ({
      requestId: p.requestId,
      botId: p.botId,
      messageId: p.messageId,
      toolName: p.toolName,
      arguments: p.arguments,
    }));
  const busyBotIds = new Set<string>([
    ...abortControllers.keys(),
    ...memoryPending.map((p) => p.botId),
    ...diskPending.map((p) => p.botId),
  ]);
  return {
    busyBotIds: [...busyBotIds],
    pendingToolRequests: [...memoryPending, ...diskPending],
  };
}

function rejectPendingApprovalsForBot(botId: string, message = '已取消') {
  for (const [requestId, pending] of [...pendingToolApprovals.entries()]) {
    if (pending.botId !== botId) continue;
    pendingToolApprovals.delete(requestId);
    pending.resolve({ approved: false, message });
  }
  storage.clearPendingHitl(botId);
}

function applyTheme(theme: AppSettings['theme']) {
  if (theme === 'system') nativeTheme.themeSource = 'system';
  else nativeTheme.themeSource = theme;
}

function isBoundsOnScreen(bounds: { x: number; y: number; width: number; height: number }) {
  const area = bounds.width * bounds.height;
  if (area <= 0) return false;
  let visible = 0;
  for (const d of screen.getAllDisplays()) {
    const wx1 = Math.max(bounds.x, d.bounds.x);
    const wy1 = Math.max(bounds.y, d.bounds.y);
    const wx2 = Math.min(bounds.x + bounds.width, d.bounds.x + d.bounds.width);
    const wy2 = Math.min(bounds.y + bounds.height, d.bounds.y + d.bounds.height);
    if (wx2 > wx1 && wy2 > wy1) visible += (wx2 - wx1) * (wy2 - wy1);
  }
  return visible / area >= 0.3;
}

function createWindow() {
  const saved = storage.getWindowBounds();
  const opts: Electron.BrowserWindowConstructorOptions = {
    width: saved?.width ?? 1180,
    height: saved?.height ?? 760,
    minWidth: 500,
    minHeight: 500,
    title: 'OkBot',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#f6f6f7',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
  if (process.platform === 'darwin') {
    // macOS: inset traffic lights; do not invent custom window controls.
    opts.titleBarStyle = 'hiddenInset';
    opts.trafficLightPosition = { x: 14, y: 14 };
  } else if (process.platform === 'win32') {
    // Windows: frameless chrome; custom min/max/close live in the renderer header.
    opts.titleBarStyle = 'hidden';
    opts.autoHideMenuBar = true;
  } else {
    // Linux: keep prior menu-hide behavior; leave native frame/title bar unchanged.
    opts.titleBarStyle = 'hiddenInset';
    opts.autoHideMenuBar = true;
  }
  if (saved && isBoundsOnScreen(saved)) {
    opts.x = saved.x;
    opts.y = saved.y;
  }

  const win = new BrowserWindow(opts);

  const persistBounds = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    storage.saveWindowBounds(win.getBounds());
  };
  let persistTimer: NodeJS.Timeout | null = null;
  const schedulePersist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistBounds, 250);
  };
  win.on('resize', schedulePersist);
  win.on('move', schedulePersist);
  win.on('close', persistBounds);

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' || u.protocol === 'http:') {
        void shell.openExternal(url);
      }
    } catch {
      /* ignore invalid */
    }
    return { action: 'deny' };
  });
}

function sendChatEvent(event: ChatEvent) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.chatEvent, event);
  }
}

app.on('second-instance', () => {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  if (wins.length === 0) {
    if (app.isReady()) createWindow();
    return;
  }
  for (const w of wins) {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  }
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  applyTheme(storage.getSettings().theme);

  // Hide the native File/Edit/View bar on Windows/Linux.
  // Windows: never Menu.setApplicationMenu(null) — breaks IME. Keep autoHideMenuBar so the
  // bar stays invisible, but register a minimal Edit submenu (undo/copy/paste/…) so Chromium
  // IME / accelerator paths still work on some Electron builds.
  if (process.platform === 'win32') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
          ],
        },
      ]),
    );
  } else if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }

  // Notify renderer when OS theme flips so `system` mode can re-resolve data-theme
  // even if matchMedia is sticky (reported on Windows).
  nativeTheme.on('updated', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcChannels.nativeThemeUpdated);
    }
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media') {
      callback(true);
      return;
    }
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media';
  });

  registerAllIpc({
    storage,
    abortControllers,
    pendingToolApprovals,
    hardwareAccelerationActive,
    sendChatEvent,
    snapshotActiveRuns,
    rejectPendingApprovalsForBot,
    applyTheme,
    onAutoUpdatePreferenceChanged,
  });

  initAutoUpdater(() => storage.getSettings());
  try {
    const n = storage.abandonRunningTracesOnStartup();
    if (n > 0) console.info(`[okbot] marked ${n} abandoned run trace(s) on startup`);
  } catch (err) {
    console.error('[okbot] abandonRunningTracesOnStartup failed', err);
  }
  createWindow();

  app.on('activate', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length === 0) createWindow();
    else {
      for (const w of wins) {
        if (!w.isDestroyed()) {
          w.show();
          w.focus();
        }
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (e) => {
  if (getAllowQuit()) {
    for (const botId of [...abortControllers.keys()]) {
      abortControllers.get(botId)?.abort();
      abortControllers.delete(botId);
      rejectPendingApprovalsForBot(botId, '应用退出');
    }
    for (const p of storage.listAllPendingHitl()) {
      storage.clearPendingHitl(p.botId);
    }
    return;
  }

  const diskPendingCount = storage.listAllPendingHitl().length;
  const hasWork =
    abortControllers.size > 0 || pendingToolApprovals.size > 0 || diskPendingCount > 0;
  if (!hasWork) return;

  // Keep agent + pending HITL alive across Dock Quit / Cmd+Q while work is in flight.
  e.preventDefault();

  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const anyVisible = wins.some((w) => w.isVisible());

  if (anyVisible) {
    for (const w of wins) w.hide();
    return;
  }

  // Already running in background — second quit asks before cancelling work.
  void dialog
    .showMessageBox({
      type: 'warning',
      buttons: ['继续等待', '退出并取消'],
      defaultId: 0,
      cancelId: 0,
      message: '还有任务在后台等待',
      detail:
        pendingToolApprovals.size + diskPendingCount > 0
          ? `有 ${pendingToolApprovals.size + diskPendingCount} 个工具审批未完成。选「退出并取消」后将无法继续批准。`
          : '还有对话正在生成。选「退出并取消」将中断这些任务。',
    })
    .then(({ response }) => {
      if (response !== 1) {
        const open = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
        if (open.length === 0) createWindow();
        else {
          for (const w of open) {
            w.show();
            w.focus();
          }
        }
        return;
      }
      setAllowQuit(true);
      for (const botId of [...abortControllers.keys()]) {
        abortControllers.get(botId)?.abort();
        abortControllers.delete(botId);
        rejectPendingApprovalsForBot(botId, '应用退出');
      }
      // Disk-only pending (cold-start cards with no live Promise) must also go.
      for (const p of storage.listAllPendingHitl()) {
        storage.clearPendingHitl(p.botId);
      }
      app.quit();
    });
});
