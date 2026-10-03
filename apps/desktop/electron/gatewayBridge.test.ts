import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { GATEWAY_BRIDGE_METHOD_NAMES, gatewayBootJs } from './gatewayLoginPage';
import { createHttpOkbotBridge } from '../src/bridge/httpOkbot';

const preload = fs.readFileSync(new URL('./preload.ts', import.meta.url), 'utf8');
const block = preload.slice(preload.indexOf('const api = {'), preload.indexOf('contextBridge.exposeInMainWorld'));
const preloadMethods = [...block.matchAll(/^\s{2}([A-Za-z0-9_]+)\s*(?::|\()/gm)].map((m) => m[1]!);
assert.ok(preloadMethods.includes('getBootstrap'));
assert.ok(preloadMethods.includes('onRuntimeEvent'));
assert.ok(preloadMethods.includes('getAppInfo'));

const startupMethods = [
  'getAppInfo',
  'getBootstrap',
  'updaterGetStatus',
  'setTrafficLightPosition',
  'onRuntimeEvent',
  'onChatEvent',
  'onUpdaterEvent',
  'onNativeThemeUpdated',
  'onWindowMaximizedChanged',
];

const fallbackNames = GATEWAY_BRIDGE_METHOD_NAMES as readonly string[];
for (const name of preloadMethods) {
  assert.ok(fallbackNames.includes(name), `gateway fallback missing preload method ${name}`);
}
for (const name of startupMethods) {
  assert.ok(fallbackNames.includes(name), `gateway fallback missing startup method ${name}`);
}

type BridgeFn = (...args: unknown[]) => unknown;
const sandbox: { window: { okbot?: Record<string, BridgeFn> }; document: { documentElement: { dataset: Record<string, string> } } } = {
  window: {},
  document: { documentElement: { dataset: {} } },
};
vm.createContext(sandbox);
vm.runInContext(gatewayBootJs(), sandbox);
// Pre-bridge renderer bundles call getAppInfo before they assign window.okbot.
assert.equal(typeof sandbox.window.okbot?.getAppInfo, 'function');
const earlyInfo = await sandbox.window.okbot!.getAppInfo!();
assert.equal((earlyInfo as { platform: string }).platform, 'web');

const bootSeen: string[] = [];
const offBoot = sandbox.window.okbot!.onChatEvent!((event: unknown) => {
  bootSeen.push((event as { type?: string }).type || '');
}) as () => void;
const bootGlobal = sandbox as typeof sandbox & {
  fetch: typeof fetch;
  TextDecoder: typeof TextDecoder;
  URLSearchParams: typeof URLSearchParams;
};
bootGlobal.TextDecoder = TextDecoder;
bootGlobal.URLSearchParams = URLSearchParams;
bootGlobal.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const sse = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'user_message', botId: 'b1' })}\n\n`));
        controller.close();
      },
    });
  if (url.includes('/v1/bootstrap')) {
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          bots: [{ id: 'b1', name: 'Ada', emoji: '🤖' }],
          squads: [{ id: 's1', name: 'Squad' }],
          settings: {
            theme: 'dark',
            tools: {},
            model: { providers: [{ id: 'p', name: 'P', models: [{ id: 'm' }] }] },
          },
          dataDir: '/tmp/okbot',
          hardwareAccelerationActive: true,
          busyBotIds: ['b1'],
          pendingToolRequests: [],
        }),
    };
  }
  if (url.includes('/v1/squads')) {
    return {
      ok: true,
      text: async () => JSON.stringify({ squads: [{ id: 's2', name: 'Name only' }] }),
    };
  }
  return { ok: true, body: sse(), text: async () => '' };
}) as unknown as typeof fetch;
const shaped = (await sandbox.window.okbot!.getBootstrap!()) as {
  squads: Array<{ id: string; members: Array<{ botId: string }> }>;
  settings: {
    tools: Record<string, { enabled: boolean }>;
    model: { providers: Array<{ models: Array<{ enabled: boolean }> }> };
  };
  busyBotIds: string[];
  pendingToolRequests: unknown[];
};
assert.equal(JSON.stringify(shaped.squads[0]?.members), '[]');
assert.equal(shaped.settings.tools.read_file?.enabled, true);
assert.equal(shaped.settings.tools.run_shell?.enabled, true);
assert.equal(shaped.settings.model.providers[0]?.models[0]?.enabled, true);
assert.equal(JSON.stringify(shaped.busyBotIds), JSON.stringify(['b1']));
assert.ok(Array.isArray(shaped.pendingToolRequests));
const listed = (await sandbox.window.okbot!.listSquads!()) as Array<{ members: unknown[] }>;
assert.equal(JSON.stringify(listed[0]?.members), '[]');
const listedSettings = (await sandbox.window.okbot!.getSettings!()) as {
  tools: Record<string, { enabled: boolean }>;
};
assert.equal(listedSettings.tools.generate_image?.enabled, true);
await sandbox.window.okbot!.chatStart!('b1', 'hi');
offBoot();
assert.deepEqual(bootSeen, ['user_message']);

let legacyListener: ((event: { type: string }) => void) | undefined;
const legacyOnChatEvent: BridgeFn = (cb) => {
  legacyListener = cb as (event: { type: string }) => void;
  return () => {
    legacyListener = undefined;
  };
};
sandbox.window.okbot = {
  getBootstrap: () => Promise.resolve({ bots: [{ id: 'kept' }] }),
  onChatEvent: legacyOnChatEvent,
};
const installed = sandbox.window.okbot;
assert.equal(installed.onChatEvent, legacyOnChatEvent);
assert.equal(typeof installed.setTrafficLightPosition, 'function');
for (const name of GATEWAY_BRIDGE_METHOD_NAMES) {
  assert.equal(typeof installed[name], 'function', `filled ${name}`);
}
const offFilled = installed.onRuntimeEvent!(() => {}) as () => void;
assert.equal(typeof offFilled, 'function');
offFilled();
const bootstrap = (await installed.getBootstrap!()) as { bots: Array<{ id: string }> };
assert.equal(bootstrap.bots[0]?.id, 'kept');
assert.equal(legacyListener, undefined);

const bridge = createHttpOkbotBridge();
for (const name of [...preloadMethods, 'onChatEvent']) {
  assert.equal(typeof bridge[name], 'function', `http bridge missing ${name}`);
}

const seen: string[] = [];
const offChat = bridge.onChatEvent!((event: unknown) => {
  seen.push(`chat:${(event as { type?: string }).type}`);
}) as () => void;
const offRuntime = bridge.onRuntimeEvent!((event: unknown) => {
  seen.push(`runtime:${(event as { type?: string }).type}`);
}) as () => void;
const payload = `data: ${JSON.stringify({ type: 'user_message', botId: 'b1' })}\n\n`;
const previousFetch = globalThis.fetch;
globalThis.fetch = (async () => ({
  ok: true,
  body: new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  }),
  text: async () => '',
})) as unknown as typeof fetch;
try {
  await bridge.chatStart!('b1', 'hi');
} finally {
  globalThis.fetch = previousFetch;
  offChat();
  offRuntime();
}
assert.deepEqual(seen, ['chat:user_message', 'runtime:user_message']);

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/v1/bootstrap')) {
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          squads: [{ id: 's1' }],
          settings: { tools: { read_file: { enabled: false, approval: 'ask' } }, model: { providers: [] } },
          activeRuns: { busyBotIds: ['b9'], pendingToolRequests: [] },
        }),
    };
  }
  return { ok: true, text: async () => JSON.stringify({ squads: [] }) };
}) as unknown as typeof fetch;
try {
  const httpBoot = (await bridge.getBootstrap!()) as {
    squads: Array<{ members: unknown[] }>;
    settings: { tools: Record<string, { enabled: boolean; approval: string }> };
    busyBotIds: string[];
  };
  assert.equal(JSON.stringify(httpBoot.squads[0]?.members), '[]');
  assert.equal(httpBoot.settings.tools.read_file?.enabled, false);
  assert.equal(httpBoot.settings.tools.read_file?.approval, 'ask');
  assert.equal(httpBoot.settings.tools.write_file?.enabled, true);
  assert.equal(JSON.stringify(httpBoot.busyBotIds), JSON.stringify(['b9']));
} finally {
  globalThis.fetch = previousFetch;
}


console.log('gatewayBridge.test.ts: ok');
