/**
 * Shared SSRF-safe HTTP GET: DNS all:true + undici pin, hop-by-hop redirect
 * re-check, body size limit. Used by web_fetch and GitHub assistant import.
 */
import dns from 'node:dns/promises';
import { isLoopbackHostname } from '@okbot/shared';
import { Agent, fetch as undiciFetch } from 'undici';

export const SSRF_DEFAULT_TIMEOUT_MS = 20_000;
export const SSRF_DEFAULT_MAX_BYTES = 1_500_000;
export const SSRF_DEFAULT_MAX_REDIRECTS = 5;

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64/10
];

function isPrivateOrLocalIpv4(ip: string): boolean {
  return PRIVATE_V4.some((re) => re.test(ip));
}

/** Extract IPv4 from IPv4-mapped IPv6 (`::ffff:a.b.c.d` or `::ffff:aabb:ccdd`). */
export function ipv4FromMappedIpv6(ip: string): string | null {
  const h = ip.toLowerCase().trim();
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(h);
  if (dotted) return dotted[1]!;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  // Expanded / partially expanded: …:ffff:x:x or …:ffff:a.b.c.d
  const expandedDotted = /(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(h);
  if (expandedDotted && (h.includes('::') || /^0*:0*:0*:0*:0*:ffff:/i.test(h))) {
    return expandedDotted[1]!;
  }
  const expandedHex = /(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
  if (expandedHex && (h.includes('::') || /:0*:0*:0*:0*:ffff:/i.test(h) || /^0*:0*:0*:0*:0*:ffff:/i.test(h))) {
    const hi = parseInt(expandedHex[1]!, 16);
    const lo = parseInt(expandedHex[2]!, 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

/**
 * Extract IPv4 from deprecated IPv4-compatible IPv6 (`::a.b.c.d` or `::xxxx:yyyy`).
 * Distinct from IPv4-mapped (`::ffff:…`).
 */
export function ipv4FromCompatibleIpv6(ip: string): string | null {
  const h = ip.toLowerCase().trim();
  if (h.includes('ffff:')) return null; // mapped form handled separately
  const dotted = /^::(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (dotted) return dotted[1]!;
  const hex = /^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isPrivateOrLocalIpv6(ip: string): boolean {
  const h = ip.toLowerCase();
  if (h === '::1' || h === '::') return true;
  // Unique local fc00::/7, link-local fe80::/10
  if (
    h.startsWith('fc') ||
    h.startsWith('fd') ||
    h.startsWith('fe8') ||
    h.startsWith('fe9') ||
    h.startsWith('fea') ||
    h.startsWith('feb')
  ) {
    return true;
  }
  const mappedV4 = ipv4FromMappedIpv6(h);
  if (mappedV4) return isPrivateOrLocalIpv4(mappedV4);
  const compatV4 = ipv4FromCompatibleIpv6(h);
  if (compatV4) return isPrivateOrLocalIpv4(compatV4);
  return false;
}

/** Normalize host for literal checks: brackets, trailing dots (FQDN form). */
export function normalizeHostnameLiteral(hostname: string): string {
  let h = hostname.toLowerCase().trim();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  // `localhost.` / `evil.localhost.` — DNS FQDN form
  h = h.replace(/\.+$/, '');
  return h;
}

export function isBlockedHostnameLiteral(hostname: string): boolean {
  const h = normalizeHostnameLiteral(hostname);
  if (!h) return true;
  if (isLoopbackHostname(h)) return true;
  // isLoopbackHostname only matches exact `localhost`; also block *.localhost / *.local
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata') return true;
  // Bare IPv4 / IPv6 literals
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return isPrivateOrLocalIpv4(h);
  if (h.includes(':')) return isPrivateOrLocalIpv6(h);
  return false;
}

export function isBlockedResolvedAddress(address: string, family: number): boolean {
  if (family === 4 || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) {
    return isPrivateOrLocalIpv4(address);
  }
  return isPrivateOrLocalIpv6(address);
}

export type ResolvedAddress = { address: string; family: number };

export type SsrfLookup = (hostname: string) => Promise<ResolvedAddress[]>;

export type SsrfFetchOptions = {
  allowPrivateNetwork?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** When true, Content-Length / streamed overflow rejects instead of truncating. */
  rejectOversized?: boolean;
  /** Extra request headers (User-Agent / Accept etc.). */
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  /** Injected for tests; default dns.lookup all:true. */
  lookup?: SsrfLookup;
  signal?: AbortSignal;
};

function ssrfBlockMessage(detail: string): Error {
  return new Error(
    `出于安全（SSRF）已阻止访问${detail}。若确需访问，请在设置 → 工具 → 网页打开「允许内网地址」。`,
  );
}

/**
 * Validate URL + resolve DNS (all addresses). Rejects if any address is private
 * when allowPrivate is false. Always returns a pin list (literal IP or resolved)
 * so the connection cannot rebind; allowPrivate only skips the private reject.
 */
export async function assertUrlAllowed(
  rawUrl: string,
  allowPrivate: boolean,
  lookup: SsrfLookup,
): Promise<{ url: URL; pins: ResolvedAddress[] }> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`无效 URL：${rawUrl}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`仅支持 http/https，收到 ${u.protocol}`);
  }
  if (u.username || u.password) {
    throw new Error('不允许在 URL 中带用户名/密码');
  }

  // allowPrivate still pins; it only skips the private-address reject.
  if (!allowPrivate && isBlockedHostnameLiteral(u.hostname)) {
    throw ssrfBlockMessage(`本机/内网地址「${u.hostname}」`);
  }

  // Literal IP: pin so undici cannot reinterpret the host string.
  let host = normalizeHostnameLiteral(u.hostname);
  // Keep bracket-stripped host for IP checks; if original had only brackets/dots empty → blocked above
  if (!host) host = normalizeHostnameLiteral(u.hostname);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return { url: u, pins: [{ address: host, family: 4 }] };
  }
  if (host.includes(':')) {
    const mapped = ipv4FromMappedIpv6(host);
    if (mapped) {
      if (!allowPrivate && isPrivateOrLocalIpv4(mapped)) {
        throw ssrfBlockMessage(`本机/内网地址「${u.hostname}」`);
      }
      return { url: u, pins: [{ address: mapped, family: 4 }] };
    }
    if (!allowPrivate && isPrivateOrLocalIpv6(host)) {
      throw ssrfBlockMessage(`本机/内网地址「${u.hostname}」`);
    }
    return { url: u, pins: [{ address: host, family: 6 }] };
  }

  let resolved: ResolvedAddress[];
  try {
    resolved = await lookup(u.hostname);
  } catch (err) {
    if (err instanceof Error && err.message.includes('SSRF')) throw err;
    throw new Error(
      `无法解析主机「${u.hostname}」：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!resolved.length) {
    throw new Error(`无法解析主机「${u.hostname}」：无地址`);
  }
  if (!allowPrivate) {
    const blocked = resolved.filter((r) => isBlockedResolvedAddress(r.address, r.family));
    if (blocked.length) {
      throw ssrfBlockMessage(
        `解析到内网地址 ${blocked.map((b) => b.address).join(', ')}（主机 ${u.hostname}）`,
      );
    }
  }
  return { url: u, pins: resolved };
}

export async function defaultLookupAll(hostname: string): Promise<ResolvedAddress[]> {
  const rows = await dns.lookup(hostname, { all: true, verbatim: true });
  return rows.map((r) => ({ address: r.address, family: r.family }));
}

/** undici Agent that only connects to the pre-validated pin list. */
function pinnedAgent(pins: ResolvedAddress[]): Agent {
  const lookup = (
    _hostname: string,
    options: unknown,
    callback: (...args: any[]) => void,
  ) => {
    if (!pins.length) {
      callback(new Error('SSRF pin list empty'));
      return;
    }
    // Node/undici call lookup with `{ all: true }` and expect an address array;
    // single-value callback form yields `Invalid IP address: undefined`.
    const all =
      typeof options === 'object' &&
      options !== null &&
      (options as { all?: boolean }).all === true;
    if (all) {
      callback(
        null,
        pins.map((p) => ({ address: p.address, family: p.family })),
      );
      return;
    }
    callback(null, pins[0]!.address, pins[0]!.family);
  };
  return new Agent({
    connect: {
      // undici ConnectOptions.lookup matches Node dns.lookup; pin to validated addrs only.
      lookup: lookup as never,
    },
  });
}

export async function readBodyLimited(
  res: Response,
  maxBytes: number,
  opts?: { rejectOversized?: boolean },
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  // Prefer Content-Length when present so oversized bodies can fail before buffering.
  const cl = res.headers.get('content-length');
  if (cl && opts?.rejectOversized) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > maxBytes) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      throw new Error(`响应过大（Content-Length ${n} > ${maxBytes}）`);
    }
  }
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      return { bytes: buf.slice(0, maxBytes), truncated: true };
    }
    return { bytes: buf, truncated: false };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.byteLength > maxBytes) {
      const keep = maxBytes - total;
      if (keep > 0) {
        chunks.push(value.slice(0, keep));
        total += keep;
      }
      truncated = true;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return { bytes: out, truncated };
}

async function cancelResponseBody(res: Response | null | undefined): Promise<void> {
  if (!res?.body) return;
  try {
    await res.body.cancel();
  } catch {
    /* ignore */
  }
}

type PinnedHop = {
  res: Response;
  /** Close undici Agent after body is fully read or cancelled — never before. */
  closeAgent: () => Promise<void>;
};

async function fetchPinned(
  finalUrl: string,
  pins: ResolvedAddress[],
  signal: AbortSignal,
  headers: Record<string, string>,
  fetchImpl: typeof fetch | undefined,
): Promise<PinnedHop> {
  const init = {
    method: 'GET' as const,
    redirect: 'manual' as const,
    headers,
    signal,
  };
  const noopClose = async () => {};
  // Tests inject fetchImpl — skip pin (caller already validated via assertUrlAllowed).
  if (fetchImpl) {
    return { res: await fetchImpl(finalUrl, init), closeAgent: noopClose };
  }
  if (!pins.length) {
    return {
      res: (await undiciFetch(finalUrl, init)) as unknown as Response,
      closeAgent: noopClose,
    };
  }
  const agent = pinnedAgent(pins);
  try {
    const res = (await undiciFetch(finalUrl, {
      ...init,
      dispatcher: agent,
    })) as unknown as Response;
    return {
      res,
      closeAgent: async () => {
        try {
          await agent.close();
        } catch {
          /* ignore */
        }
      },
    };
  } catch (err) {
    try {
      await agent.close();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export type SsrfFetchResult = {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  headers: Headers;
  bytes: Uint8Array;
  truncated: boolean;
};

const DEFAULT_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
  'User-Agent': 'OkBot-ssrfHttp/1.0',
};

/**
 * SSRF-safe GET: validate + DNS pin each hop, manual redirects, limited body.
 * Does not throw on HTTP error status — caller checks `ok` / `status`.
 */
export async function ssrfHttpGet(
  url: string,
  opts?: SsrfFetchOptions,
): Promise<SsrfFetchResult> {
  const allowPrivate = opts?.allowPrivateNetwork === true;
  const timeoutMs = opts?.timeoutMs ?? SSRF_DEFAULT_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? SSRF_DEFAULT_MAX_BYTES;
  const maxRedirects = opts?.maxRedirects ?? SSRF_DEFAULT_MAX_REDIRECTS;
  const fetchImpl = opts?.fetchImpl;
  const lookup = opts?.lookup ?? defaultLookupAll;
  const headers = { ...DEFAULT_HEADERS, ...(opts?.headers ?? {}) };

  let current = (url || '').trim();
  if (!current) throw new Error('url 不能为空');

  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = opts?.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let redirects = 0;
  let finalUrl = current;
  let res: Response | null = null;
  let closeAgent: (() => Promise<void>) | null = null;

  const releaseHop = async (cancelBody: boolean) => {
    if (cancelBody) await cancelResponseBody(res);
    const closer = closeAgent;
    closeAgent = null;
    res = null;
    if (closer) await closer();
  };

  try {
    while (true) {
      const { url: parsed, pins } = await assertUrlAllowed(current, allowPrivate, lookup);
      finalUrl = parsed.toString();
      const hop = await fetchPinned(finalUrl, pins, signal, headers, fetchImpl);
      res = hop.res;
      closeAgent = hop.closeAgent;
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error(`重定向缺少 Location（HTTP ${res.status}）`);
        redirects += 1;
        if (redirects > maxRedirects) throw new Error(`重定向次数超过上限（${maxRedirects}）`);
        current = new URL(loc, finalUrl).toString();
        // Redirect body must be cancelled before agent.close, or close can deadlock.
        await releaseHop(true);
        continue;
      }
      break;
    }

    if (!res) throw new Error('未收到响应');

    const status = res.status;
    const ok = res.ok;
    const respHeaders = res.headers;
    const { bytes, truncated } = await readBodyLimited(res, maxBytes, {
      rejectOversized: opts?.rejectOversized === true,
    });
    if (opts?.rejectOversized && truncated) {
      throw new Error(`响应过大（超过 ${maxBytes} 字节）`);
    }
    const closer = closeAgent;
    closeAgent = null;
    if (closer) await closer();

    return {
      url: url.trim(),
      finalUrl,
      status,
      ok,
      headers: respHeaders,
      bytes,
      truncated,
    };
  } catch (err) {
    await releaseHop(true);
    throw err;
  }
}
