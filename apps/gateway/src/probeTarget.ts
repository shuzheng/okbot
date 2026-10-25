/** Parsed target for health / auth-challenge probes (loopback port or remote base URL). */
export type ProbeTarget = {
  protocol: 'http:' | 'https:';
  hostname: string;
  port: number;
  /** Path prefix without trailing slash ("" or "/okbot"). */
  pathname: string;
};

/**
 * Accept a loopback port number or a full http(s) base URL.
 * Returns null for empty / unsupported / unparsable values.
 */
export function resolveProbeTarget(portOrBase: number | string): ProbeTarget | null {
  if (typeof portOrBase === 'number') {
    if (!Number.isInteger(portOrBase) || portOrBase <= 0 || portOrBase > 65535) return null;
    return { protocol: 'http:', hostname: '127.0.0.1', port: portOrBase, pathname: '' };
  }
  const raw = typeof portOrBase === 'string' ? portOrBase.trim() : '';
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    const port = url.port
      ? Number(url.port)
      : url.protocol === 'https:'
        ? 443
        : 80;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    let pathname = url.pathname || '';
    if (pathname === '/') pathname = '';
    pathname = pathname.replace(/\/+$/, '');
    return {
      protocol: url.protocol,
      hostname: url.hostname,
      port,
      pathname,
    };
  } catch {
    return null;
  }
}

/** Join a probe path prefix with a request path like `/v1/health`. */
export function joinProbePath(target: ProbeTarget, requestPath: string): string {
  const prefix = target.pathname.replace(/\/+$/, '');
  const suffix = requestPath.startsWith('/') ? requestPath : `/${requestPath}`;
  return `${prefix}${suffix}`;
}
