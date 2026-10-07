import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IpcChannels, type AppSettings, type RuntimeEvent } from '@okbot/shared';
import { FileStorage } from './storage';
import { registerAllIpc, registerWindowControlIpc, type PendingToolApproval } from './ipc';
import { initAutoUpdater, onAutoUpdatePreferenceChanged } from './updater';
import { recoverInterruptedMacUpdate } from './macUpdateInstall';
import { getAllowQuit, setAllowQuit, getIsQuitting, setIsQuitting } from './quitState';
import { backgroundQuitCopy, closeDialogCopy, resolveMainUiLang } from './mainI18n';
import { destroyAppTray, ensureAppTray, focusOrShowWindows, hideWindowToTray, type AppTrayCallbacks } from './appTray';
import { createLocalHttpApi } from './localHttpApi';
import { closeMcp } from './mcpRuntime';
import { ensureGatewayToken, resolveGatewayUiRoot, startSkillWatch } from './gatewayRuntime';
import { startScheduleTicker } from './scheduleTicker';
import { abortAllOwnerRuns } from './ipc/ownerRuns';
import {
  acquireServerLock,
  inspectRunningServer,
  probeOkbotHealth,
  publicBase,
  releaseServerLock,
} from './serverPresence';

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

const abortControllers = new Map<string, Map<string, AbortController>>();
/** Pending HITL tool approvals: requestId -> resolve */
const pendingToolApprovals = new Map<string, PendingToolApproval>();

let localHttpApiController: ReturnType<typeof createLocalHttpApi> | null = null;
/** True only when this Electron process bound the gateway. A client must not stop `okbot serve`. */
let ownsServer = false;
let stopSkillWatch: (() => void) | null = null;
let stopScheduleTicker: (() => void) | null = null;
/** Set when another OkBot already owns the data directory. The window is UI only. */
let gatewayClient: { base: string; token: string; serveUi: boolean } | null = null;

/** Prevent re-entrant close dialogs when the user hammers the close button. */
let closeDialogOpen = false;

function trayCallbacks(): AppTrayCallbacks {
  const copy = closeDialogCopy(resolveMainUiLang(storage.getSettings().language));
  return {
    showWindow: () => {
      focusOrShowWindows(() => {
        if (app.isReady()) createWindow();
      });
    },
    quitApp: () => {
      setIsQuitting(true);
      app.quit();
    },
    labels: {
      show: copy.trayShow,
      quit: copy.trayQuit,
      tooltip: copy.trayTooltip,
    },
  };
}

function quitFromClose(): void {
  setIsQuitting(true);
  app.quit();
}

function broadcastSettingsChanged(): void {
  try {
    const settings = storage.getSettings();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcChannels.settingsChanged, settings);
    }
  } catch (err) {
    console.error('[okbot] broadcast settingsChanged failed', err);
  }
}

function persistCloseAction(action: 'quit' | 'tray'): void {
  try {
    const cur = storage.getSettings();
    if (cur.closeAction === action) {
      // Still notify so a stale renderer refreshes even if disk already matches.
      broadcastSettingsChanged();
      return;
    }
    storage.saveSettings({ ...cur, closeAction: action });
    broadcastSettingsChanged();
  } catch (err) {
    console.error('[okbot] persist closeAction failed', err);
  }
}

async function handleWindowCloseRequest(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  if (closeDialogOpen) return;

  const action = storage.getSettings().closeAction;

  const toTray = (): boolean => hideWindowToTray(win, trayCallbacks());

  if (action === 'tray') {
    if (!toTray()) quitFromClose();
    return;
  }
  if (action === 'quit') {
    quitFromClose();
    return;
  }

  // ask (default): Quit vs tray/hide, optional remember
  closeDialogOpen = true;
  try {
    const copy = closeDialogCopy(resolveMainUiLang(storage.getSettings().language));
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: [copy.tray, copy.quit, copy.cancel],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: copy.remember,
      checkboxChecked: false,
      noLink: true,
      message: copy.message,
      detail: copy.detail,
    });
    if (win.isDestroyed()) return;
    if (response === 2) return; // cancel — keep window open
    if (response === 0) {
      if (checkboxChecked) persistCloseAction('tray');
      if (!toTray()) quitFromClose();
      return;
    }
    if (response === 1) {
      if (checkboxChecked) persistCloseAction('quit');
      quitFromClose();
    }
  } catch (err) {
    console.error('[okbot] close dialog failed', err);
    // Keep the window usable — do not force-quit or leave close dead after a dialog error.
    try {
      if (!win.isDestroyed()) {
        if (!win.isVisible()) win.show();
        win.focus();
      }
    } catch (showErr) {
      console.error('[okbot] close dialog fallback show failed', showErr);
    }
  } finally {
    closeDialogOpen = false;
  }
}


function rememberGatewayClient(port: number): void {
  const api = storage.getSettings().localHttpApi;
  gatewayClient = {
    base: publicBase(port),
    token: api.token,
    serveUi: api.serveUi === true,
  };
  console.info(`[okbot] gateway already running at ${gatewayClient.base}; this window is a client`);
}

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
    pending.cancelTimeout?.();
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

let attachTokenIpcRegistered = false;

function registerAttachTokenIpc(): void {
  if (attachTokenIpcRegistered) return;
  attachTokenIpcRegistered = true;
  ipcMain.on(IpcChannels.attachGatewayToken, (event) => {
    event.returnValue = gatewayClient?.token ?? '';
  });
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
  const client = gatewayClient;
  if (client) {
    // Same renderer as a normal launch. Do not navigate to the gateway origin:
    // `/?token=` skips the login page, but that query is not an API credential,
    // so a server that is not actually serving the UI answers with unauthorized JSON.
    // The attach preload sends the saved token as Authorization. Never log it.
    opts.webPreferences = {
      ...opts.webPreferences,
      preload: path.join(__dirname, '../preload/attach.mjs'),
      // Token is not a command-line argument (visible to ps). The attach preload
      // reads it once over IPC. Never log it.
      additionalArguments: [`--okbot-api-base=${client.base}`],
      // Renderer origin (file:// or the dev server) is not the gateway origin.
      webSecurity: false,
    };
  } else {
    opts.webPreferences = {
      ...opts.webPreferences,
      preload: path.join(__dirname, '../preload/index.mjs'),
    };
  }
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

  // Windows/Linux: set window icon explicitly (taskbar / alt-tab). Packaged Win also
  // embeds resources/icon.ico into the exe via electron-builder; this covers runtime.
  if (process.platform === 'win32' || process.platform === 'linux') {
    const ico = path.join(__dirname, '../../resources/icon.ico');
    const png = path.join(__dirname, '../../resources/icon.png');
    if (fs.existsSync(ico)) opts.icon = ico;
    else if (fs.existsSync(png)) opts.icon = png;
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
  win.on('close', (e) => {
    persistBounds();
    // App is quitting (Cmd+Q, tray Quit, updater, remembered quit) — allow destroy.
    if (getIsQuitting() || getAllowQuit()) return;
    e.preventDefault();
    void handleWindowCloseRequest(win);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
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

function sendRuntimeEvent(event: RuntimeEvent) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.chatEvent, event);
  }
  localHttpApiController?.bridgeRuntimeEvent(event);
}

storage.setSessionsChangedListener((ownerId, reason) => {
  sendRuntimeEvent({ type: 'sessions_changed', botId: ownerId, reason });
});

app.on('second-instance', () => {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  if (wins.length === 0) {
    if (app.isReady()) createWindow();
    return;
  }
  const w = BrowserWindow.getFocusedWindow() ?? wins[0]!;
  if (w.isMinimized()) w.restore();
  if (!w.isVisible()) w.show();
  if (!w.isFocused()) w.focus();
});

app.whenReady().then(async () => {
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
    // media: getUserMedia / VoiceBeam / MediaRecorder.
    // Keep allowing speech-* strings if Chromium still asks (legacy).
    const name = String(permission);
    if (permission === 'media' || permission === 'mediaKeySystem' || /speech/i.test(name)) {
      callback(true);
      return;
    }
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    const name = String(permission);
    return permission === 'media' || permission === 'mediaKeySystem' || /speech/i.test(name);
  });

  if (process.platform === 'darwin' && app.isPackaged) {
    try {
      const recovery = recoverInterruptedMacUpdate(app.getPath('exe'));
      if (recovery.recovered && recovery.relaunch) {
        const { spawn } = await import('node:child_process');
        spawn('open', [recovery.restoredPath], { detached: true, stdio: 'ignore' }).unref();
        app.exit(0);
        return;
      }
      if (recovery.recovered) {
        console.info('[okbot] restored app bundle from interrupted update:', recovery.restoredPath);
      }
    } catch (err) {
      console.error('[okbot] mac update recovery failed', err);
    }
  }

  const uiRoot = resolveGatewayUiRoot(__dirname);
  const syncLocalHttpApi = () => {
    try {
      localHttpApiController?.sync(storage.getSettings().localHttpApi);
    } catch (err) {
      console.error('[okbot] localHttpApi sync failed', err);
    }
  };

  const gatewaySettings = storage.getSettings().localHttpApi;
  const running = await inspectRunningServer(storage.root, gatewaySettings.port, gatewaySettings.token);
  if (running.state === 'running') {
    rememberGatewayClient(running.port);
  } else {
    const desiredPort = storage.getSettings().localHttpApi.port;
    const lock = acquireServerLock(storage.root, {
      pid: process.pid,
      port: desiredPort,
      owner: 'electron',
    });
    if (!lock.ok) {
      const attachPort = lock.existing.port || desiredPort;
      const verified = await probeOkbotHealth(
        attachPort,
        400,
        storage.getSettings().localHttpApi.token,
      );
      if (verified) {
        rememberGatewayClient(attachPort);
      } else {
        console.error(
          `[okbot] data dir lock is held (pid ${lock.existing.pid}) but port ${attachPort} is not a verified OkBot; not attaching`,
        );
      }
    } else {
      ownsServer = true;

  const ipcCtx = {
    storage,
    abortControllers,
    pendingToolApprovals,
    hardwareAccelerationActive,
    sendRuntimeEvent,
    snapshotActiveRuns,
    rejectPendingApprovalsForBot,
    applyTheme,
    onAutoUpdatePreferenceChanged,
    onLocalHttpApiSettingsChanged: syncLocalHttpApi,
  };
  localHttpApiController = createLocalHttpApi({
    ctx: ipcCtx,
    uiRoot,
    appVersion: app.getVersion(),
  });

  registerAllIpc(ipcCtx);

  const ownedSettings = ensureGatewayToken(storage);
  try {
    await localHttpApiController.listen(ownedSettings.localHttpApi);
  } catch (err) {
    const port = ownedSettings.localHttpApi.port;
    const health = await probeOkbotHealth(port, 400, ownedSettings.localHttpApi.token);
    if (health) {
      try {
        localHttpApiController.stop();
      } catch (stopErr) {
        console.error('[okbot] localHttpApi stop after attach failed', stopErr);
      }
      localHttpApiController = null;
      ownsServer = false;
      releaseServerLock(storage.root);
      rememberGatewayClient(port);
    } else {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        console.error(`[okbot] port ${port} is in use and is not an OkBot server`);
      } else {
        console.error('[okbot] localHttpApi failed to start', err);
      }
    }
  }

  if (ownsServer) {
    stopSkillWatch = startSkillWatch(storage, sendRuntimeEvent);
    stopScheduleTicker = startScheduleTicker({ storage, ctx: ipcCtx });
    initAutoUpdater(() => storage.getSettings());
    try {
      const n = storage.abandonRunningTracesOnStartup();
      if (n > 0) console.info(`[okbot] marked ${n} abandoned run trace(s) on startup`);
    } catch (err) {
      console.error('[okbot] abandonRunningTracesOnStartup failed', err);
    }
  }
  }
  }

  registerAttachTokenIpc();
  registerWindowControlIpc();
  createWindow();

  app.on('activate', () => {
    const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
    if (wins.length === 0) createWindow();
    else {
      // One window only — focusing every BrowserWindow on activate caused brief
      // mouse stutter when returning from another app / Dock.
      const w = BrowserWindow.getFocusedWindow() ?? wins[0]!;
      if (!w.isVisible()) w.show();
      if (!w.isFocused()) w.focus();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  destroyAppTray();
  // Client of `okbot serve`: do not stop that process or delete its lock.
  if (!ownsServer) return;
  try {
    stopSkillWatch?.();
    try {
      stopScheduleTicker?.();
    } catch (err) {
      console.error('[okbot] schedule ticker stop failed', err);
    }
    stopScheduleTicker = null;
  } catch (err) {
    console.error('[okbot] skill watch stop on quit failed', err);
  }
  try {
    localHttpApiController?.stop();
  } catch (err) {
    console.error('[okbot] localHttpApi stop on quit failed', err);
  }
  // Stop MCP stdio child processes.
  void closeMcp().catch(() => {});
  releaseServerLock(storage.root);
});

app.on('before-quit', (e) => {
  setIsQuitting(true);
  // UI client of an existing server: quitting this window must not cancel its work.
  if (!ownsServer) return;
  if (getAllowQuit()) {
    try {
      localHttpApiController?.stop();
    } catch (err) {
      console.error('[okbot] localHttpApi stop on quit failed', err);
    }
    for (const botId of [...abortControllers.keys()]) {
      abortAllOwnerRuns(abortControllers, botId);
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
  setIsQuitting(false);

  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const anyVisible = wins.some((w) => w.isVisible());

  if (anyVisible) {
    for (const w of wins) w.hide();
    // Keep a tray affordance so the user can reopen while work continues.
    ensureAppTray(trayCallbacks());
    if (process.platform === 'darwin') {
      try {
        app.dock?.hide();
      } catch {
        /* ignore */
      }
    }
    return;
  }

  // Already running in background — second quit asks before cancelling work.
  const bgCopy = backgroundQuitCopy(resolveMainUiLang(storage.getSettings().language));
  const pendingCount = pendingToolApprovals.size + diskPendingCount;
  const bgOpts = {
    type: 'warning' as const,
    buttons: [bgCopy.wait, bgCopy.forceQuit],
    defaultId: 0,
    cancelId: 0,
    message: bgCopy.message,
    detail: pendingCount > 0 ? bgCopy.detailPending(pendingCount) : bgCopy.detailBusy,
  };
  // Do not parent to an invisible window (wins[0] when !anyVisible): macOS sheets
  // on hidden BrowserWindows misbehave. Parent only when a window is visible.
  const bgParent = wins.find((w) => !w.isDestroyed() && w.isVisible());
  const bgDialog = bgParent
    ? dialog.showMessageBox(bgParent, bgOpts)
    : dialog.showMessageBox(bgOpts);
  void bgDialog.then(({ response }) => {
      if (response !== 1) {
        focusOrShowWindows(() => {
          if (app.isReady()) createWindow();
        });
        return;
      }
      setAllowQuit(true);
      try {
        localHttpApiController?.stop();
      } catch (err) {
        console.error('[okbot] localHttpApi stop on quit failed', err);
      }
      for (const botId of [...abortControllers.keys()]) {
        abortAllOwnerRuns(abortControllers, botId);
        rejectPendingApprovalsForBot(botId, '应用退出');
      }
      // Disk-only pending (cold-start cards with no live Promise) must also go.
      for (const p of storage.listAllPendingHitl()) {
        storage.clearPendingHitl(p.botId);
      }
      app.quit();
    });
});
