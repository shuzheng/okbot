import type { AppSettings } from '@okbot/shared';
import type { EntityOpName, EntityOps } from './entityOps';
import { isSavedProbeBaseUrl } from './modelProbe';

/** Ops that make this host send HTTP to a caller-given base URL. */
const PROBE_OPS: ReadonlySet<string> = new Set(['discoverModels', 'testModelConnection']);

/**
 * Entity operations a gateway client (attach window / Web UI) may call through
 * `POST /v1/rpc/:op`. The route sits behind the gateway token check, so a caller
 * here is the owner. The list is explicit: a new op is not exposed until it is
 * added here.
 *
 * Not on this list on purpose: data backup / restore (moves secrets and replaces
 * settings) and assistant package import / export by file path (reads and writes
 * paths on the gateway host).
 */
export const GATEWAY_RPC_OPS = [
  'createBot',
  'updateBot',
  'finishBotOnboarding',
  'deleteBot',
  'createSquad',
  'updateSquad',
  'deleteSquad',
  'listAssistantGallery',
  'installGalleryAssistant',
  'setChatUnread',
  'readAgentsMd',
  'writeAgentsMd',
  'listBotMemories',
  'upsertBotMemory',
  'deleteBotMemory',
  'listGlobalMemories',
  'upsertGlobalMemory',
  'deleteGlobalMemory',
  'listBotSkills',
  'writeBotSkill',
  'deleteBotSkill',
  'listGlobalAgentsSkills',
  'searchMessages',
  'getLastRunTrace',
  'getPromptContext',
  'getRecentErrorLog',
  'clearModelBindingsForProvider',
  'discoverModels',
  'testModelConnection',
  'compressSessionNow',
] as const satisfies readonly EntityOpName[];

export type GatewayRpcOp = (typeof GATEWAY_RPC_OPS)[number];

export function isGatewayRpcOp(name: string): name is GatewayRpcOp {
  return (GATEWAY_RPC_OPS as readonly string[]).includes(name);
}

export type GatewayRpcResult =
  | { status: 200; body: { ok: true; result: unknown } }
  | { status: 400 | 404 | 429; body: { ok: false; error: string } };

/**
 * Search reads chat files. Through the gateway, allow at most `maxInFlight`
 * searches at a time and `maxPerWindow` per `windowMs`; more returns 429.
 * The desktop IPC path does not use this (the UI debounces typing).
 */
export function createRateLimiter(opts: { maxInFlight: number; maxPerWindow: number; windowMs: number }) {
  let inFlight = 0;
  const starts: number[] = [];
  return {
    tryStart(now = Date.now()): (() => void) | null {
      while (starts.length && now - starts[0]! >= opts.windowMs) starts.shift();
      if (inFlight >= opts.maxInFlight || starts.length >= opts.maxPerWindow) return null;
      inFlight += 1;
      starts.push(now);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        inFlight -= 1;
      };
    },
  };
}

const RATE_LIMITED_OPS: ReadonlySet<string> = new Set(['searchMessages']);
const searchLimiter = createRateLimiter({ maxInFlight: 2, maxPerWindow: 20, windowMs: 10_000 });

export async function runGatewayRpc(
  ops: EntityOps,
  name: string,
  args: unknown,
  settings?: Pick<AppSettings, 'model'>,
): Promise<GatewayRpcResult> {
  if (!isGatewayRpcOp(name)) return { status: 404, body: { ok: false, error: 'unknown_op' } };
  const input =
    args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  // No SSRF through model probes: the gateway may probe saved provider URLs only.
  if (PROBE_OPS.has(name) && !(settings && isSavedProbeBaseUrl(settings, input))) {
    return { status: 400, body: { ok: false, error: 'probe_url_not_saved' } };
  }
  const release = RATE_LIMITED_OPS.has(name) ? searchLimiter.tryStart() : () => {};
  if (!release) return { status: 429, body: { ok: false, error: 'rate_limited' } };
  try {
    const fn = ops[name] as (a: Record<string, unknown>) => unknown;
    const result = await fn(input);
    return { status: 200, body: { ok: true, result: result ?? null } };
  } catch (err) {
    return {
      status: 400,
      body: { ok: false, error: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    release();
  }
}
