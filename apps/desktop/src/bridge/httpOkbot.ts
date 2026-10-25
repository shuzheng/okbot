/**
 * Browser/gateway adapter: when Electron preload is absent, provide window.okbot
 * over the desktop LAN HTTP API (REST + SSE). Same UI codebase.
 */

import {
  buildChatStartBody,
  gatewayTokenPrefixRole,
  mergeClientGatewaySettings,
  normalizeUsageStats,
  pickClientSettings,
  stripClientSettingsKeys,
  TOOL_IDS,
  type AppSettings,
  type ChatStartOpts,
  type ClientSettings,
} from '@okbot/shared';
import {
  loadBrowserClientSettings,
  saveBrowserClientSettings,
} from '../utils/browserClientSettings';
import { pickBrowserFiles } from '../utils/browserPickFiles';


type Json = Record<string, unknown>;

type AttachConfig = { base?: string; token?: string; platform?: string };

type ClientGatewayEntryDto = {
  id: string;
  label: string;
  kind: 'local' | 'remote';
  baseUrl?: string;
  token?: string;
};

type ClientGatewayPrefsDto = {
  activeId: string;
  gateways: ClientGatewayEntryDto[];
};

const BROWSER_CLIENT_GATEWAY_PREFS: ClientGatewayPrefsDto = {
  activeId: 'local',
  gateways: [{ id: 'local', label: 'Local', kind: 'local' }],
};

type AttachWindowFns = {
  windowMinimize?: () => Promise<boolean>;
  windowMaximizeToggle?: () => Promise<boolean>;
  windowClose?: () => Promise<boolean>;
  windowIsMaximized?: () => Promise<boolean>;
  windowFocus?: () => Promise<boolean>;
  setBadgeCount?: (count: number) => Promise<boolean>;
  onWindowMaximizedChanged?: (cb: (maximized: boolean) => void) => () => void;
  /** Desktop tray / main-process shell navigation (attach preload). */
  onShellNavigate?: (cb: (payload: unknown) => void) => () => void;
  /** Electron attach preload: resolve absolute path for a dropped File. */
  getPathForFile?: (file: File) => string;
  getClientGatewayPrefs?: () => Promise<ClientGatewayPrefsDto>;
  setActiveClientGateway?: (id: string) => Promise<ClientGatewayPrefsDto>;
  upsertClientGateway?: (entry: ClientGatewayEntryDto) => Promise<ClientGatewayPrefsDto>;
  removeClientGateway?: (id: string) => Promise<ClientGatewayPrefsDto>;
  probeClientGateway?: (
    payload: { baseUrl: string; token: string },
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  relaunchApp?: () => Promise<boolean>;
  getClientSettings?: () => Promise<ClientSettings>;
  saveClientSettings?: (settings: ClientSettings) => Promise<ClientSettings>;
  /** Local-host attach: both tokens from disk via main IPC (not HTTP echo). */
  getGatewayAccessToken?: () => Promise<string>;
  getGatewayAdminToken?: () => Promise<string>;
  saveLocalGatewayHttpApi?: (patch: unknown) => Promise<{
    enabled: boolean;
    port: number;
    token: string;
    adminToken?: string;
    bindLan: boolean;
    serveUi: boolean;
  }>;
  applyWindowTranslucent?: (translucent: boolean) => Promise<boolean>;
  onNativeThemeUpdated?: (handler: () => void) => () => void;
  switchClientGateway?: (id: string) => Promise<{
    mode: 'hot' | 'relaunch';
    prefs: ClientGatewayPrefsDto;
    previousActiveId: string;
    base?: string;
    token?: string;
  }>;
  getAttachConfig?: () => { base: string; token: string; platform?: string };
  setAttachTarget?: (next: { base: string; token: string }) => boolean;
  updaterGetStatus?: () => Promise<unknown>;
  updaterCheck?: () => Promise<unknown>;
  updaterDownload?: () => Promise<unknown>;
  updaterInstall?: () => Promise<void>;
  updaterGetChangelogHistory?: (lang?: 'zh' | 'en') => Promise<unknown[]>;
  updaterGetWhatsNew?: (lang?: 'zh' | 'en') => Promise<unknown>;
  updaterMarkWhatsNewSeen?: (version?: string) => Promise<boolean>;
  updaterDismissUpdatePrompt?: (version?: string) => Promise<unknown>;
  onUpdaterEvent?: (handler: (status: unknown) => void) => () => void;
};

type AttachRaw = AttachConfig & AttachWindowFns;

function attachRaw(): AttachRaw | null {
  const raw = (globalThis as { __okbotAttach?: AttachRaw }).__okbotAttach;
  if (!raw || typeof raw.base !== 'string' || !raw.base.trim()) return null;
  return raw;
}

/** Set by the Electron preload when this window is only a client of an existing server. */
function attachConfig(): AttachConfig | null {
  const raw = attachRaw();
  if (!raw) return null;
  const live = typeof raw.getAttachConfig === 'function' ? raw.getAttachConfig() : null;
  const baseRaw = (live?.base || raw.base) as string | undefined;
  if (typeof baseRaw !== 'string' || !baseRaw.trim()) return null;
  const tokenRaw = live?.token ?? raw.token;
  const platformRaw = live?.platform ?? raw.platform;
  return {
    base: baseRaw.replace(/\/+$/, ''),
    token: typeof tokenRaw === 'string' ? tokenRaw : '',
    platform: typeof platformRaw === 'string' ? platformRaw : undefined,
  };
}

async function callAttachWindow(
  name: 'windowMinimize' | 'windowMaximizeToggle' | 'windowClose' | 'windowIsMaximized' | 'windowFocus',
): Promise<boolean> {
  const fn = attachRaw()?.[name];
  if (typeof fn !== 'function') return false;
  try {
    return Boolean(await fn());
  } catch {
    return false;
  }
}

function endpoint(path: string): string {
  const base = attachConfig()?.base;
  if (!base) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return base + (path.startsWith('/') ? path : `/${path}`);
}

function gatewayToken(): string {
  // Attach preload only. Browser login uses an HttpOnly cookie (credentials: include).
  // Never read ?token= or sessionStorage — those leave the secret in the address bar / storage.
  return attachConfig()?.token?.trim() || '';
}

async function readClientChrome(): Promise<ClientSettings> {
  const fn = attachRaw()?.getClientSettings;
  if (typeof fn === 'function') {
    try {
      return pickClientSettings(await fn());
    } catch {
      /* fall through */
    }
  }
  return loadBrowserClientSettings();
}

async function writeClientChrome(settings: ClientSettings): Promise<ClientSettings> {
  const next = pickClientSettings(settings);
  const fn = attachRaw()?.saveClientSettings;
  if (typeof fn === 'function') {
    try {
      return pickClientSettings(await fn(next));
    } catch {
      /* fall through */
    }
  }
  return saveBrowserClientSettings(next);
}

async function overlayClientChrome<T extends Record<string, unknown>>(gatewaySettings: T): Promise<T & AppSettings> {
  const client = await readClientChrome();
  return mergeClientGatewaySettings(gatewaySettings as unknown as AppSettings, client) as T & AppSettings;
}


async function api<T = Json>(
  method: string,
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const token = gatewayToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(endpoint(path), {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text.trim() ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Gateway non-JSON (${res.status}): ${text.slice(0, 160)}`);
  }
  if (!res.ok) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return json as T;
}

/** Entity ops share one authenticated route: POST /v1/rpc/:op (see electron/gatewayRpc.ts). */
async function rpc<T = any>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const json = await api<{ ok?: boolean; result?: T }>('POST', `/v1/rpc/${encodeURIComponent(op)}`, args);
  return json?.result as T;
}

const runtimeListeners = new Set<(event: any) => void>();
let sessionEventsStarted = false;
let sessionEventsAbort: AbortController | null = null;


function durableGatewayEventsActive(): boolean {
  if (sessionEventsStarted) return true;
  try {
    return !!(window as unknown as { __okbotGatewayEvents?: boolean }).__okbotGatewayEvents;
  } catch {
    return false;
  }
}

/** Long-lived SSE: roster/settings + turn events so attach mirrors owner IPC fan-out. */
function startGatewaySessionEvents(): void {
  if (sessionEventsStarted) return;
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  // gateway-boot.js already pumps /v1/events and fans out via wrapped onRuntimeEvent /
  // onSettingsChanged — avoid a second SSE on the same page.
  if ((window as unknown as { __okbotGatewayEvents?: boolean }).__okbotGatewayEvents) return;
  sessionEventsStarted = true;
  let stopped = false;
  const pump = async () => {
    let delay = 300;
    while (!stopped) {
      let streamEndedClean = false;
      try {
        sessionEventsAbort?.abort();
        sessionEventsAbort = new AbortController();
        const token = gatewayToken();
        const res = await fetch(endpoint('/v1/events'), {
          credentials: 'include',
          signal: sessionEventsAbort.signal,
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok || !res.body) {
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(Math.max(delay, 300) * 2, 10_000);
          continue;
        }
        delay = 300;
        // Catch up after listen/rebind gaps (bindLan / port / token restart).
        void notifySettingsChangedFromGateway();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) {
            streamEndedClean = true;
            break;
          }
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() || '';
          for (const block of parts) {
            let data = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (!data) continue;
            try {
              const event = JSON.parse(data);
              if (!event || typeof event.type !== 'string') continue;
              for (const listener of [...runtimeListeners]) {
                try {
                  listener(event);
                } catch (err) {
                  console.error('[okbot] gateway events listener failed', err);
                }
              }
              if (event.type === 'settings_changed') {
                void notifySettingsChangedFromGateway();
              }
            } catch {
              /* ignore malformed */
            }
          }
        }
      } catch {
        /* reconnect after abort / incomplete chunk / offline */
      }
      if (!stopped) {
        const wait = delay;
        if (!streamEndedClean) delay = Math.min(Math.max(delay, 300) * 2, 10_000);
        else delay = 300;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  };
  void pump();
  window.addEventListener('pagehide', () => {
    stopped = true;
  });
}

/** Abort the current SSE so the pump reconnects with the new attach base/token. */
function reconnectGatewaySessionEvents(): void {
  try {
    sessionEventsAbort?.abort();
  } catch {
    /* ignore */
  }
  if (!sessionEventsStarted) {
    startGatewaySessionEvents();
  }
}

function dispatchGatewayReconnected(): void {
  try {
    window.dispatchEvent(new CustomEvent('okbot:gateway-reconnected'));
  } catch {
    /* ignore */
  }
}


const settingsChangedListeners = new Set<(settings: any) => void>();
let settingsNotifySeq = 0;

/** Refetch merged settings (gateway + local client chrome) and fan out. */
async function notifySettingsChangedFromGateway(): Promise<void> {
  const ticket = ++settingsNotifySeq;
  try {
    const bridge = (window as unknown as { okbot?: { getSettings?: () => Promise<unknown> } }).okbot;
    if (typeof bridge?.getSettings !== 'function') return;
    const latest = await bridge.getSettings();
    if (ticket !== settingsNotifySeq || !latest) return;
    for (const listener of [...settingsChangedListeners]) {
      try {
        listener(latest);
      } catch (err) {
        console.error('[okbot] onSettingsChanged listener failed', err);
      }
    }
  } catch (err) {
    console.error('[okbot] settings_changed refetch failed', err);
  }
}

const GATEWAY_TOOL_IDS = TOOL_IDS;

/** SettingsModal maps `tools[id].enabled`. An empty tools object is truthy and crashes. */
export function fillGatewayTools(tools: unknown): Record<string, { enabled: boolean; approval: 'allow' | 'ask' }> {
  const src = tools && typeof tools === 'object' ? (tools as Record<string, any>) : {};
  const out: Record<string, { enabled: boolean; approval: 'allow' | 'ask' }> = {};
  for (const id of GATEWAY_TOOL_IDS) {
    const item = src[id];
    const ok = !!item && typeof item === 'object';
    out[id] = {
      enabled: !ok || item.enabled !== false,
      approval: ok && item.approval === 'allow' ? 'allow' : 'ask',
    };
  }
  return out;
}

/** ModelProvidersPanel maps `model.enabled`. */
export function fillGatewayModel(model: unknown) {
  const m = model && typeof model === 'object' ? (model as Record<string, any>) : {};
  const providers = Array.isArray(m.providers) ? m.providers : [];
  return {
    providers: providers.map((p: any) => {
      const models = Array.isArray(p?.models) ? p.models : [];
      return {
        id: p?.id || '',
        name: p?.name || '',
        baseURL: p?.baseURL || '',
        apiKey: typeof p?.apiKey === 'string' ? p.apiKey : '',
        apiFormat: p?.apiFormat || 'chat_completions',
        models: models.map((x: any) => ({
          id: x?.id || '',
          name: x?.name || x?.id || '',
          contextWindow: x?.contextWindow,
          maxTokens: x?.maxTokens,
          enabled: x?.enabled !== false,
          ...(x?.showThinking === true ? { showThinking: true as const } : {}),
        })),
      };
    }),
    defaultProviderId: m.defaultProviderId || '',
    defaultModelId: m.defaultModelId || '',
  };
}

/** SessionSidebar maps `squad.members`. */
export function fillGatewaySquad<T extends Record<string, any>>(squad: T) {
  const members = Array.isArray(squad?.members) ? squad.members : [];
  return {
    ...squad,
    id: squad?.id || '',
    name: typeof squad?.name === 'string' ? squad.name : '',
    members: members.map((m: any) => ({
      botId: m?.botId || '',
    })),
  };
}

export function fillGatewaySettings(settings: unknown) {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, any>) : {};
  const security = s.security && typeof s.security === 'object' ? s.security : {};
  const local = s.gatewayHttpApi && typeof s.gatewayHttpApi === 'object' ? s.gatewayHttpApi : {};
  return {
    ...s,
    theme: s.theme || 'system',
    language: s.language || 'system',
    computers: Array.isArray(s.computers) ? s.computers : [],
    defaultComputerId: typeof s.defaultComputerId === 'string' && s.defaultComputerId.trim()
      ? s.defaultComputerId.trim()
      : 'local',
    tools: fillGatewayTools(s.tools),
    security: {
      enabled: security.enabled !== false,
      restrictToHome: security.restrictToHome === true,
      allowedPathPrefixes: Array.isArray(security.allowedPathPrefixes) ? security.allowedPathPrefixes : [],
      deniedPathPrefixes: Array.isArray(security.deniedPathPrefixes) ? security.deniedPathPrefixes : [],
      shellPatternsEnabled: security.shellPatternsEnabled !== false,
      ...(Array.isArray(security.shellPatterns) ? { shellPatterns: security.shellPatterns } : {}),
      blockMode: security.blockMode === 'tripwire' ? 'tripwire' : 'reject',
    },
    model: fillGatewayModel(s.model),
    autoApprovalEnabled: s.autoApprovalEnabled === true,
    autoApprovalRules: Array.isArray(s.autoApprovalRules) ? s.autoApprovalRules : [],
    notifications: s.notifications !== false,
    developerMode: s.developerMode === true,
    mcp: s.mcp && typeof s.mcp === 'object'
      ? { enabled: s.mcp.enabled === true, servers: Array.isArray(s.mcp.servers) ? s.mcp.servers : [] }
      : { enabled: false, servers: [] },
    microphoneId: typeof s.microphoneId === 'string' ? s.microphoneId : '',
    gatewayHttpApi: {
      enabled: true,
      port: typeof local.port === 'number' ? local.port : 18765,
      token: typeof local.token === 'string' ? local.token : '',
      adminToken: typeof local.adminToken === 'string' ? local.adminToken : '',
      apiTokens: Array.isArray(local.apiTokens) ? local.apiTokens : [],
      bindLan: local.bindLan === true,
      serveUi: local.serveUi === true,
    },
    contextCompression:
      s.contextCompression && typeof s.contextCompression === 'object' ? s.contextCompression : {},
    instructions: s.instructions && typeof s.instructions === 'object' ? s.instructions : {},
    memory: s.memory && typeof s.memory === 'object' ? s.memory : {},
    squad: s.squad && typeof s.squad === 'object' ? s.squad : {},
    mesh: s.mesh && typeof s.mesh === 'object' ? s.mesh : {},
  };
}

/** Prefer local-host attach IPC (both tokens from server.json); else HTTP echo of presented role. */
async function readAttachDiskGatewayTokens(): Promise<{
  token: string;
  adminToken: string;
  apiTokens?: unknown[];
} | null> {
  const raw = attachRaw() as {
    getGatewayAccessToken?: () => Promise<string>;
    getGatewayAdminToken?: () => Promise<string>;
    getGatewayApiTokens?: () => Promise<unknown[]>;
  } | null;
  if (!raw) return null;
  const readAccess = raw.getGatewayAccessToken;
  const readAdmin = raw.getGatewayAdminToken;
  const readList = raw.getGatewayApiTokens;
  if (typeof readAccess !== 'function' && typeof readAdmin !== 'function' && typeof readList !== 'function') {
    return null;
  }
  try {
    const [access, admin, list] = await Promise.all([
      typeof readAccess === 'function' ? readAccess() : Promise.resolve(''),
      typeof readAdmin === 'function' ? readAdmin() : Promise.resolve(''),
      typeof readList === 'function' ? readList() : Promise.resolve([]),
    ]);
    return {
      token: typeof access === 'string' ? access : '',
      adminToken: typeof admin === 'string' ? admin : '',
      apiTokens: Array.isArray(list) ? list : [],
    };
  } catch {
    return null;
  }
}

/** Fill gatewayHttpApi token fields. Bootstrap blanks them on the wire. */
async function withLiveGatewayToken<T extends { gatewayHttpApi?: { token?: string; adminToken?: string; apiTokens?: unknown } }>(
  settings: T,
): Promise<T> {
  const local = settings.gatewayHttpApi && typeof settings.gatewayHttpApi === 'object' ? settings.gatewayHttpApi : {};
  const disk = await readAttachDiskGatewayTokens();
  if (disk && (disk.token || disk.adminToken || (disk.apiTokens && disk.apiTokens.length))) {
    return {
      ...settings,
      gatewayHttpApi: {
        ...local,
        ...(disk.token ? { token: disk.token } : {}),
        ...(disk.adminToken ? { adminToken: disk.adminToken } : {}),
        ...(disk.apiTokens && disk.apiTokens.length ? { apiTokens: disk.apiTokens } : {}),
      },
    };
  }
  try {
    const json = await api<{ token?: unknown; role?: unknown }>('GET', '/v1/gateway-token');
    const token = typeof json?.token === 'string' ? json.token : '';
    if (!token) return settings;
    const role = json?.role === 'admin' ? 'admin' : 'access';
    if (role === 'admin') {
      return { ...settings, gatewayHttpApi: { ...local, adminToken: token } };
    }
    return { ...settings, gatewayHttpApi: { ...local, token } };
  } catch {
    return settings;
  }
}

export function createHttpOkbotBridge(): Record<string, (...args: any[]) => unknown> {
  const okbot: any = {
    getBootstrap: async () => {
      const b = await api<any>('GET', '/v1/bootstrap');
      const runs = b?.activeRuns && typeof b.activeRuns === 'object' ? b.activeRuns : {};
      const busy = Array.isArray(b?.busyBotIds)
        ? b.busyBotIds
        : Array.isArray(runs.busyBotIds)
          ? runs.busyBotIds
          : [];
      const pending = Array.isArray(b?.pendingToolRequests)
        ? b.pendingToolRequests
        : Array.isArray(runs.pendingToolRequests)
          ? runs.pendingToolRequests
          : [];
      const squads = Array.isArray(b?.squads) ? b.squads : [];
      const settings = await overlayClientChrome(
        await withLiveGatewayToken(fillGatewaySettings(b?.settings)),
      );
      return {
        bots: Array.isArray(b?.bots) ? b.bots : [],
        squads: squads.map(fillGatewaySquad),
        dataDir: b?.dataDir || '',
        hardwareAccelerationActive: b?.hardwareAccelerationActive !== false,
        settings,
        busyBotIds: busy,
        pendingToolRequests: pending,
        activeRuns: { busyBotIds: busy, pendingToolRequests: pending },
      };
    },
    listBots: async () => (await api<any>('GET', '/v1/bots')).bots || [],
    listSquads: async () => {
      const squads = (await api<any>('GET', '/v1/squads')).squads || [];
      return (Array.isArray(squads) ? squads : []).map(fillGatewaySquad);
    },
    getSettings: async () => (await okbot.getBootstrap()).settings,
    /** Live access/user token. Local-host attach reads disk; HTTP admin echo stays blank by design. */
    getGatewayAccessToken: async () => {
      const disk = await readAttachDiskGatewayTokens();
      if (disk) return disk.token;
      const json = await api<{ token?: unknown; role?: unknown }>('GET', '/v1/gateway-token');
      if (json?.role === 'admin') return '';
      return typeof json?.token === 'string' ? json.token : '';
    },
    getGatewayAdminToken: async () => {
      const disk = await readAttachDiskGatewayTokens();
      if (disk) return disk.adminToken;
      const json = await api<{ token?: unknown; role?: unknown }>('GET', '/v1/gateway-token');
      if (json?.role !== 'admin') return '';
      return typeof json?.token === 'string' ? json.token : '';
    },
    /** Token list for settings UI. Prefer local-host attach IPC (full secrets); else bootstrap (redacted). */
    getGatewayApiTokens: async () => {
      const disk = await readAttachDiskGatewayTokens();
      if (disk && Array.isArray(disk.apiTokens) && disk.apiTokens.length) return disk.apiTokens;
      try {
        const b = await api<{ settings?: { gatewayHttpApi?: { apiTokens?: unknown } } }>('GET', '/v1/bootstrap');
        const list = b?.settings?.gatewayHttpApi?.apiTokens;
        return Array.isArray(list) ? list : [];
      } catch {
        return [];
      }
    },
    /**
     * Role of the credential this client is actually presenting (Bearer / cookie).
     * Local-host attach can read both tokens from disk for the settings form — that
     * must not imply the window is admin if the presented Bearer is user_/access.
     */
    getGatewayAuthRole: async () => {
      const presented = gatewayToken();
      const disk = await readAttachDiskGatewayTokens();
      if (disk) {
        const prefix = gatewayTokenPrefixRole(presented);
        if (prefix) return prefix;
        if (presented && presented === disk.adminToken) return 'admin';
        if (presented && presented === disk.token) return 'access';
        return null;
      }
      try {
        const json = await api<{ role?: unknown }>('GET', '/v1/gateway-token');
        if (json?.role === 'admin' || json?.role === 'access') return json.role;
      } catch {
        /* prefix fallback */
      }
      return gatewayTokenPrefixRole(presented);
    },
    saveSettings: async (settings: unknown) => {
      const bag =
        settings && typeof settings === 'object' && !Array.isArray(settings)
          ? (settings as Record<string, unknown>)
          : {};
      const client = await writeClientChrome(pickClientSettings(bag));
      const gatewayPatch = stripClientSettingsKeys(bag) as Record<string, unknown>;
      const localSave = attachRaw()?.saveLocalGatewayHttpApi;
      let localGatewayHttpApi: Record<string, unknown> | null = null;
      if (typeof localSave === 'function' && gatewayPatch.gatewayHttpApi != null) {
        // Local-host attach: persist listen/token via owner IPC (avoids restarting the
        // HTTP server mid-response). Remote admin still POSTs gatewayHttpApi over HTTP.
        try {
          const savedApi = await localSave(gatewayPatch.gatewayHttpApi);
          localGatewayHttpApi =
            savedApi && typeof savedApi === 'object'
              ? (savedApi as unknown as Record<string, unknown>)
              : null;
          // Local attach prefers admin Authorization (same as probe prefer:admin).
          const cfg = attachConfig();
          const nextAdmin =
            typeof localGatewayHttpApi?.adminToken === 'string'
              ? localGatewayHttpApi.adminToken.trim()
              : '';
          const nextAccess =
            typeof localGatewayHttpApi?.token === 'string' ? localGatewayHttpApi.token.trim() : '';
          const nextPresented = nextAdmin || nextAccess;
          const base = typeof cfg?.base === 'string' ? cfg.base.trim() : '';
          if (base && nextPresented && nextPresented !== (cfg?.token || '').trim()) {
            attachRaw()?.setAttachTarget?.({ base, token: nextPresented });
          }
          delete gatewayPatch.gatewayHttpApi;
        } catch (err) {
          // Fall through to HTTP admin POST /v1/settings (access token → 403).
          console.error('[okbot] saveLocalGatewayHttpApi failed', err);
        }
      }

      const mergeGateway = async (raw: unknown): Promise<AppSettings> => {
        let gateway = await withLiveGatewayToken(fillGatewaySettings(raw));
        if (localGatewayHttpApi) {
          gateway = fillGatewaySettings({
            ...gateway,
            gatewayHttpApi: {
              ...(gateway.gatewayHttpApi && typeof gateway.gatewayHttpApi === 'object'
                ? gateway.gatewayHttpApi
                : {}),
              ...localGatewayHttpApi,
            },
          });
        }
        return mergeClientGatewaySettings(gateway as AppSettings, client);
      };

      // Access/user token cannot POST /v1/settings (admin_required). Settings autosave still
      // sends a full hybrid payload; skip the gateway write and keep client chrome only.
      // Avoids forbidden toasts when 网关端 is hidden for remote user clients.
      const presentedRole = gatewayTokenPrefixRole(gatewayToken());
      if (presentedRole === 'access') {
        return mergeGateway(gatewayPatch);
      }

      try {
        const json = await api<any>('POST', '/v1/settings', gatewayPatch);
        return mergeGateway(json?.settings ?? json);
      } catch (err) {
        const msg = err instanceof Error ? err.message.trim() : String(err);
        if (msg === 'forbidden' || msg.includes('admin_required')) {
          // Legacy unprefixed access tokens, or race before role resolves: client chrome
          // already saved — return UI hybrid without toasting.
          return mergeGateway(gatewayPatch);
        }
        throw err;
      }
    },
    applyWindowTranslucent: async (translucent: boolean) => {
      const fn = attachRaw()?.applyWindowTranslucent;
      if (typeof fn === 'function') {
        try {
          return Boolean(await fn(translucent));
        } catch {
          return false;
        }
      }
      // Pure browser WebUI: CSS data-translucent only (no native vibrancy).
      return true;
    },
    getMessagesPage: async (ownerId: string, opts?: { limit?: number; beforeMessageId?: string }) => {
      // Try bot path first; gateway accepts both bots and squads via same handler when we pass bots
      const q = new URLSearchParams();
      if (opts?.limit) q.set('limit', String(opts.limit));
      if (opts?.beforeMessageId) q.set('beforeMessageId', opts.beforeMessageId);
      // Prefer bots route; if 404, try squads
      try {
        return await api('GET', `/v1/bots/${encodeURIComponent(ownerId)}/messages?${q}`);
      } catch {
        return await api('GET', `/v1/squads/${encodeURIComponent(ownerId)}/messages?${q}`);
      }
    },
    getTasks: async (ownerId: string) => {
      const id = (ownerId || '').trim();
      if (!id) return [];
      try {
        const res = await api<any>('GET', `/v1/bots/${encodeURIComponent(id)}/tasks`);
        if (Array.isArray(res)) return res;
        if (res && Array.isArray(res.tasks)) return res.tasks;
      } catch {
        try {
          const res = await api<any>('GET', `/v1/squads/${encodeURIComponent(id)}/tasks`);
          if (Array.isArray(res)) return res;
          if (res && Array.isArray(res.tasks)) return res.tasks;
        } catch {
          /* endpoint optional — UI stays empty */
        }
      }
      return [];
    },
    listOwnerTasks: async (ownerId: string) => {
      const id = (ownerId || '').trim();
      if (!id) return [];
      try {
        const res = await api<any>('GET', `/v1/bots/${encodeURIComponent(id)}/tasks?all=1`);
        if (Array.isArray(res)) return res;
        if (res && Array.isArray(res.tasks)) return res.tasks;
      } catch {
        try {
          const res = await api<any>('GET', `/v1/squads/${encodeURIComponent(id)}/tasks?all=1`);
          if (Array.isArray(res)) return res;
          if (res && Array.isArray(res.tasks)) return res.tasks;
        } catch {
          /* optional */
        }
      }
      return [];
    },
    listOwnerResources: async (ownerId: string) => {
      const id = (ownerId || '').trim();
      if (!id) return [];
      try {
        const res = await api<any>('GET', `/v1/bots/${encodeURIComponent(id)}/resources`);
        if (Array.isArray(res)) return res;
        if (res && Array.isArray(res.resources)) return res.resources;
      } catch {
        try {
          const res = await api<any>('GET', `/v1/squads/${encodeURIComponent(id)}/resources`);
          if (Array.isArray(res)) return res;
          if (res && Array.isArray(res.resources)) return res.resources;
        } catch {
          /* optional */
        }
      }
      return [];
    },
    getMessages: async (botId: string, opts?: { limit?: number }) => {
      const raw = opts?.limit;
      const limit =
        typeof raw === 'number' && Number.isFinite(raw) && raw > 0
          ? Math.min(200, Math.max(1, Math.floor(raw)))
          : 50;
      const page = await okbot.getMessagesPage(botId, { limit });
      return page.messages || [];
    },
    chatStart: async (botId: string, text: string, opts?: ChatStartOpts) => {
      const token = gatewayToken();
      const res = await fetch(endpoint(`/v1/bots/${encodeURIComponent(botId)}/messages`), {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(buildChatStartBody(text, opts)),
      });
      if (!res.ok || !res.body) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';
        for (const block of parts) {
          const lines = block.split('\n');
          let data = '';
          for (const line of lines) {
            if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          try {
            const event = JSON.parse(data);
            // Durable /v1/events already fans turn events; skip to avoid double deltas.
            if (!durableGatewayEventsActive()) {
              for (const l of runtimeListeners) l(event);
            }
          } catch {
            /* ignore */
          }
        }
      }
      return { ok: true };
    },
    chatStartSquad: async (squadId: string, text: string, opts?: ChatStartOpts) => {
      const token = gatewayToken();
      const res = await fetch(endpoint(`/v1/squads/${encodeURIComponent(squadId)}/messages`), {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(buildChatStartBody(text, opts)),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';
        for (const block of parts) {
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          try {
            const event = JSON.parse(data);
            // Durable /v1/events already fans turn events; skip to avoid double deltas.
            if (!durableGatewayEventsActive()) {
              for (const l of runtimeListeners) l(event);
            }
          } catch {
            /* ignore */
          }
        }
      }
      return { ok: true };
    },
    chatAbort: async (ownerId?: string) => {
      const id = (ownerId || '').trim();
      if (!id) return { ok: false as const, error: 'missing_id' };
      try {
        return await api<{ ok: boolean }>('POST', `/v1/bots/${encodeURIComponent(id)}/abort`);
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (message !== 'bot_not_found') {
          return { ok: false as const, error: message || 'abort_failed' };
        }
      }
      try {
        return await api<{ ok: boolean }>('POST', `/v1/squads/${encodeURIComponent(id)}/abort`);
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : 'abort_failed' };
      }
    },
    onRuntimeEvent: (cb: (e: any) => void) => {
      runtimeListeners.add(cb);
      return () => runtimeListeners.delete(cb);
    },
    // Legacy renderer bundles subscribe with onChatEvent. Same SSE fan-out as onRuntimeEvent.
    onChatEvent: (cb: (e: any) => void) => {
      runtimeListeners.add(cb);
      return () => runtimeListeners.delete(cb);
    },
    /** Desktop tray / hotkey navigation — attach preload IPC; no-op on pure gateway web. */
    onShellNavigate: (cb: (payload: unknown) => void) => {
      const fn = attachRaw()?.onShellNavigate;
      if (typeof fn !== 'function') return () => {};
      return fn(cb);
    },
    copyText: async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    },
    getAppInfo: async () => {
      const fallbackPlatform = attachConfig()?.platform || 'web';
      try {
        const info = await api<{
          name?: string;
          version?: string;
          platform?: string;
          arch?: string;
        }>('GET', '/v1/app-info');
        return {
          name: info?.name?.trim() || 'OkBot',
          version: info?.version?.trim() || '0.0.0',
          platform: info?.platform?.trim() || fallbackPlatform,
          arch: info?.arch?.trim() || '',
          electron: '',
          chrome: '',
          buildDate: '',
        };
      } catch {
        return {
          name: 'OkBot',
          version: '0.0.0',
          platform: fallbackPlatform,
          arch: '',
          electron: '',
          chrome: '',
          buildDate: '',
        };
      }
    },
    setTrafficLightPosition: async () => false,
    probeComputer: async () => ({ ok: false as const, error: 'unreachable' }),
    toolRespond: async (payload?: { requestId?: string; approved?: boolean; message?: string }) => {
      try {
        return await api<{ ok: boolean; error?: string }>('POST', '/v1/tool-respond', {
          requestId: payload?.requestId,
          approved: payload?.approved === true,
          message: payload?.message,
        });
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : 'tool_respond_failed' };
      }
    },
    setChatUnread: (ownerId: string, hasUnread: boolean) =>
      rpc<boolean>('setChatUnread', { ownerId, hasUnread }),
    setBadgeCount: async (count: number) => {
      const fn = attachRaw()?.setBadgeCount;
      if (typeof fn !== 'function') return false;
      return Boolean(await fn(count));
    },
    updaterGetStatus: async () => {
      const fn = attachRaw()?.updaterGetStatus;
      if (typeof fn === 'function') return fn();
      const info = await okbot.getAppInfo();
      return { phase: 'idle' as const, currentVersion: info?.version || '0.0.0' };
    },
    onUpdaterEvent: (handler: (status: any) => void) => {
      const fn = attachRaw()?.onUpdaterEvent;
      if (typeof fn === 'function') return fn(handler);
      return () => {};
    },
    onSettingsChanged: (handler: (settings: any) => void) => {
      settingsChangedListeners.add(handler);
      return () => {
        settingsChangedListeners.delete(handler);
      };
    },
    windowMinimize: () => callAttachWindow('windowMinimize'),
    windowMaximizeToggle: () => callAttachWindow('windowMaximizeToggle'),
    windowClose: () => callAttachWindow('windowClose'),
    windowIsMaximized: () => callAttachWindow('windowIsMaximized'),
    // Browser tab: window.focus() is the best a page can do.
    windowFocus: async () => (attachRaw() ? callAttachWindow('windowFocus') : (window.focus(), true)),
    claimNotification: async (tag: string) => {
      const json = await api<{ granted?: unknown }>('POST', '/v1/notify-claim', { tag });
      return json.granted !== false;
    },
    onWindowMaximizedChanged: (cb: (maximized: boolean) => void) => {
      const fn = attachRaw()?.onWindowMaximizedChanged;
      if (typeof fn !== 'function') return () => {};
      try {
        return fn(cb) || (() => {});
      } catch {
        return () => {};
      }
    },
    ensureMicrophoneAccess: async () => ({ granted: false }),
    openMicrophoneSettings: async () => false,
    getUsageStats: async () => {
      const body = await api<Record<string, unknown>>('GET', '/v1/usage');
      return normalizeUsageStats(body);
    },
    getApiTokenUsage: async (tokenId: string) => {
      const id = typeof tokenId === 'string' ? tokenId.trim() : '';
      if (!id) return { ok: false as const, error: 'missing_id' };
      try {
        return await api<Record<string, unknown>>('GET', `/v1/api-tokens/${encodeURIComponent(id)}/usage`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: message };
      }
    },
    // Owner Electron uses dialog IPC. WebUI / attach: native <input type=file>
    // for image/file (blob upload). Folder stays canceled — gateway-local dirs
    // are not meaningful from a phone/browser.
    pickPaths: async (kind: 'image' | 'file' | 'folder') => {
      if (kind !== 'image' && kind !== 'file') {
        return { canceled: true as const, paths: [] as string[] };
      }
      const files = await pickBrowserFiles(kind);
      if (!files.length) {
        return { canceled: true as const, paths: [] as string[] };
      }
      return { canceled: false as const, paths: [] as string[], files };
    },
    getPathForFile: (file: File): string => {
      const fn = attachRaw()?.getPathForFile;
      if (typeof fn !== 'function') return '';
      try {
        const path = fn(file);
        return typeof path === 'string' ? path : '';
      } catch {
        return '';
      }
    },
    uploadOwnerAttachment: async (payload: {
      ownerId: string;
      name?: string;
      localPath?: string;
      dataBase64?: string;
      mime?: string;
    }) => {
      const ownerId = (payload?.ownerId || '').trim();
      if (!ownerId) return { ok: false as const, error: 'missing_owner' };
      const dataBase64 = typeof payload?.dataBase64 === 'string' ? payload.dataBase64.trim() : '';
      const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
      const mime = typeof payload?.mime === 'string' ? payload.mime.trim() : '';
      // Gateway clients cannot stream a client-local path; require bytes.
      if (!dataBase64) {
        return { ok: false as const, error: 'missing_data' };
      }
      const kindPrefix = ownerId.startsWith('squad_') ? 'squads' : 'bots';
      try {
        const res = await api<{
          ok?: boolean;
          attachment?: {
            kind: 'image' | 'file';
            path: string;
            name: string;
            size: number;
            mediaPath: string;
            assetRel: string;
          };
          error?: string;
        }>('POST', `/v1/${kindPrefix}/${encodeURIComponent(ownerId)}/uploads`, {
          name: name || 'file',
          dataBase64,
          ...(mime ? { mime } : {}),
        });
        if (!res?.ok || !res.attachment) {
          return { ok: false as const, error: res?.error || 'upload_failed' };
        }
        return { ok: true as const, attachment: res.attachment };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: msg };
      }
    },
    readGeneratedAssetDataUrl: async (assetRel: string) => {
      const rel = String(assetRel || '')
        .replace(/^okbot-asset:/i, '')
        .replace(/^\/v1\/media\//i, '')
        .replace(/^\/+/, '')
        .replace(/\\/g, '/');
      const parts = rel.split('/');
      const subdir = parts[1];
      if (
        parts.length !== 3 ||
        (subdir !== 'resources' && subdir !== 'uploads') ||
        !parts[0] ||
        !parts[2]
      ) {
        return { ok: false as const, error: 'asset must be <ownerId>/{resources|uploads}/<file>' };
      }
      if (rel.includes('..')) {
        return { ok: false as const, error: 'invalid asset path' };
      }
      const path = `/v1/media/${encodeURIComponent(parts[0])}/${subdir}/${encodeURIComponent(parts[2])}`;
      try {
        const token = gatewayToken();
        const res = await fetch(endpoint(path), {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: '*/*',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) {
          return { ok: false as const, error: `HTTP ${res.status}` };
        }
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 25 * 1024 * 1024) {
          return { ok: false as const, error: 'asset too large' };
        }
        const mime = res.headers.get('content-type') || 'image/png';
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        const dataUrl = `data:${mime.split(';')[0]};base64,${btoa(binary)}`;
        return { ok: true as const, dataUrl };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    getPromptContext: (botId: string, messageId: string) =>
      rpc('getPromptContext', { botId, messageId }),
    searchMessages: (query: string, opts?: { limit?: number }) =>
      rpc('searchMessages', { query, limit: opts?.limit }),
    listBotMemories: (botId: string) => rpc('listBotMemories', { botId }),
    listGlobalMemories: () => rpc('listGlobalMemories'),
    listScheduledJobs: () => rpc('listScheduledJobs'),
    manageScheduledJob: (payload: {
      ownerId: string;
      jobId: string;
      action: 'pause' | 'resume' | 'delete';
    }) => rpc('manageScheduledJob', payload ?? {}),
    listBotSkills: (botId: string) => rpc('listBotSkills', { botId }),
    listGlobalAgentsSkills: () => rpc('listGlobalAgentsSkills'),
    readSoulMd: (botId: string) => rpc<string>('readSoulMd', { botId }),
    createBot: (input: Record<string, unknown>) => rpc('createBot', input ?? {}),
    createSquad: (input: Record<string, unknown>) => rpc('createSquad', input ?? {}),
    updateBot: (id: string, patch: Record<string, unknown>) => rpc('updateBot', { id, patch }),
    startBotOnboarding: (botId: string) => rpc('startBotOnboarding', { botId }),
    deleteBot: (id: string) => rpc<boolean>('deleteBot', { id }),
    updateSquad: (id: string, patch: Record<string, unknown>) => rpc('updateSquad', { id, patch }),
    deleteSquad: (id: string) => rpc<boolean>('deleteSquad', { id }),
    writeSoulMd: (botId: string, content: string) => rpc<boolean>('writeSoulMd', { botId, content }),
    upsertBotMemory: (entry: Record<string, unknown>) => rpc<boolean>('upsertBotMemory', { entry }),
    deleteBotMemory: (botId: string, memoryId: string) =>
      rpc<boolean>('deleteBotMemory', { botId, memoryId }),
    upsertGlobalMemory: (entry: Record<string, unknown>) => rpc<boolean>('upsertGlobalMemory', { entry }),
    deleteGlobalMemory: (memoryId: string) => rpc<boolean>('deleteGlobalMemory', { memoryId }),
    writeBotSkill: (botId: string, skill: Record<string, unknown>) =>
      rpc<boolean>('writeBotSkill', { botId, skill }),
    deleteBotSkill: (botId: string, slug: string) => rpc<boolean>('deleteBotSkill', { botId, slug }),
    // Package files live on the gateway host; picking a path there is a desktop-only action.
    exportAssistantPackage: async () => ({ canceled: true }),
    importAssistantPackage: async () => ({ canceled: true }),
    listAssistantGallery: (lang?: string) => rpc('listAssistantGallery', { lang }),
    installGalleryAssistant: (id: string, lang?: string) => rpc('installGalleryAssistant', { id, lang }),
    importAssistantFromUrl: (url: string, opts?: { overwrite?: boolean }) =>
      rpc('importAssistantFromUrl', { url, overwrite: opts?.overwrite === true }),
    cancelImportAssistantFromUrl: () =>
      rpc<boolean>('cancelImportAssistantFromUrl', {}).catch(() => false),
    // Admin HTTP: MCP status/test and gateway-host backup/restore (access token → 403).
    mcpStatus: async () => {
      const json = await api<{ servers?: unknown }>('GET', '/v1/mcp/status');
      return Array.isArray(json?.servers) ? json.servers : [];
    },
    mcpTestServer: async (entry: unknown) => {
      return api('POST', '/v1/mcp/test', { server: entry });
    },
    backupExport: async (payload: { excludeSecrets?: boolean }) => {
      const token = gatewayToken();
      const res = await fetch(endpoint('/v1/backup/export'), {
        method: 'POST',
        headers: {
          Accept: 'application/zip, application/json',
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ excludeSecrets: payload?.excludeSecrets !== false }),
      });
      if (!res.ok) {
        let err = `HTTP ${res.status}`;
        try {
          const json = (await res.json()) as { error?: string };
          if (typeof json?.error === 'string' && json.error) err = json.error;
        } catch {
          /* ignore */
        }
        return { ok: false as const, error: err };
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = /filename="([^"]+)"/i.exec(cd);
      const filename = m?.[1] || 'okbot-backup.zip';
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      return { ok: true as const, path: filename };
    },
    backupRestore: async () => {
      const file = await new Promise<File | null>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,application/zip';
        input.style.display = 'none';
        const done = (f: File | null) => {
          input.remove();
          resolve(f);
        };
        input.addEventListener('change', () => done(input.files?.[0] ?? null));
        input.addEventListener('cancel', () => done(null));
        document.body.appendChild(input);
        input.click();
      });
      if (!file) return { canceled: true as const };
      const buf = new Uint8Array(await file.arrayBuffer());
      // Prefer raw zip body (smaller than base64 JSON).
      const token = gatewayToken();
      const res = await fetch(endpoint('/v1/backup/restore'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/zip',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: buf,
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        previousDir?: string;
      } | null;
      if (!res.ok || !json?.ok) {
        return { ok: false as const, error: json?.error || `HTTP ${res.status}` };
      }
      return { ok: true as const, previousDir: json.previousDir || '' };
    },
    discoverModels: async (payload: Record<string, unknown>) => {
      try {
        return await rpc('discoverModels', payload ?? {});
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'discover_failed' };
      }
    },
    testModelConnection: async (payload: Record<string, unknown>) => {
      try {
        return await rpc('testModelConnection', payload ?? {});
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'test_failed' };
      }
    },
    clearModelBindingsForProvider: (payload: { providerId: string; removedModelIds?: string[] }) =>
      rpc('clearModelBindingsForProvider', payload ?? {}),
    getRecentErrorLog: (limit?: number) => rpc('getRecentErrorLog', { limit }),
    updaterCheck: async () => {
      const fn = attachRaw()?.updaterCheck;
      if (typeof fn === 'function') return fn();
      return okbot.updaterGetStatus();
    },
    updaterDownload: async () => {
      const fn = attachRaw()?.updaterDownload;
      if (typeof fn === 'function') return fn();
      return okbot.updaterGetStatus();
    },
    updaterInstall: async () => {
      const fn = attachRaw()?.updaterInstall;
      if (typeof fn === 'function') return fn();
    },
    // Electron attach: real desktop updater via preload. Pure WebUI: no-op stubs.
    updaterGetChangelogHistory: async (lang?: 'zh' | 'en') => {
      const fn = attachRaw()?.updaterGetChangelogHistory;
      if (typeof fn === 'function') return fn(lang);
      return [];
    },
    updaterGetWhatsNew: async (lang?: 'zh' | 'en') => {
      const fn = attachRaw()?.updaterGetWhatsNew;
      if (typeof fn === 'function') return fn(lang);
      return null;
    },
    updaterMarkWhatsNewSeen: async (version?: string) => {
      const fn = attachRaw()?.updaterMarkWhatsNewSeen;
      if (typeof fn === 'function') return fn(version);
      return true;
    },
    updaterDismissUpdatePrompt: async (version?: string) => {
      const fn = attachRaw()?.updaterDismissUpdatePrompt;
      if (typeof fn === 'function') return fn(version);
      return okbot.updaterGetStatus();
    },
    compressSessionNow: async (payload: Record<string, unknown>) => {
      try {
        return await rpc('compressSessionNow', payload ?? {});
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'compress_failed' };
      }
    },
    getClientGatewayPrefs: async () => {
      const fn = attachRaw()?.getClientGatewayPrefs;
      if (typeof fn !== 'function') return BROWSER_CLIENT_GATEWAY_PREFS;
      return fn();
    },
    setActiveClientGateway: async (id: string) => {
      const fn = attachRaw()?.setActiveClientGateway;
      if (typeof fn !== 'function') return BROWSER_CLIENT_GATEWAY_PREFS;
      return fn(id);
    },
    switchClientGateway: async (id: string) => {
      // Only the Electron attach preload can hot-switch. Do not fall back to
      // window.okbot.switchClientGateway (this method) — that recurses and used
      // to surface a fake relaunch result to the settings UI.
      const raw = attachRaw();
      const switchFn = raw?.switchClientGateway;
      if (typeof switchFn !== 'function') {
        throw new Error('switch_client_gateway_unavailable');
      }
      const result = await switchFn(id);
      if (result.mode === 'hot' && result.base) {
        const setTarget = raw?.setAttachTarget;
        if (typeof setTarget === 'function') {
          setTarget({ base: result.base, token: result.token || '' });
        }
        reconnectGatewaySessionEvents();
        dispatchGatewayReconnected();
      }
      return result;
    },
    upsertClientGateway: async (entry: ClientGatewayEntryDto) => {
      const fn = attachRaw()?.upsertClientGateway;
      if (typeof fn !== 'function') return BROWSER_CLIENT_GATEWAY_PREFS;
      return fn(entry);
    },
    removeClientGateway: async (id: string) => {
      const fn = attachRaw()?.removeClientGateway;
      if (typeof fn !== 'function') return BROWSER_CLIENT_GATEWAY_PREFS;
      return fn(id);
    },
    probeClientGateway: async (payload: { baseUrl: string; token: string }) => {
      const fn = attachRaw()?.probeClientGateway;
      if (typeof fn !== 'function') return { ok: false as const, error: 'desktop_only' };
      return fn(payload);
    },
    relaunchApp: async () => {
      const fn = attachRaw()?.relaunchApp;
      if (typeof fn !== 'function') return false;
      return Boolean(await fn());
    },
    getClientSettings: async () => readClientChrome(),
    saveClientSettings: async (settings: ClientSettings) => writeClientChrome(settings),
    onNativeThemeUpdated: (handler: () => void): (() => void) => {
      const fn = attachRaw()?.onNativeThemeUpdated;
      if (typeof fn === 'function') return fn(handler);
      return () => {};
    },
  };

  return okbot;
}

export function installHttpOkbotBridge(): void {
  if (typeof window === 'undefined') return;
  const existing = (window as any).okbot;
  const gatewayBooted = Boolean((window as any).__okbotGatewayBoot);
  const attached = Boolean(attachConfig());
  // Electron's full preload owns window.okbot. An attach preload does not; this window is a client.
  if (existing && !gatewayBooted && !attached) return;

  const okbot = createHttpOkbotBridge();
  // Real HTTP methods override boot fallbacks. The boot setter then fills any
  // preload/legacy name this object still lacks, so a missing function cannot throw.
  (window as any).okbot = gatewayBooted ? { ...existing, ...okbot } : okbot;
  document.documentElement.dataset.okbotGateway = '1';
  startGatewaySessionEvents();
}
