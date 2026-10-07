/**
 * Browser/gateway adapter: when Electron preload is absent, provide window.okbot
 * over the desktop LAN HTTP API (REST + SSE). Same UI codebase.
 */

import { normalizeUsageStats, TOOL_IDS } from '@okbot/shared';


type Json = Record<string, unknown>;

type AttachConfig = { base?: string; token?: string; platform?: string };

type AttachWindowFns = {
  windowMinimize?: () => Promise<boolean>;
  windowMaximizeToggle?: () => Promise<boolean>;
  windowClose?: () => Promise<boolean>;
  windowIsMaximized?: () => Promise<boolean>;
  windowFocus?: () => Promise<boolean>;
  onWindowMaximizedChanged?: (cb: (maximized: boolean) => void) => () => void;
  /** Electron attach preload: resolve absolute path for a dropped File. */
  getPathForFile?: (file: File) => string;
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
  if (!raw?.base) return null;
  return {
    base: raw.base.replace(/\/+$/, ''),
    token: typeof raw.token === 'string' ? raw.token : '',
    platform: typeof raw.platform === 'string' ? raw.platform : undefined,
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

/** Long-lived SSE so a desktop-side roster change reaches this gateway page. */
function startGatewaySessionEvents(): void {
  if (sessionEventsStarted) return;
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  sessionEventsStarted = true;
  let stopped = false;
  const pump = async () => {
    let delay = 1000;
    while (!stopped) {
      try {
        const token = gatewayToken();
        const res = await fetch(endpoint('/v1/events'), {
          credentials: 'include',
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok || !res.body) {
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 10_000);
          continue;
        }
        delay = 1000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!stopped) {
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
              if (!event || event.type !== 'sessions_changed') continue;
              for (const listener of [...runtimeListeners]) listener(event);
            } catch {
              /* ignore malformed */
            }
          }
        }
      } catch {
        /* reconnect */
      }
      if (!stopped) {
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 10_000);
      }
    }
  };
  void pump();
  window.addEventListener('pagehide', () => {
    stopped = true;
  });
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
          ...(x?.showThinking === false ? { showThinking: false as const } : {}),
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
      role: typeof m?.role === 'string' ? m.role : '',
    })),
  };
}

export function fillGatewaySettings(settings: unknown) {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, any>) : {};
  const security = s.security && typeof s.security === 'object' ? s.security : {};
  const local = s.localHttpApi && typeof s.localHttpApi === 'object' ? s.localHttpApi : {};
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
      blockMode: security.blockMode === 'tripwire' ? 'tripwire' : 'reject',
    },
    model: fillGatewayModel(s.model),
    autoApprovalEnabled: s.autoApprovalEnabled === true,
    autoApprovalRules: Array.isArray(s.autoApprovalRules) ? s.autoApprovalRules : [],
    notifications: s.notifications !== false,
    showAdvancedSettings: s.showAdvancedSettings === true,
    mcp: s.mcp && typeof s.mcp === 'object'
      ? { enabled: s.mcp.enabled === true, servers: Array.isArray(s.mcp.servers) ? s.mcp.servers : [] }
      : { enabled: false, servers: [] },
    microphoneId: typeof s.microphoneId === 'string' ? s.microphoneId : '',
    localHttpApi: {
      enabled: local.enabled === true,
      port: typeof local.port === 'number' ? local.port : 18765,
      token: typeof local.token === 'string' ? local.token : '',
      bindLan: local.bindLan === true,
      serveUi: local.serveUi === true,
    },
    contextCompression:
      s.contextCompression && typeof s.contextCompression === 'object' ? s.contextCompression : {},
    instructions: s.instructions && typeof s.instructions === 'object' ? s.instructions : {},
    memory: s.memory && typeof s.memory === 'object' ? s.memory : {},
    squad: s.squad && typeof s.squad === 'object' ? s.squad : {},
    toolRun: s.toolRun && typeof s.toolRun === 'object' ? s.toolRun : {},
  };
}

/** Fill localHttpApi.token from the narrow authenticated endpoint. Bootstrap blanks it. */
async function withLiveGatewayToken<T extends { localHttpApi?: { token?: string } }>(settings: T): Promise<T> {
  try {
    const json = await api<{ token?: unknown }>('GET', '/v1/gateway-token');
    const token = typeof json?.token === 'string' ? json.token : '';
    if (!token) return settings;
    const local = settings.localHttpApi && typeof settings.localHttpApi === 'object' ? settings.localHttpApi : {};
    return { ...settings, localHttpApi: { ...local, token } };
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
      const settings = await withLiveGatewayToken(fillGatewaySettings(b?.settings));
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
    /** Live token the server checks. Not read from bootstrap, which blanks it. */
    getGatewayAccessToken: async () => {
      const json = await api<{ token?: unknown }>('GET', '/v1/gateway-token');
      return typeof json?.token === 'string' ? json.token : '';
    },
    saveSettings: async (settings: unknown) => {
      const json = await api<any>('POST', '/v1/settings', settings);
      return withLiveGatewayToken(fillGatewaySettings(json?.settings ?? json));
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
    getMessages: async (botId: string, opts?: { limit?: number }) => {
      const raw = opts?.limit;
      const limit =
        typeof raw === 'number' && Number.isFinite(raw) && raw > 0
          ? Math.min(200, Math.max(1, Math.floor(raw)))
          : 50;
      const page = await okbot.getMessagesPage(botId, { limit });
      return page.messages || [];
    },
    chatStart: async (
      botId: string,
      text: string,
      opts?: {
        quoteMessageId?: string;
        computerId?: string;
        attachments?: unknown;
        clientTurnId?: string;
      },
    ) => {
      const token = gatewayToken();
      const res = await fetch(endpoint(`/v1/bots/${encodeURIComponent(botId)}/messages`), {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          text,
          computerId: opts?.computerId,
          quoteMessageId: opts?.quoteMessageId,
          clientTurnId: opts?.clientTurnId,
        }),
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
            for (const l of runtimeListeners) l(event);
          } catch {
            /* ignore */
          }
        }
      }
      return { ok: true };
    },
    chatStartSquad: async (
      squadId: string,
      text: string,
      opts?: { quoteMessageId?: string; computerId?: string; clientTurnId?: string },
    ) => {
      const token = gatewayToken();
      const res = await fetch(endpoint(`/v1/squads/${encodeURIComponent(squadId)}/messages`), {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          text,
          computerId: opts?.computerId,
          quoteMessageId: opts?.quoteMessageId,
          clientTurnId: opts?.clientTurnId,
        }),
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
            for (const l of runtimeListeners) l(event);
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
    updaterGetStatus: async () => {
      const info = await okbot.getAppInfo();
      return { phase: 'idle' as const, currentVersion: info?.version || '0.0.0' };
    },
    onUpdaterEvent: () => () => {},
    onNativeThemeUpdated: () => () => {},
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
    pickPaths: async () => ({ canceled: true, paths: [] }),
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
    readGeneratedAssetDataUrl: async () => null,
    getPromptContext: (botId: string, messageId: string) =>
      rpc('getPromptContext', { botId, messageId }),
    getLastRunTrace: (ownerId: string) => rpc('getLastRunTrace', { ownerId }),
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
    readAgentsMd: (botId: string) => rpc<string>('readAgentsMd', { botId }),
    createBot: (input: Record<string, unknown>) => rpc('createBot', input ?? {}),
    createSquad: (input: Record<string, unknown>) => rpc('createSquad', input ?? {}),
    updateBot: (id: string, patch: Record<string, unknown>) => rpc('updateBot', { id, patch }),
    finishBotOnboarding: (botId: string, answers: Record<string, unknown>) =>
      rpc('finishBotOnboarding', { botId, answers }),
    deleteBot: (id: string) => rpc<boolean>('deleteBot', { id }),
    updateSquad: (id: string, patch: Record<string, unknown>) => rpc('updateSquad', { id, patch }),
    deleteSquad: (id: string) => rpc<boolean>('deleteSquad', { id }),
    writeAgentsMd: (botId: string, content: string) => rpc<boolean>('writeAgentsMd', { botId, content }),
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
    // Desktop-only: MCP starts host processes; backup reads / replaces the whole data dir.
    mcpStatus: async () => [],
    mcpTestServer: async () => ({ id: '', name: '', ok: false, toolCount: 0, error: 'desktop_only' }),
    backupExport: async () => ({ ok: false as const, error: 'desktop_only' }),
    backupRestore: async () => ({ ok: false as const, error: 'desktop_only' }),
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
    updaterCheck: async () => okbot.updaterGetStatus(),
    updaterDownload: async () => okbot.updaterGetStatus(),
    updaterInstall: async () => undefined,
    compressSessionNow: async (payload: Record<string, unknown>) => {
      try {
        return await rpc('compressSessionNow', payload ?? {});
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'compress_failed' };
      }
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
