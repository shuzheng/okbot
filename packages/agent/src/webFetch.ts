/**
 * Built-in `web_fetch`: HTTP(S) GET → readable text (HTML stripped).
 * SSRF-safe by default: blocks loopback / private / link-local / metadata
 * unless `allowPrivateNetwork` is set in settings.web.fetch.
 */
import dns from 'node:dns/promises';
import { isLoopbackHostname, type WebFetchSettings } from '@okbot/shared';

export const WEB_FETCH_TIMEOUT_MS = 20_000;
export const WEB_FETCH_MAX_BYTES = 1_500_000;
export const WEB_FETCH_MAX_REDIRECTS = 5;
export const WEB_FETCH_MAX_TEXT_CHARS = 80_000;

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

function isPrivateOrLocalIpv6(ip: string): boolean {
  const h = ip.toLowerCase();
  if (h === '::1' || h === '::') return true;
  // Unique local fc00::/7, link-local fe80::/10
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return true;
  }
  // IPv4-mapped
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(h);
  if (mapped) return isPrivateOrLocalIpv4(mapped[1]!);
  return false;
}

export function isBlockedHostnameLiteral(hostname: string): boolean {
  let h = hostname.toLowerCase().trim();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (!h) return true;
  if (isLoopbackHostname(h)) return true;
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

export type WebFetchOptions = {
  allowPrivateNetwork?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
  /** Injected for tests; default dns.lookup. */
  lookup?: (hostname: string) => Promise<{ address: string; family: number }>;
  signal?: AbortSignal;
};

export type WebFetchResult = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string;
  text: string;
  truncated: boolean;
};

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/** Lightweight HTML → plain text (no heavy parser dependency). */
export function htmlToReadableText(html: string): { title: string; text: string } {
  let body = html;
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  const title = titleMatch ? decodeBasicEntities(titleMatch[1]!.replace(/\s+/g, ' ').trim()) : '';
  body = body
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  body = body.replace(/<(br|hr)\s*\/?>/gi, '\n');
  body = body.replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|blockquote)>/gi, '\n');
  body = body.replace(/<li[^>]*>/gi, '- ');
  body = body.replace(/<[^>]+>/g, ' ');
  body = decodeBasicEntities(body);
  body = body
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return { title, text: body };
}

async function assertUrlAllowed(
  rawUrl: string,
  allowPrivate: boolean,
  lookup: NonNullable<WebFetchOptions['lookup']>,
): Promise<URL> {
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
  if (allowPrivate) return u;
  if (isBlockedHostnameLiteral(u.hostname)) {
    throw new Error(
      `出于安全（SSRF）已阻止访问本机/内网地址「${u.hostname}」。若确需访问，请在设置 → 工具 → 网页 打开「允许内网地址」。`,
    );
  }
  try {
    const resolved = await lookup(u.hostname);
    if (isBlockedResolvedAddress(resolved.address, resolved.family)) {
      throw new Error(
        `出于安全（SSRF）已阻止解析到内网地址 ${resolved.address}（主机 ${u.hostname}）。若确需访问，请在设置 → 工具 → 网页 打开「允许内网地址」。`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('SSRF')) throw err;
    // DNS failure: still refuse rather than fetch blindly when private is disallowed.
    throw new Error(`无法解析主机「${u.hostname}」：${err instanceof Error ? err.message : String(err)}`);
  }
  return u;
}

async function readBodyLimited(
  res: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
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
      if (keep > 0) chunks.push(value.slice(0, keep));
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
  const out = new Uint8Array(total > maxBytes ? maxBytes : total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return { bytes: out, truncated };
}

export async function webFetch(
  url: string,
  fetchSettings?: WebFetchSettings | null,
  opts?: WebFetchOptions,
): Promise<WebFetchResult> {
  const allowPrivate =
    opts?.allowPrivateNetwork === true || fetchSettings?.allowPrivateNetwork === true;
  const timeoutMs = opts?.timeoutMs ?? WEB_FETCH_TIMEOUT_MS;
  const maxBytes = opts?.maxBytes ?? WEB_FETCH_MAX_BYTES;
  const maxRedirects = opts?.maxRedirects ?? WEB_FETCH_MAX_REDIRECTS;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const lookup =
    opts?.lookup ??
    (async (hostname: string) => {
      const r = await dns.lookup(hostname, { all: false });
      return { address: r.address, family: r.family };
    });

  let current = (url || '').trim();
  if (!current) throw new Error('url 不能为空');

  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = opts?.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let redirects = 0;
  let finalUrl = current;
  let res: Response | null = null;

  while (true) {
    const parsed = await assertUrlAllowed(current, allowPrivate, lookup);
    finalUrl = parsed.toString();
    res = await fetchImpl(finalUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'User-Agent': 'OkBot-web_fetch/1.0',
      },
      signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`重定向缺少 Location（HTTP ${res.status}）`);
      redirects += 1;
      if (redirects > maxRedirects) throw new Error(`重定向次数超过上限（${maxRedirects}）`);
      current = new URL(loc, finalUrl).toString();
      continue;
    }
    break;
  }

  if (!res) throw new Error('未收到响应');

  const contentType = (res.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
  const { bytes, truncated: byteTrunc } = await readBodyLimited(res, maxBytes);
  const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

  let title = '';
  let text = raw;
  if (
    contentType.includes('html') ||
    /^\s*</.test(raw) ||
    /<html[\s>]/i.test(raw)
  ) {
    const parsed = htmlToReadableText(raw);
    title = parsed.title;
    text = parsed.text;
  }

  let truncated = byteTrunc;
  if (text.length > WEB_FETCH_MAX_TEXT_CHARS) {
    text = `${text.slice(0, WEB_FETCH_MAX_TEXT_CHARS)}\n\n…(已截断)`;
    truncated = true;
  }

  if (!res.ok) {
    throw new Error(
      `拉取失败（HTTP ${res.status}）${text ? `：${text.slice(0, 200)}` : ''}`,
    );
  }

  return {
    url: url.trim(),
    finalUrl,
    status: res.status,
    contentType: contentType || 'unknown',
    title,
    text,
    truncated,
  };
}

export function formatWebFetchToolOutput(result: WebFetchResult): string {
  const lines = [
    `URL: ${result.finalUrl}`,
    `HTTP ${result.status}`,
    `Content-Type: ${result.contentType}`,
  ];
  if (result.title) lines.push(`Title: ${result.title}`);
  if (result.truncated) lines.push('（正文已截断）');
  lines.push('', result.text || '（无正文）');
  return lines.join('\n');
}
