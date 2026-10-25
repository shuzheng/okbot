import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen, session, shell } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IpcChannels,
  isLoopbackHostname,
  mergeClientGatewaySettings,
  normalizeGatewayHttpApiSettings,
  pickClientSettings,
  type AppSettings,
  type GatewayHttpApiSettings,
  type RuntimeEvent,
  type ShellNavigatePayload,
} from '@okbot/shared';
import { FileStorage } from '@okbot/gateway';
import { registerAllIpc, registerWindowControlIpc, registerClientGatewayIpc, registerUpdaterIpc, type PendingToolApproval } from './ipc';
import { bindWindowChromeFns } from './windowChromeBridge';
import { initAutoUpdater, onAutoUpdatePreferenceChanged } from './updater';
import { recoverInterruptedMacUpdate } from './macUpdateInstall';
import { getAllowQuit, setAllowQuit, getIsQuitting, setIsQuitting } from './quitState';
import { relaunchOkBotApp } from './relaunchApp';
import { isAllowedSessionPermission } from './sessionPermissions';
import { backgroundQuitCopy, closeDialogCopy, remoteGatewayFailureCopy, resolveMainUiLang } from './mainI18n';
import { destroyAppTray, ensureAppTray, focusOrShowWindows, hideWindowToTray, type AppTrayCallbacks } from './appTray';
import { collectTraySessions } from './appTrayMenu';
import { createGatewayHttpApi } from '@okbot/gateway';
import { closeMcp } from '@okbot/gateway';
import { ensureGatewayToken, resolveGatewayUiRoot, startSkillWatch } from '@okbot/gateway';
import { startScheduleTicker } from '@okbot/gateway';
import { resumeAllSafeCheckpoints } from '@okbot/gateway';
import { abortAllOwnerRuns, listBusyOwnerIds } from '@okbot/gateway';
import {
  acquireServerLock,
  inspectRunningServer,
  probeOkbotHealth,
  probeOkbotWithGatewayTokens,
  publicBase,
  releaseServerLock,
} from '@okbot/gateway';
import { getActive, loadPrefs, LOCAL_GATEWAY_ID, setActive } from './clientGatewayPrefs';
import { bindClientGatewaySwitch, type SwitchClientGatewayResult } from './clientGatewaySwitch';
import { planBackgroundLocalGateway } from './ensureBackgroundLocalGateway';
import {
  getWindowBounds as getClientWindowBounds,
  loadClientSettings,
  migrateClientSettingsFromGatewayRaw,
  migrateWindowBoundsFromGatewayRoot,
  saveClientSettings,
  saveWindowBounds as saveClientWindowBounds,
} from './clientSettings';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Local desktop always uses the default data root (~/.okbot) + that root's configured port (default 18765). Custom multi-instance dirs from `okbot serve --port … --data-dir …` are not auto-discovered. */
const storage = new FileStorage();

// Trigger peel of legacy client chrome from gateway settings, then seed ~/.okbot/client.json.
storage.getSettings();
const peeled = storage.takePeeledClientSettings();
if (peeled) {
  migrateClientSettingsFromGatewayRaw(peeled);
} else {
  // Ensure ~/.okbot/client.json exists even on fresh installs / already-slim gateway files.
  loadClientSettings();
}
migrateWindowBoundsFromGatewayRoot(storage.root);

function readUiSettings(): AppSettings {
  return mergeClientGatewaySettings(storage.getSettings(), loadClientSettings());
}

function writeUiSettings(settings: AppSettings): AppSettings {
  const client = saveClientSettings(pickClientSettings(settings));
  const gatewaySaved = storage.saveSettings(settings);
  return mergeClientGatewaySettings(gatewaySaved, client);
}

// Must run before app.ready — reads client chrome (~/.okbot/client.json), not gateway settings.
const hardwareAccelerationActive = loadClientSettings().hardwareAcceleration !== false;
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

let gatewayHttpApiController: ReturnType<typeof createGatewayHttpApi> | null = null;
/** True only when this Electron process bound the gateway. A client must not stop `okbot serve`. */
let ownsServer = false;
let stopSkillWatch: (() => void) | null = null;
let stopScheduleTicker: (() => void) | null = null;
/** Set when another OkBot already owns the data directory. The window is UI only. */
let gatewayClient: { base: string; token: string; serveUi: boolean } | null = null;

/** Prevent re-entrant close dialogs when the user hammers the close button. */
let closeDialogOpen = false;

/** Tray navigate while a window is still loading — flushed on did-finish-load. */
let pendingShellNavigate: ShellNavigatePayload | null = null;
/** Debounce tray rebuild when sessions/settings change. */
let trayRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function sendShellNavigate(payload: ShellNavigatePayload): void {
  let sent = false;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (win.webContents.isLoadingMainFrame()) {
      pendingShellNavigate = payload;
      continue;
    }
    win.webContents.send(IpcChannels.shellNavigate, payload);
    sent = true;
  }
  if (!sent) pendingShellNavigate = payload;
}

function flushPendingShellNavigate(win: BrowserWindow): void {
  const payload = pendingShellNavigate;
  if (!payload || win.isDestroyed()) return;
  pendingShellNavigate = null;
  win.webContents.send(IpcChannels.shellNavigate, payload);
}

function trayCallbacks(): AppTrayCallbacks {
  const settings = readUiSettings();
  const copy = closeDialogCopy(resolveMainUiLang(settings.language));
  const { pinned, recent } = collectTraySessions({
    bots: storage.listBots(),
    squads: storage.listSquads(),
    pinnedOwnerIds: settings.pinnedOwnerIds || [],
    hiddenOwnerIds: settings.hiddenOwnerIds || [],
    recentLimit: 10,
  });
  const theme =
    settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system';
  return {
    showWindow: () => {
      focusOrShowWindows(() => {
        if (app.isReady()) createWindow();
      });
    },
    openSession: (entry) => {
      focusOrShowWindows(() => {
        if (app.isReady()) createWindow();
      });
      sendShellNavigate({ action: 'openSession', kind: entry.kind, id: entry.id });
    },
    openSettings: () => {
      focusOrShowWindows(() => {
        if (app.isReady()) createWindow();
      });
      sendShellNavigate({ action: 'settings' });
    },
    quitApp: () => {
      setIsQuitting(true);
      app.quit();
    },
    setTheme: (next) => {
      try {
        const cur = loadClientSettings();
        const themeNext = next === 'light' || next === 'dark' ? next : 'system';
        if (cur.theme === themeNext) {
          applyTheme(themeNext);
          scheduleRefreshAppTray();
          return;
        }
        saveClientSettings({ ...cur, theme: themeNext });
        applyTheme(themeNext);
        broadcastSettingsChanged();
      } catch (err) {
        console.error('[okbot] tray setTheme failed', err);
      }
    },
    theme,
    labels: {
      show: copy.trayShow,
      recentSessions: copy.trayRecentSessions,
      pinnedSessions: copy.trayPinnedSessions,
      theme: copy.trayTheme,
      themeSystem: copy.trayThemeSystem,
      themeLight: copy.trayThemeLight,
      themeDark: copy.trayThemeDark,
      settings: copy.traySettings,
      quit: copy.trayQuit,
      tooltip: copy.trayTooltip,
    },
    pinned,
    recent,
  };
}

function refreshAppTray(): void {
  if (!app.isReady()) return;
  try {
    ensureAppTray(trayCallbacks());
  } catch (err) {
    console.error('[okbot] refreshAppTray failed', err);
  }
}

function scheduleRefreshAppTray(): void {
  if (trayRefreshTimer != null) clearTimeout(trayRefreshTimer);
  trayRefreshTimer = setTimeout(() => {
    trayRefreshTimer = null;
    refreshAppTray();
  }, 400);
}

function quitFromClose(): void {
  setIsQuitting(true);
  app.quit();
}

function broadcastSettingsChanged(): void {
  try {
    const settings = readUiSettings();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcChannels.settingsChanged, settings);
    }
    scheduleRefreshAppTray();
  } catch (err) {
    console.error('[okbot] broadcast settingsChanged failed', err);
  }
}

function persistCloseAction(action: 'quit' | 'tray'): void {
  try {
    const cur = loadClientSettings();
    if (cur.closeAction === action) {
      // Still notify so a stale renderer refreshes even if disk already matches.
      broadcastSettingsChanged();
      return;
    }
    saveClientSettings({ ...cur, closeAction: action });
    broadcastSettingsChanged();
  } catch (err) {
    console.error('[okbot] persist closeAction failed', err);
  }
}

async function handleWindowCloseRequest(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  if (closeDialogOpen) return;

  const action = loadClientSettings().closeAction;

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
    const copy = closeDialogCopy(resolveMainUiLang(loadClientSettings().language));
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


function rememberGatewayClient(port: number, tokenOverride?: string): void {
  const api = storage.getSettings().gatewayHttpApi;
  const token =
    typeof tokenOverride === 'string' && tokenOverride.trim()
      ? tokenOverride.trim()
      : api.token;
  gatewayClient = {
    base: publicBase(port),
    token,
    serveUi: api.serveUi === true,
  };
  console.info(`[okbot] gateway already running at ${gatewayClient.base}; this window is a client`);
  // May run before app.ready finishes ownsServer wiring; safe no-op until local attach.
  registerAttachLocalGatewaySettingsIpc();
}

function rememberRemoteGatewayClient(baseUrl: string, token: string): void {
  gatewayClient = {
    base: baseUrl.replace(/\/+$/, ''),
    token,
    // Remote attach: UI is the Electron renderer + HTTP bridge, not the gateway's static UI.
    serveUi: false,
  };
  console.info(`[okbot] attaching to remote gateway at ${gatewayClient.base}`);
}

/** Replace open windows so the new gatewayClient selects attach vs owner preload. */
function recreateWindowsForCurrentGatewayClient(): void {
  const oldWins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  try {
    createWindow();
  } catch (err) {
    console.error('[okbot] recreate window after gateway switch failed', err);
    return;
  }
  setAllowQuit(true);
  try {
    for (const w of oldWins) {
      if (!w.isDestroyed()) w.destroy();
    }
  } finally {
    setAllowQuit(false);
  }
}

/**
 * Hot-switch when this window is already an HTTP attach client, or when the
 * owner window recreates as attach while keeping the local gateway warm (owner→remote).
 * Attach → local only hot-switches when loopback gateway is already reachable;
 * otherwise relaunch so main can own/start the local server.
 * (Dev relaunch goes through relaunchOkBotApp → pnpm/electron-vite, not bare
 * app.relaunch(), so Vite comes back instead of a stale out/renderer.)
 *
 * True in-window owner→attach without recreate is impossible: Electron preload
 * is chosen in BrowserWindowConstructorOptions and cannot be swapped later.
 */
async function switchClientGatewayTarget(id: string): Promise<SwitchClientGatewayResult> {
  const prefsBefore = loadPrefs();
  const previousActiveId = prefsBefore.activeId;
  const target = prefsBefore.gateways.find((g) => g.id === id);
  if (!target) {
    throw new Error('gateway_not_found');
  }
  if (id === previousActiveId) {
    return { mode: gatewayClient ? 'hot' : 'relaunch', prefs: prefsBefore, previousActiveId };
  }

  // Owner (full preload, no gatewayClient): recreate as attach for remote; keep local warm.
  if (!gatewayClient) {
    if (target.kind === 'remote') {
      const baseUrl = typeof target.baseUrl === 'string' ? target.baseUrl.trim() : '';
      const token = typeof target.token === 'string' ? target.token.trim() : '';
      if (!baseUrl || !token) {
        throw new Error('remote_gateway_incomplete');
      }
      const verified = await probeOkbotHealth(baseUrl, 3000, token);
      if (!verified) {
        throw new Error('gateway_unreachable');
      }
      const prefs = setActive(id);
      // Keep owning the in-process local gateway so remote→local can hot-switch later.
      // UI switches to attach preload against the remote; local stays warm in background.
      rememberRemoteGatewayClient(baseUrl, token);
      // Owner path already called initAutoUpdater when it owned the server; attach
      // boot also needs it if we never owned (shouldn't happen here) — safe to call.
      initAutoUpdater(() => readUiSettings());
      // Use probed URL/token — TS still sees gatewayClient as null inside `if (!gatewayClient)`.
      const attachBase = baseUrl.replace(/\/+$/, '');
      const result: SwitchClientGatewayResult = {
        mode: 'hot',
        prefs,
        previousActiveId,
        base: attachBase,
        token,
      };
      // Let the IPC reply reach the owner renderer before we destroy its window.
      setImmediate(() => {
        recreateWindowsForCurrentGatewayClient();
      });
      return result;
    }
    const prefs = setActive(id);
    return { mode: 'relaunch', prefs, previousActiveId };
  }

  if (target.kind === 'remote') {
    const baseUrl = typeof target.baseUrl === 'string' ? target.baseUrl.trim() : '';
    const token = typeof target.token === 'string' ? target.token.trim() : '';
    if (!baseUrl || !token) {
      throw new Error('remote_gateway_incomplete');
    }
    const verified = await probeOkbotHealth(baseUrl, 3000, token);
    if (!verified) {
      throw new Error('gateway_unreachable');
    }
    const prefs = setActive(id);
    rememberRemoteGatewayClient(baseUrl, token);
    return {
      mode: 'hot',
      prefs,
      previousActiveId,
      base: gatewayClient.base,
      token: gatewayClient.token,
    };
  }

  // kind === local: hot only if something is already serving on loopback.
  const gatewaySettings = storage.getSettings().gatewayHttpApi;
  const port = gatewaySettings.port;
  // Local host attach: prefer admin so Settings → 网关端 works while CLI owns serve.
  const probed = await probeOkbotWithGatewayTokens(
    port,
    800,
    gatewaySettings.token,
    gatewaySettings.adminToken,
    { prefer: 'admin' },
  );
  if (!probed.ok) {
    const prefs = setActive(id);
    return { mode: 'relaunch', prefs, previousActiveId };
  }
  const prefs = setActive(id);
  rememberGatewayClient(port, probed.token || gatewaySettings.adminToken || gatewaySettings.token);
  // Owning-in-background + attach UI may not have registered loopback settings IPC yet.
  registerAttachLocalGatewaySettingsIpc();
  return {
    mode: 'hot',
    prefs,
    previousActiveId,
    base: gatewayClient.base,
    token: gatewayClient.token,
  };
}

type RemoteGatewayFailureChoice = 'retry' | 'openSettings' | 'quit';

/**
 * Remote prefs / probe failed before any window.
 * Retry re-probes; Open Settings is an explicit switch to Local so the desktop UI can load
 * Settings → Gateway list (never a silent local fallback); Quit exits.
 */
async function showRemoteGatewayFailureDialog(
  message: string,
  detail: string,
): Promise<RemoteGatewayFailureChoice> {
  const copy = remoteGatewayFailureCopy(resolveMainUiLang(loadClientSettings().language));
  const { response } = await dialog.showMessageBox({
    type: 'error',
    buttons: [copy.retry, copy.openSettings, copy.quit],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message,
    detail: `${detail}\n\n${copy.hint}`,
  });
  if (response === 0) return 'retry';
  if (response === 1) return 'openSettings';
  return 'quit';
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
    ...listBusyOwnerIds(abortControllers),
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
  // Intentional Stop / cancel: drop mid-run checkpoints (same tone as pending-hitl).
  try {
    storage.clearRunCheckpoint(botId);
  } catch (err) {
    console.error('[okbot] clear run checkpoint on reject failed', err);
  }
}

function opaqueWindowBg(): string {
  return nativeTheme.shouldUseDarkColors ? '#000000' : '#f6f6f7';
}

/**
 * Darwin window chrome for translucent on/off.
 *
 * `transparent` is constructor-only and cannot flip live. Strategy:
 * - createWindow installs transparent+vibrancy only when frost is on; frost
 *   off creates a normal opaque window (cheap resize on weak MacBooks).
 * - Enabling frost after an opaque-born window (or after a live OFF that
 *   cleared vibrancy) MUST recreate BrowserWindow. Hot setVibrancy('sidebar')
 *   on a non-transparent window — or after opaque fill + setVibrancy(null) —
 *   leaves classic CALayer burn-in (ghosted session names / continuous flicker).
 *   Recreate queues shellNavigate settings (general + translucent) so Settings
 *   reopens after did-finish-load — avoids the mid-toggle Settings close from
 *   the older recreate-without-restore path.
 * - Disabling frost: live setVibrancy(null) + opaque fill (OK; no burn-in path).
 * - Do NOT park vibrancy off during edge resize — that made frost blink
 *   on/off. Resize smoothness stays with CSS/React `is-window-resizing` gates.
 *
 * Skips no-op re-applies (every saveSettings used to thrash chrome and flash
 * the sidebar when leaving Settings).
 */
let lastWindowChrome: { translucent: boolean; bg: string } | null = null;

/** Persist translucent before recreate so createWindow reads the new value. */
function persistClientTranslucent(translucent: boolean): void {
  try {
    const cur = loadClientSettings();
    if (cur.translucent === translucent) return;
    saveClientSettings({ ...cur, translucent });
  } catch (err) {
    console.error('[okbot] persist translucent failed', err);
  }
}

function applyWindowTranslucent(translucent: boolean) {
  const bg =
    process.platform === 'darwin'
      ? translucent
        ? '#00000000'
        : opaqueWindowBg()
      : opaqueWindowBg();
  const prev = lastWindowChrome?.translucent;
  if (
    lastWindowChrome &&
    lastWindowChrome.translucent === translucent &&
    lastWindowChrome.bg === bg
  ) {
    return;
  }
  lastWindowChrome = { translucent, bg };
  persistClientTranslucent(translucent);

  // Darwin: enabling frost needs a transparent+vibrancy constructor stack.
  // Recreate (with Settings restore) instead of hot setVibrancy on an opaque
  // window — that path is the burn-in/flicker in the sidebar.
  // First apply (prev === undefined) is startup: createWindow already matched
  // persisted frost, so only sync bg/vibrancy without remounting.
  if (
    process.platform === 'darwin' &&
    prev === false &&
    translucent === true &&
    BrowserWindow.getAllWindows().some((w) => !w.isDestroyed())
  ) {
    // Queue before recreate so did-finish-load flush reopens Settings mid-toggle.
    pendingShellNavigate = {
      action: 'settings',
      tab: 'general',
      sectionId: 'translucent',
    };
    setImmediate(() => {
      recreateWindowsForCurrentGatewayClient();
    });
    return;
  }

  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  for (const win of windows) {
    if (process.platform === 'darwin') {
      try {
        if (translucent) {
          // Clear opaque fill first so sidebar vibrancy can show through.
          // Only reached when window already has transparent ctor (startup /
          // theme re-assert) — live OFF→ON recreates above.
          win.setBackgroundColor('#00000000');
          win.setVibrancy('sidebar');
        } else {
          // Drop vibrancy before opaque fill — reverse order previously left
          // stale CALayer contents (settings-nav burn-in over the list).
          win.setVibrancy(null);
          win.setBackgroundColor(bg);
        }
      } catch (err) {
        console.error('[okbot] setVibrancy/bg failed', err);
      }
      try {
        win.invalidateShadow();
      } catch (err) {
        console.error('[okbot] invalidateShadow failed', err);
      }
    } else {
      win.setBackgroundColor(bg);
    }
  }
}

function applyTheme(theme: AppSettings['theme']) {
  if (theme === 'system') nativeTheme.themeSource = 'system';
  else nativeTheme.themeSource = theme;
  // Frost OFF→ON recreates via applyWindowTranslucent. Theme-only flips keep
  // the same window and re-assert vibrancy under themeSource when frost is on.
  const translucent = loadClientSettings().translucent !== false;
  lastWindowChrome = null;
  applyWindowTranslucent(translucent);
  if (process.platform === 'darwin' && translucent) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.setVibrancy('sidebar');
      } catch (err) {
        console.error('[okbot] setVibrancy failed', err);
      }
      try {
        win.invalidateShadow();
      } catch (err) {
        console.error('[okbot] invalidateShadow failed', err);
      }
    }
  }
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
let attachLocalGatewaySettingsIpcRegistered = false;

function registerAttachTokenIpc(): void {
  if (attachTokenIpcRegistered) return;
  attachTokenIpcRegistered = true;
  ipcMain.on(IpcChannels.attachGatewayToken, (event) => {
    event.returnValue = gatewayClient?.token ?? '';
  });
}

function isLoopbackGatewayClientBase(base: string): boolean {
  try {
    const host = new URL(base.includes('://') ? base : `http://${base}`).hostname;
    return isLoopbackHostname(host);
  } catch {
    return false;
  }
}

/**
 * Local-host attach (CLI/`okbot serve`, or Electron owning local while UI uses attach
 * preload): read/write gatewayHttpApi from ~/.okbot via IPC so listen/token changes do
 * not restart the HTTP server mid-response. HTTP GET /v1/gateway-token only echoes the
 * presented credential (admin attach blanks 用户令牌). Remote admin may still POST
 * gatewayHttpApi via /v1/settings.
 * Skip when UI is on a remote gateway (must not leak this machine's tokens). True owner
 * windows have gatewayClient=null and use registerAllIpc instead.
 */
function registerAttachLocalGatewaySettingsIpc(): void {
  if (attachLocalGatewaySettingsIpcRegistered) return;
  if (!gatewayClient || !isLoopbackGatewayClientBase(gatewayClient.base)) return;
  attachLocalGatewaySettingsIpcRegistered = true;

  // listen-fail→attach may already have registerAllIpc token handlers; replace safely.
  const putHandler = (channel: string, handler: (...args: any[]) => unknown) => {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      /* not registered */
    }
    ipcMain.handle(channel, handler);
  };

  putHandler(IpcChannels.getGatewayAccessToken, () => {
    const token = storage.getSettings().gatewayHttpApi?.token;
    return typeof token === 'string' ? token : '';
  });
  putHandler(IpcChannels.getGatewayAdminToken, () => {
    const token = storage.getSettings().gatewayHttpApi?.adminToken;
    return typeof token === 'string' ? token : '';
  });
  putHandler(
    IpcChannels.saveLocalGatewayHttpApi,
    (_e, patch: unknown): GatewayHttpApiSettings => {
      const current = storage.getSettings();
      const prevApi = current.gatewayHttpApi;
      const nextApi = normalizeGatewayHttpApiSettings({
        ...prevApi,
        ...(patch && typeof patch === 'object' && !Array.isArray(patch)
          ? (patch as Record<string, unknown>)
          : {}),
      });
      const saved = storage.saveSettings({ ...current, gatewayHttpApi: nextApi });
      // Keep Authorization in sync when the credential this window presents was rotated.
      if (gatewayClient) {
        const presented = (gatewayClient.token || '').trim();
        if (presented && presented === (prevApi?.adminToken || '').trim() && nextApi.adminToken) {
          gatewayClient = { ...gatewayClient, token: nextApi.adminToken };
        } else if (presented && presented === (prevApi?.token || '').trim() && nextApi.token) {
          gatewayClient = { ...gatewayClient, token: nextApi.token };
        }
      }
      return saved.gatewayHttpApi;
    },
  );
}


/**
 * Always load THIS app's renderer (Vite ELECTRON_RENDERER_URL or packaged out/renderer).
 * Never navigate to a remote gateway's serveUi HTML — attach uses HTTP APIs only
 * (`--okbot-api-base` + attach preload). Chrome WebUI on the gateway URL is separate.
 */
async function loadRenderer(win: BrowserWindow): Promise<void> {
  const filePath = path.join(__dirname, '../renderer/index.html');
  const devUrl = process.env.ELECTRON_RENDERER_URL?.trim();
  if (devUrl) {
    const reachable = await probeRendererDevUrl(devUrl);
    if (reachable) {
      try {
        await win.loadURL(devUrl);
        return;
      } catch (err) {
        console.error('[okbot] loadURL failed; falling back to packaged renderer', err);
      }
    } else {
      console.warn(
        `[okbot] ELECTRON_RENDERER_URL unreachable (${devUrl}); falling back to packaged renderer `
          + '(stale out/renderer if you used app.relaunch() under electron-vite — use relaunchOkBotApp / pnpm dev)',
      );
    }
  }
  try {
    await win.loadFile(filePath);
  } catch (err) {
    console.error('[okbot] loadFile renderer failed', err);
  }
}

function probeRendererDevUrl(devUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    let target: URL;
    try {
      target = new URL(devUrl);
    } catch {
      resolve(false);
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      resolve(false);
      return;
    }
    const getLib = target.protocol === 'https:' ? https : http;
    const req = getLib.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname || '/',
        method: 'HEAD',
        timeout: 400,
      },
      (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 500);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function createWindow() {
  const saved = getClientWindowBounds();
  const opts: Electron.BrowserWindowConstructorOptions = {
    width: saved?.width ?? 1180,
    height: saved?.height ?? 760,
    minWidth: 500,
    minHeight: 500,
    title: 'OkBot',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
  const translucent = loadClientSettings().translucent !== false;
  if (process.platform === 'darwin' && translucent) {
    // Transparent + sidebar vibrancy so the left rail frosts the desktop.
    // Frost off: skip both (constructor-only transparent is expensive to resize
    // even under an opaque fill). Live frost ON after opaque create recreates
    // via applyWindowTranslucent so constructor flags match (no CALayer burn-in).
    opts.transparent = true;
    opts.vibrancy = 'sidebar';
    opts.visualEffectState = 'followWindow';
    opts.backgroundColor = '#00000000';
  } else {
    opts.backgroundColor = opaqueWindowBg();
  }
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
      // Renderer origin (file:// or the Vite/dev server) is not the gateway origin.
      // Cross-origin fetch/SSE still need index.html CSP connect-src to allow http(s)
      // (not only loopback) — webSecurity:false alone does not bypass a meta CSP.
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
  // Resize smoothness: CSS/React is-window-resizing gates only — do not
  // setVibrancy(null) during edge drag (that made frost blink on/off).

  const persistBounds = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    saveClientWindowBounds(win.getBounds());
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

  win.webContents.once('did-finish-load', () => {
    flushPendingShellNavigate(win);
  });
  void loadRenderer(win);

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
  gatewayHttpApiController?.bridgeRuntimeEvent(event);
}

storage.setSessionsChangedListener((ownerId, reason) => {
  sendRuntimeEvent({ type: 'sessions_changed', botId: ownerId, reason });
  scheduleRefreshAppTray();
});

storage.setSettingsChangedListener(() => {
  sendRuntimeEvent({ type: 'settings_changed', at: new Date().toISOString() });
  // Owning Electron windows: push merged UI settings (client.json + server.json).
  // WebUI / attach pick up the same change via /v1/events → getSettings refetch.
  broadcastSettingsChanged();
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
  applyTheme(loadClientSettings().theme);

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

  // Renderer systemNotify (web Notification API) needs 'notifications' allowed here.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(isAllowedSessionPermission(String(permission)));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return isAllowedSessionPermission(String(permission));
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
  const syncGatewayHttpApi = () => {
    try {
      gatewayHttpApiController?.sync(storage.getSettings().gatewayHttpApi);
    } catch (err) {
      console.error('[okbot] gatewayHttpApi sync failed', err);
    }
  };

  /**
   * When UI attaches to a remote gateway, still ensure a local gateway is listening
   * (Electron-owned in-process, or leave a healthy CLI/`okbot serve` alone) so a later
   * remote→local switch can hot-attach without relaunch when possible.
   */
  async function ensureBackgroundLocalGatewayOwned(): Promise<void> {
    const gatewaySettings = storage.getSettings().gatewayHttpApi;
    const running = await inspectRunningServer(
      storage.root,
      gatewaySettings.port,
      gatewaySettings.token,
      gatewaySettings.adminToken,
    );

    let lock: { ok: true } | { ok: false; existing: { pid: number; port: number } } | undefined;
    let lockHolderVerified: boolean | undefined;
    if (running.state === 'free' && !ownsServer) {
      lock = acquireServerLock(storage.root, {
        pid: process.pid,
        port: gatewaySettings.port,
        owner: 'electron',
      });
      if (!lock.ok) {
        const heldPort = lock.existing.port || gatewaySettings.port;
        const probed = await probeOkbotWithGatewayTokens(
          heldPort,
          400,
          gatewaySettings.token,
          gatewaySettings.adminToken,
          { prefer: 'admin' },
        );
        lockHolderVerified = probed.ok;
      }
    }

    const plan = planBackgroundLocalGateway({
      alreadyOwnsInProcess: ownsServer,
      running,
      lock,
      lockHolderVerified,
    });

    if (plan.action === 'skip_already_running') {
      if (plan.port > 0) {
        console.info(
          `[okbot] local gateway already running at ${publicBase(plan.port)}; leaving it warm for later hot-switch`,
        );
      }
      return;
    }
    if (plan.action === 'skip_lock_held') {
      if (plan.verifiedOkbot) {
        console.info(
          `[okbot] local gateway lock held by pid ${plan.pid} at ${publicBase(plan.port)}; not stealing`,
        );
      } else {
        console.error(
          `[okbot] local data dir lock held (pid ${plan.pid}) but port ${plan.port} is not a verified OkBot; not starting background gateway`,
        );
      }
      return;
    }

    // plan.action === 'start' — lock already acquired above when free.
    if (!lock || !lock.ok) {
      console.error('[okbot] background local gateway plan said start but lock was not acquired');
      return;
    }

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
      applyWindowTranslucent,
      onAutoUpdatePreferenceChanged,
      onGatewayHttpApiSettingsChanged: syncGatewayHttpApi,
      onSettingsPersisted: scheduleRefreshAppTray,
      getUiSettings: readUiSettings,
      saveUiSettings: writeUiSettings,
    };
    gatewayHttpApiController = createGatewayHttpApi({
      ctx: ipcCtx,
      uiRoot,
      appVersion: app.getVersion(),
      onHostDataRestored: () => {
        setAllowQuit(true);
        relaunchOkBotApp();
      },
    });
    // No registerAllIpc: UI stays on remote attach preload; gateway serves over HTTP only.

    const ownedSettings = ensureGatewayToken(storage);
    try {
      await gatewayHttpApiController.listen(ownedSettings.gatewayHttpApi);
    } catch (err) {
      const port = ownedSettings.gatewayHttpApi.port;
      const probed = await probeOkbotWithGatewayTokens(
        port,
        400,
        ownedSettings.gatewayHttpApi.token,
        ownedSettings.gatewayHttpApi.adminToken,
        { prefer: 'admin' },
      );
      if (probed.ok) {
        try {
          gatewayHttpApiController.stop();
        } catch (stopErr) {
          console.error('[okbot] gatewayHttpApi stop after background attach failed', stopErr);
        }
        gatewayHttpApiController = null;
        ownsServer = false;
        releaseServerLock(storage.root);
        console.info(
          `[okbot] local gateway already listening at ${publicBase(port)}; left warm (background start lost the race)`,
        );
        return;
      }
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        console.error(`[okbot] background local gateway: port ${port} is in use and is not an OkBot server`);
      } else {
        console.error('[okbot] background local gatewayHttpApi failed to start', err);
      }
      try {
        gatewayHttpApiController?.stop();
      } catch {
        /* ignore */
      }
      gatewayHttpApiController = null;
      ownsServer = false;
      releaseServerLock(storage.root);
      return;
    }

    stopSkillWatch = startSkillWatch(storage, sendRuntimeEvent);
    stopScheduleTicker = startScheduleTicker({ storage, ctx: ipcCtx });
    void resumeAllSafeCheckpoints(ipcCtx).catch((err) => {
      console.error('[okbot] resume checkpoints on background local start failed', err);
    });
    console.info(
      `[okbot] started local gateway in background at ${publicBase(ownedSettings.gatewayHttpApi.port)} while UI attaches to remote`,
    );
  }

  // Client gateway prefs (~/.okbot/client.json → gateways).
  // Default activeId=local; no first-launch picker — local users attach-or-own silently.
  // After a failed remote probe, Open Settings explicitly switches activeId to local so
  // the desktop UI can load (never a silent fallback without that button).
  let startupKind: 'remote' | 'local' = getActive().kind === 'remote' ? 'remote' : 'local';
  let openSettingsAfterStart = false;

  if (startupKind === 'remote') {
    for (;;) {
      const activeGateway = getActive();
      const baseUrl = typeof activeGateway.baseUrl === 'string' ? activeGateway.baseUrl.trim() : '';
      const token = typeof activeGateway.token === 'string' ? activeGateway.token.trim() : '';
      if (!baseUrl || !token) {
        const choice = await showRemoteGatewayFailureDialog(
          'Remote gateway is not configured',
          'client.json gateways marks the active gateway as remote, but baseUrl and/or token are missing. '
            + 'Fix the gateway entry under Settings → Gateway list, or switch to Local. '
            + 'OkBot will not start a local gateway as a silent fallback.',
        );
        if (choice === 'retry') continue;
        if (choice === 'openSettings') {
          setActive(LOCAL_GATEWAY_ID);
          startupKind = 'local';
          openSettingsAfterStart = true;
          break;
        }
        setIsQuitting(true);
        app.quit();
        return;
      }
      // Remote probe may cross the network; loopback attach keeps the short timeout.
      const verified = await probeOkbotHealth(baseUrl, 3000, token);
      if (verified) {
        // UI attaches to remote only — do not point gatewayClient at local.
        // Still warm a local gateway (Electron-owned, or skip if CLI already serves)
        // so remote→local can hot-switch without relaunch when possible.
        rememberRemoteGatewayClient(baseUrl, token);
        await ensureBackgroundLocalGatewayOwned();
        // Folder path picks stay canceled in the HTTP attach bridge (httpOkbot.pickPaths);
        // a real remote folder picker needs renderer/slice-3 work against the gateway host FS.
        break;
      }
      const choice = await showRemoteGatewayFailureDialog(
        'Could not reach remote gateway',
        `Health/challenge probe failed for ${baseUrl.replace(/\/+$/, '')}. `
          + 'Check that the gateway is running, reachable, and the token matches. '
          + 'OkBot will not start a local gateway as a silent fallback.',
      );
      if (choice === 'retry') continue;
      if (choice === 'openSettings') {
        setActive(LOCAL_GATEWAY_ID);
        startupKind = 'local';
        openSettingsAfterStart = true;
        break;
      }
      setIsQuitting(true);
      app.quit();
      return;
    }
  }

  if (startupKind === 'local') {
    // kind === 'local' (default): inspect local presence / own server / attach loopback.

    const gatewaySettings = storage.getSettings().gatewayHttpApi;
    const running = await inspectRunningServer(
      storage.root,
      gatewaySettings.port,
      gatewaySettings.token,
      gatewaySettings.adminToken,
    );
    if (running.state === 'running') {
      // Local host attach: prefer admin (CLI serve / other Electron may own the lock).
      const probed = await probeOkbotWithGatewayTokens(
        running.port,
        400,
        gatewaySettings.token,
        gatewaySettings.adminToken,
        { prefer: 'admin' },
      );
      rememberGatewayClient(
        running.port,
        probed.ok
          ? probed.token || gatewaySettings.adminToken || gatewaySettings.token
          : gatewaySettings.adminToken || gatewaySettings.token,
      );
    } else {
      const desiredPort = storage.getSettings().gatewayHttpApi.port;
      const lock = acquireServerLock(storage.root, {
        pid: process.pid,
        port: desiredPort,
        owner: 'electron',
      });
      if (!lock.ok) {
        const attachPort = lock.existing.port || desiredPort;
        const api = storage.getSettings().gatewayHttpApi;
        const probed = await probeOkbotWithGatewayTokens(attachPort, 400, api.token, api.adminToken, {
          prefer: 'admin',
        });
        if (probed.ok) {
          rememberGatewayClient(attachPort, probed.token || api.adminToken || api.token);
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
          applyWindowTranslucent,
          onAutoUpdatePreferenceChanged,
          onGatewayHttpApiSettingsChanged: syncGatewayHttpApi,
          onSettingsPersisted: scheduleRefreshAppTray,
          getUiSettings: readUiSettings,
          saveUiSettings: writeUiSettings,
        };
        gatewayHttpApiController = createGatewayHttpApi({
          ctx: ipcCtx,
          uiRoot,
          appVersion: app.getVersion(),
          onHostDataRestored: () => {
            setAllowQuit(true);
            relaunchOkBotApp();
          },
        });

        registerAllIpc(ipcCtx);

        const ownedSettings = ensureGatewayToken(storage);
        try {
          await gatewayHttpApiController.listen(ownedSettings.gatewayHttpApi);
        } catch (err) {
          const port = ownedSettings.gatewayHttpApi.port;
          const probed = await probeOkbotWithGatewayTokens(
            port,
            400,
            ownedSettings.gatewayHttpApi.token,
            ownedSettings.gatewayHttpApi.adminToken,
            { prefer: 'admin' },
          );
          if (probed.ok) {
            try {
              gatewayHttpApiController.stop();
            } catch (stopErr) {
              console.error('[okbot] gatewayHttpApi stop after attach failed', stopErr);
            }
            gatewayHttpApiController = null;
            ownsServer = false;
            releaseServerLock(storage.root);
            rememberGatewayClient(
              port,
              probed.token
                || ownedSettings.gatewayHttpApi.adminToken
                || ownedSettings.gatewayHttpApi.token,
            );
          } else {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'EADDRINUSE') {
              console.error(`[okbot] port ${port} is in use and is not an OkBot server`);
            } else {
              console.error('[okbot] gatewayHttpApi failed to start', err);
            }
          }
        }

        if (ownsServer) {
          stopSkillWatch = startSkillWatch(storage, sendRuntimeEvent);
          stopScheduleTicker = startScheduleTicker({ storage, ctx: ipcCtx });
          initAutoUpdater(() => readUiSettings());
          // Crash recovery: mid-run checkpoints (pending-hitl still wins when both exist).
          void resumeAllSafeCheckpoints(ipcCtx).catch((err) => {
            console.error('[okbot] resume checkpoints on start failed', err);
          });
        }
      }
    }
  }


  registerAttachTokenIpc();
  registerAttachLocalGatewaySettingsIpc();
  bindWindowChromeFns({ applyTheme, applyWindowTranslucent });
  registerWindowControlIpc();
  registerClientGatewayIpc();
  bindClientGatewaySwitch(switchClientGatewayTarget);
  // Attach windows (incl. remote UI + background-owned local) need updater IPC + init.
  // True owner UI already called initAutoUpdater when it took the lock above.
  registerUpdaterIpc();
  if (!ownsServer || gatewayClient) {
    initAutoUpdater(() => readUiSettings());
  }
  createWindow();
  if (openSettingsAfterStart) {
    // Land on Gateway list so the unreachable remote is editable immediately.
    try {
      const cur = loadClientSettings();
      saveClientSettings({ ...cur, settingsNavTab: 'gateways' });
    } catch (err) {
      console.error('[okbot] prefer gateways tab after remote failure failed', err);
    }
    sendShellNavigate({ action: 'settings', tab: 'gateways' });
  }
  // Menu bar / system tray from launch (not only after hide-to-tray).
  ensureAppTray(trayCallbacks());

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
    gatewayHttpApiController?.stop();
  } catch (err) {
    console.error('[okbot] gatewayHttpApi stop on quit failed', err);
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
      gatewayHttpApiController?.stop();
    } catch (err) {
      console.error('[okbot] gatewayHttpApi stop on quit failed', err);
    }
    for (const botId of [...abortControllers.keys()]) {
      abortAllOwnerRuns(abortControllers, botId);
      rejectPendingApprovalsForBot(botId, '应用退出');
    }
    for (const p of storage.listAllPendingHitl()) {
      storage.clearPendingHitl(p.botId);
    }
    for (const c of storage.listAllRunCheckpoints()) {
      storage.clearRunCheckpoint(c.ownerId);
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
  const bgCopy = backgroundQuitCopy(resolveMainUiLang(loadClientSettings().language));
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
        gatewayHttpApiController?.stop();
      } catch (err) {
        console.error('[okbot] gatewayHttpApi stop on quit failed', err);
      }
      for (const botId of [...abortControllers.keys()]) {
        abortAllOwnerRuns(abortControllers, botId);
        rejectPendingApprovalsForBot(botId, '应用退出');
      }
      // Disk-only pending (cold-start cards with no live Promise) must also go.
      for (const p of storage.listAllPendingHitl()) {
        storage.clearPendingHitl(p.botId);
      }
      for (const c of storage.listAllRunCheckpoints()) {
        storage.clearRunCheckpoint(c.ownerId);
      }
      app.quit();
    });
});
