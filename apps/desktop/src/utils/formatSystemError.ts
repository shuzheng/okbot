/**
 * Map noisy SDK / undici connection failures to short Chinese copy.
 * Host is included when parseable from the error text (e.g. ConnectTimeout attempted address).
 */
function collectText(err: unknown, depth = 0): string {
  if (err == null || depth > 4) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    const anyErr = err as Error & { code?: unknown; cause?: unknown };
    const parts = [err.name, err.message];
    if (anyErr.code != null) parts.push(String(anyErr.code));
    if (anyErr.cause != null) parts.push(collectText(anyErr.cause, depth + 1));
    return parts.filter(Boolean).join(' | ');
  }
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const parts = [o.name, o.message, o.code, o.error]
      .filter((v) => v != null && v !== '')
      .map(String);
    if (o.cause != null) parts.push(collectText(o.cause, depth + 1));
    return parts.join(' | ');
  }
  return String(err);
}

function extractHost(text: string): string | null {
  const attempted = text.match(
    /attempted address(?:es)?:\s*([^,\s)]+)/i,
  );
  if (attempted?.[1]) {
    const raw = attempted[1].replace(/^\[|\]$/g, '');
    const host = raw.replace(/:\d+$/, '').trim();
    if (host) return host;
  }
  const url = text.match(/https?:\/\/([^/\s:?#]+)/i);
  if (url?.[1]) return url[1];
  const hostPort = text.match(/\b([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}):(\d{2,5})\b/i);
  if (hostPort?.[1]) return hostPort[1];
  return null;
}

function isConnectTimeout(text: string): boolean {
  return (
    /APIConnectionTimeoutError/i.test(text) ||
    /ConnectTimeoutError/i.test(text) ||
    /UND_ERR_CONNECT_TIMEOUT/i.test(text) ||
    /Connect Timeout Error/i.test(text) ||
    /Request timed out\.?/i.test(text) ||
    (/APIConnectionTimeout/i.test(text) && /timeout/i.test(text))
  );
}

function isFetchFailed(text: string): boolean {
  return /fetch failed/i.test(text);
}

export function formatSystemError(err: unknown): string {
  const text = collectText(err);
  const host = extractHost(text);

  if (isConnectTimeout(text)) {
    return host
      ? `连接超时：无法在时限内连上 ${host}，请检查网络或 BaseURL。`
      : '连接超时：无法在时限内连上接口，请检查网络或 BaseURL。';
  }

  if (isFetchFailed(text)) {
    // Nested undici timeout often surfaces only as "fetch failed" at the top.
    if (/timeout|UND_ERR_CONNECT|ConnectTimeout|Connect Timeout/i.test(text)) {
      return host
        ? `连接超时：无法在时限内连上 ${host}，请检查网络或 BaseURL。`
        : '连接超时：无法在时限内连上接口，请检查网络或 BaseURL。';
    }
    return host
      ? `网络请求失败：无法访问 ${host}，请检查网络或 BaseURL。`
      : '网络请求失败：请检查网络或 BaseURL。';
  }

  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (typeof err === 'string' && err.trim()) return err.trim();
  const cleaned = text
    .replace(/^\s*Error:\s*/i, '')
    .trim();
  return cleaned || '发生未知错误';
}
