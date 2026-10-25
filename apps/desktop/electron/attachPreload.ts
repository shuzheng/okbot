import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  IpcChannels,
  isLoopbackHostname,
  type GatewayHttpApiSettings,
  type LocalizedChangelogNotes,
  type UpdaterStatus,
} from '@okbot/shared';
import type { ClientGatewayPrefs } from './clientGatewayPrefs';

function readArg(flag: string): string {
  const prefix = `${flag}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

const initialBase = readArg('--okbot-api-base');

// UI-only window: no IPC backend. The renderer talks to the already-running gateway.
// The token is a one-shot IPC read so it never appears in the process command line.
if (initialBase) {
  let attachBase = initialBase.replace(/\/+$/, '');
  let attachToken = '';
  try {
    const value = ipcRenderer.sendSync(IpcChannels.attachGatewayToken);
    attachToken = typeof value === 'string' ? value : '';
  } catch {
    attachToken = '';
  }
  let localHost = false;
  try {
    const host = new URL(attachBase.includes('://') ? attachBase : `http://${attachBase}`).hostname;
    localHost = isLoopbackHostname(host);
  } catch {
    localHost = false;
  }
  const onWindowMaximizedChanged = (handler: (maximized: boolean) => void) => {
    const listener = (_event: unknown, maximized: boolean) => handler(Boolean(maximized));
    ipcRenderer.on(IpcChannels.windowMaximizedChanged, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.windowMaximizedChanged, listener);
    };
  };
  contextBridge.exposeInMainWorld('__okbotAttach', {
    // Prefer getAttachConfig / setAttachTarget — plain base/token are initial snapshots
    // (contextBridge may freeze them). Hot switch updates the mutable getters below.
    get base() {
      return attachBase;
    },
    get token() {
      return attachToken;
    },
    platform: process.platform,
    getAttachConfig: () => ({
      base: attachBase,
      token: attachToken,
      platform: process.platform,
    }),
    setAttachTarget: (next: { base: string; token: string }) => {
      const b = typeof next?.base === 'string' ? next.base.trim().replace(/\/+$/, '') : '';
      const t = typeof next?.token === 'string' ? next.token : '';
      if (!b) return false;
      attachBase = b;
      attachToken = t;
      return true;
    },
    switchClientGateway: (id: string) =>
      ipcRenderer.invoke(IpcChannels.switchClientGateway, id) as Promise<{
        mode: 'hot' | 'relaunch';
        prefs: ClientGatewayPrefs;
        previousActiveId: string;
        base?: string;
        token?: string;
      }>,
    windowMinimize: () => ipcRenderer.invoke(IpcChannels.windowMinimize),
    windowMaximizeToggle: () => ipcRenderer.invoke(IpcChannels.windowMaximizeToggle),
    windowClose: () => ipcRenderer.invoke(IpcChannels.windowClose),
    windowIsMaximized: () => ipcRenderer.invoke(IpcChannels.windowIsMaximized),
    windowFocus: () => ipcRenderer.invoke(IpcChannels.windowFocus),
    setBadgeCount: (count: number) => ipcRenderer.invoke(IpcChannels.setBadgeCount, count),
    onWindowMaximizedChanged,
    onShellNavigate: (
      handler: (payload: import('@okbot/shared').ShellNavigatePayload) => void,
    ): (() => void) => {
      const listener = (_: unknown, payload: import('@okbot/shared').ShellNavigatePayload) =>
        handler(payload);
      ipcRenderer.on(IpcChannels.shellNavigate, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.shellNavigate, listener);
      };
    },
    getPathForFile: (file: File): string => {
      try {
        return webUtils.getPathForFile(file) || '';
      } catch {
        return '';
      }
    },
    // Client gateway prefs are local Electron userData — not the remote gateway.
    getClientGatewayPrefs: () => ipcRenderer.invoke(IpcChannels.getClientGatewayPrefs),
    setActiveClientGateway: (id: string) =>
      ipcRenderer.invoke(IpcChannels.setActiveClientGateway, id),
    upsertClientGateway: (entry: unknown) =>
      ipcRenderer.invoke(IpcChannels.upsertClientGateway, entry),
    removeClientGateway: (id: string) => ipcRenderer.invoke(IpcChannels.removeClientGateway, id),
    probeClientGateway: (payload: { baseUrl: string; token: string }) =>
      ipcRenderer.invoke(IpcChannels.probeClientGateway, payload),
    relaunchApp: () => ipcRenderer.invoke(IpcChannels.relaunchApp),
    getClientSettings: () => ipcRenderer.invoke(IpcChannels.getClientSettings),
    saveClientSettings: (settings: unknown) =>
      ipcRenderer.invoke(IpcChannels.saveClientSettings, settings),
    // Local host only: both tokens from ~/.okbot/server.json (HTTP gateway-token echoes one role).
    ...(localHost
      ? {
          getGatewayAccessToken: () =>
            ipcRenderer.invoke(IpcChannels.getGatewayAccessToken) as Promise<string>,
          getGatewayAdminToken: () =>
            ipcRenderer.invoke(IpcChannels.getGatewayAdminToken) as Promise<string>,
          getGatewayApiTokens: () =>
            ipcRenderer.invoke(IpcChannels.getGatewayApiTokens) as Promise<
              import('@okbot/shared').GatewayApiTokenEntry[]
            >,
          saveLocalGatewayHttpApi: (patch: unknown) =>
            ipcRenderer.invoke(IpcChannels.saveLocalGatewayHttpApi, patch) as Promise<GatewayHttpApiSettings>,
        }
      : {}),
    applyWindowTranslucent: (translucent: boolean) =>
      ipcRenderer.invoke(IpcChannels.applyWindowTranslucent, translucent),
    onNativeThemeUpdated: (handler: () => void): (() => void) => {
      const listener = () => handler();
      ipcRenderer.on(IpcChannels.nativeThemeUpdated, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.nativeThemeUpdated, listener);
      };
    },
    // Local app auto-update (client chrome) — same IPC as the full preload.
    updaterGetStatus: () =>
      ipcRenderer.invoke(IpcChannels.updaterGetStatus) as Promise<UpdaterStatus>,
    updaterCheck: () => ipcRenderer.invoke(IpcChannels.updaterCheck) as Promise<UpdaterStatus>,
    updaterDownload: () =>
      ipcRenderer.invoke(IpcChannels.updaterDownload) as Promise<UpdaterStatus>,
    updaterInstall: () => ipcRenderer.invoke(IpcChannels.updaterInstall) as Promise<void>,
    updaterGetChangelogHistory: (lang?: 'zh' | 'en') =>
      ipcRenderer.invoke(IpcChannels.updaterGetChangelogHistory, lang) as Promise<
        LocalizedChangelogNotes[]
      >,
    updaterGetWhatsNew: (lang?: 'zh' | 'en') =>
      ipcRenderer.invoke(IpcChannels.updaterGetWhatsNew, lang) as Promise<LocalizedChangelogNotes | null>,
    updaterMarkWhatsNewSeen: (version?: string) =>
      ipcRenderer.invoke(IpcChannels.updaterMarkWhatsNewSeen, version) as Promise<boolean>,
    updaterDismissUpdatePrompt: (version?: string) =>
      ipcRenderer.invoke(IpcChannels.updaterDismissUpdatePrompt, version) as Promise<UpdaterStatus>,
    onUpdaterEvent: (handler: (status: UpdaterStatus) => void): (() => void) => {
      const listener = (_: unknown, status: UpdaterStatus) => handler(status);
      ipcRenderer.on(IpcChannels.updaterEvent, listener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.updaterEvent, listener);
      };
    },
  });
}
