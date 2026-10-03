/**
 * Browser/gateway adapter: when Electron preload is absent, provide window.okbot
 * over the desktop LAN HTTP API (REST + SSE). Same UI codebase.
 */

type Json = Record<string, unknown>;

function gatewayToken(): string {
  try {
    const loc = globalThis.location;
    const storage = globalThis.sessionStorage;
    const q = new URLSearchParams(loc?.search || '').get('token');
    if (q?.trim()) {
      storage?.setItem('okbot.gatewayToken', q.trim());
      return q.trim();
    }
    return storage?.getItem('okbot.gatewayToken') || '';
  } catch {
    return '';
  }
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
  const res = await fetch(path, {
    method,
    headers,
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
        const res = await fetch('/v1/events', {
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

const GATEWAY_TOOL_IDS = ['read_file', 'read_skill', 'write_file', 'edit_file', 'run_shell', 'generate_image'] as const;

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
      return {
        bots: Array.isArray(b?.bots) ? b.bots : [],
        squads: squads.map(fillGatewaySquad),
        dataDir: b?.dataDir || '',
        hardwareAccelerationActive: b?.hardwareAccelerationActive !== false,
        settings: fillGatewaySettings(b?.settings),
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
    saveSettings: async () => {
      throw new Error('Saving settings from gateway web UI is not supported yet');
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
    getMessages: async (botId: string) => {
      const page = await okbot.getMessagesPage(botId, { limit: 50 });
      return page.messages || [];
    },
    chatStart: async (
      botId: string,
      text: string,
      opts?: { quoteMessageId?: string; computerId?: string; attachments?: unknown },
    ) => {
      const token = gatewayToken();
      const res = await fetch(`/v1/bots/${encodeURIComponent(botId)}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          text,
          computerId: opts?.computerId,
          quoteMessageId: opts?.quoteMessageId,
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
      opts?: { quoteMessageId?: string; computerId?: string },
    ) => {
      const token = gatewayToken();
      const res = await fetch(`/v1/squads/${encodeURIComponent(squadId)}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ text, computerId: opts?.computerId }),
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
    chatAbort: async () => ({ ok: true }),
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
    getAppInfo: async () => ({
      name: 'OkBot Gateway',
      version: 'gateway',
      platform: 'web',
      arch: '',
      electron: '',
      chrome: '',
      buildDate: '',
    }),
    setTrafficLightPosition: async () => false,
    probeComputer: async () => ({ ok: false as const, error: 'unreachable' }),
    // Stubs for APIs not yet exposed over gateway — keep UI from crashing
    toolRespond: async () => ({ ok: false, error: 'not_supported_on_gateway' }),
    setChatUnread: async () => true,
    updaterGetStatus: async () => ({ state: 'idle' }),
    onUpdaterEvent: () => () => {},
    onNativeThemeUpdated: () => () => {},
    windowMinimize: async () => false,
    windowMaximizeToggle: async () => false,
    windowClose: async () => false,
    windowIsMaximized: async () => false,
    onWindowMaximizedChanged: () => () => {},
    ensureMicrophoneAccess: async () => ({ granted: false }),
    openMicrophoneSettings: async () => false,
    getUsageStats: async () => ({ byOwner: [], daily: [] }),
    pickPaths: async () => ({ canceled: true, paths: [] }),
    readGeneratedAssetDataUrl: async () => null,
    getPromptContext: async () => ({ text: null }),
    getLastRunTrace: async () => null,
    searchMessages: async () => [],
    listBotMemories: async () => [],
    listGlobalMemories: async () => [],
    listBotSkills: async () => [],
    listGlobalAgentsSkills: async () => [],
    readAgentsMd: async () => '',
    createBot: async () => {
      throw new Error('Create bot from gateway not supported yet');
    },
    createSquad: async () => {
      throw new Error('Create squad from gateway not supported yet');
    },
    updateBot: async () => {
      throw new Error('Update bot from gateway not supported yet');
    },
    finishBotOnboarding: async () => {
      throw new Error('Bot onboarding from gateway not supported yet');
    },
    deleteBot: async () => {
      throw new Error('Delete bot from gateway not supported yet');
    },
    updateSquad: async () => {
      throw new Error('Update squad from gateway not supported yet');
    },
    deleteSquad: async () => {
      throw new Error('Delete squad from gateway not supported yet');
    },
    writeAgentsMd: async () => true,
    upsertBotMemory: async () => true,
    deleteBotMemory: async () => true,
    upsertGlobalMemory: async () => true,
    deleteGlobalMemory: async () => true,
    writeBotSkill: async () => true,
    deleteBotSkill: async () => true,
    exportAssistantPackage: async () => ({ canceled: true }),
    importAssistantPackage: async () => ({ canceled: true }),
    discoverModels: async () => ({ ok: false, error: 'not_supported_on_gateway' }),
    testModelConnection: async () => ({ ok: false, error: 'not_supported_on_gateway' }),
    clearModelBindingsForProvider: async () => ({ cleared: 0 }),
    getRecentErrorLog: async () => ({ entries: [] }),
    updaterCheck: async () => ({ state: 'idle' }),
    updaterDownload: async () => ({ state: 'idle' }),
    updaterInstall: async () => undefined,
    compressSessionNow: async () => ({ ok: false, error: 'not_supported_on_gateway' }),
  };

  return okbot;
}

export function installHttpOkbotBridge(): void {
  if (typeof window === 'undefined') return;
  const existing = (window as any).okbot;
  const gatewayBooted = Boolean((window as any).__okbotGatewayBoot);
  if (existing && !gatewayBooted) return; // Electron preload already present

  const okbot = createHttpOkbotBridge();
  // Real HTTP methods override boot fallbacks. The boot setter then fills any
  // preload/legacy name this object still lacks, so a missing function cannot throw.
  (window as any).okbot = gatewayBooted ? { ...existing, ...okbot } : okbot;
  document.documentElement.dataset.okbotGateway = '1';
  startGatewaySessionEvents();
}
