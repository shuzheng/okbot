/**
 * Chat media under ~/.okbot/<owner>/{resources|uploads}/.
 * Canonical src is absolute gateway `/v1/media/<owner>/{resources|uploads}/<file>`
 * (also accept legacy okbot-asset:… / file://…/.okbot/…/(resources|uploads)/…);
 * rendered via the local gateway GET /v1/media/… (not file://, not remote https).
 */

export type ParsedOwnerResource = {
  /** `<ownerId>/{resources|uploads}/<fileName>` */
  assetRel: string;
  ownerId: string;
  fileName: string;
  /** Disk subdir under the owner; defaults to resources for legacy callers. */
  subdir: 'resources' | 'uploads';
};

const OWNER_MEDIA_RE =
  /(?:^|[\\/])\.okbot[\\/]([^/\\]+)[\\/](resources|uploads)[\\/]([^/\\?#]+)/i;

/** True for legacy okbot-asset: srcs (canonical form is `/v1/media/…`). */
export function isOkbotAssetSrc(src: string | undefined): src is string {
  return Boolean(src && /^okbot-asset:/i.test(src));
}

/**
 * Safe inline `data:image/*` from legacy replies (tool copy forbids new ones).
 * CSP allows `data:`; reject non-image data URLs (e.g. text/html).
 */
export function isSafeDataImageSrc(src: string | undefined): src is string {
  return Boolean(
    src && /^data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp|x-icon)[;,]/i.test(src.trim()),
  );
}

/**
 * Parse `/v1/media/<ownerId>/{resources|uploads}/<file>`, okbot-asset:…, or a file://
 * (or absolute) path that points at ~/.okbot/<ownerId>/{resources|uploads}/<file>.
 */
export function parseOwnerResourceSrc(src: string | undefined): ParsedOwnerResource | null {
  if (!src || typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (!trimmed) return null;

  const fromMediaPathname = (pathname: string): ParsedOwnerResource | null => {
    const pathOnly = pathname.split('?')[0]!.split('#')[0]!;
    const m = /^\/v1\/media\/([^/]+)\/(resources|uploads)\/([^/]+)$/i.exec(pathOnly);
    if (!m?.[1] || !m?.[2] || !m?.[3]) return null;
    let ownerId = m[1];
    const subdir = m[2].toLowerCase() === 'uploads' ? 'uploads' : 'resources';
    let fileName = m[3];
    try {
      ownerId = decodeURIComponent(ownerId);
      fileName = decodeURIComponent(fileName);
    } catch {
      /* keep encoded */
    }
    return parseAssetRel(`${ownerId}/${subdir}/${fileName}`);
  };

  if (/^\/v1\/media\//i.test(trimmed)) {
    return fromMediaPathname(trimmed);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      return fromMediaPathname(u.pathname || '');
    } catch {
      return null;
    }
  }

  if (/^okbot-asset:/i.test(trimmed)) {
    const rel = trimmed
      .replace(/^okbot-asset:/i, '')
      .replace(/^\/+/, '')
      .replace(/\\/g, '/');
    return parseAssetRel(rel);
  }

  let pathPart = trimmed;
  if (/^file:/i.test(trimmed)) {
    try {
      // file:///Users/… or file://localhost/Users/… or file:///C:/Users/…
      const u = new URL(trimmed);
      pathPart = decodeURIComponent(u.pathname || '');
      // Windows: URL pathname is /C:/Users/… — keep as-is for the .okbot match.
    } catch {
      pathPart = trimmed.replace(/^file:\/\//i, '');
      try {
        pathPart = decodeURIComponent(pathPart);
      } catch {
        /* keep raw */
      }
    }
  }

  const m = OWNER_MEDIA_RE.exec(pathPart.replace(/\\/g, '/'));
  if (!m?.[1] || !m?.[2] || !m?.[3]) return null;
  const subdir = m[2].toLowerCase() === 'uploads' ? 'uploads' : 'resources';
  return parseAssetRel(`${m[1]}/${subdir}/${m[3]}`);
}

export function parseAssetRel(relRaw: string): ParsedOwnerResource | null {
  const rel = (relRaw || '').replace(/^\/+/, '').replace(/\\/g, '/');
  if (!rel || rel.includes('..') || rel.startsWith('/')) return null;
  const parts = rel.split('/');
  if (parts.length !== 3) return null;
  const subdirRaw = parts[1];
  if (subdirRaw !== 'resources' && subdirRaw !== 'uploads') return null;
  const ownerId = parts[0] || '';
  const fileName = parts[2] || '';
  if (!ownerId || !fileName) return null;
  if (ownerId.includes('\\') || fileName.includes('\\')) return null;
  if (ownerId.includes('\0') || fileName.includes('\0')) return null;
  const subdir = subdirRaw;
  return { assetRel: `${ownerId}/${subdir}/${fileName}`, ownerId, fileName, subdir };
}

/** Pathname only: `/v1/media/<ownerId>/{resources|uploads}/<fileName>` (encoded). */
export function mediaAssetPathname(assetRel: string): string | null {
  const parsed = parseAssetRel(assetRel);
  if (!parsed) return null;
  return `/v1/media/${encodeURIComponent(parsed.ownerId)}/${parsed.subdir}/${encodeURIComponent(parsed.fileName)}`;
}

/**
 * Build assetRel / media pathname from an absolute gateway path under
 * ~/.okbot/<owner>/{resources|uploads}/<file>.
 */
export function mediaPathFromAbsolute(absPath: string): {
  assetRel: string;
  mediaPath: string;
} | null {
  const parsed = parseOwnerResourceSrc(absPath);
  if (!parsed) return null;
  const mediaPath = mediaAssetPathname(parsed.assetRel);
  if (!mediaPath) return null;
  return { assetRel: parsed.assetRel, mediaPath };
}

type AttachCfg = { base?: string; token?: string };

function attachConfig(): AttachCfg | null {
  const raw = (globalThis as { __okbotAttach?: AttachCfg }).__okbotAttach;
  if (!raw || typeof raw.base !== 'string' || !raw.base.trim()) return null;
  return raw;
}

/**
 * Build a gateway URL the <img> tag can load (Bearer is not available on img).
 * - Attach / Electron loopback: absolute http://127.0.0.1:<port>/v1/media/…?token=
 * - Same-origin gateway Web UI: relative /v1/media/… (cookie) or with ?token= when known
 */
export async function resolveMediaAssetUrl(assetRel: string): Promise<string | null> {
  const pathname = mediaAssetPathname(assetRel);
  if (!pathname) return null;

  const attach = attachConfig();
  if (attach?.base) {
    const base = attach.base.replace(/\/+$/, '');
    const token = typeof attach.token === 'string' ? attach.token.trim() : '';
    return token ? `${base}${pathname}?token=${encodeURIComponent(token)}` : `${base}${pathname}`;
  }

  const okbot = (globalThis as { okbot?: {
    getSettings?: () => Promise<{ gatewayHttpApi?: { port?: number; token?: string } }>;
    getGatewayAccessToken?: () => Promise<string>;
  } }).okbot;

  let token = '';
  try {
    if (typeof okbot?.getGatewayAccessToken === 'function') {
      token = (await okbot.getGatewayAccessToken())?.trim() || '';
    }
  } catch {
    token = '';
  }

  // Gateway Web UI (page origin is the API). Cookie auth works; token query is optional.
  if (typeof document !== 'undefined' && document.documentElement?.dataset?.okbotGateway === '1') {
    return token ? `${pathname}?token=${encodeURIComponent(token)}` : pathname;
  }

  // Electron owns-server: renderer is file:// or vite; images load from loopback gateway.
  try {
    const settings = typeof okbot?.getSettings === 'function' ? await okbot.getSettings() : null;
    const port = settings?.gatewayHttpApi?.port;
    if (!token) {
      token = typeof settings?.gatewayHttpApi?.token === 'string' ? settings.gatewayHttpApi.token.trim() : '';
    }
    if (typeof port === 'number' && port > 0 && token) {
      return `http://127.0.0.1:${port}${pathname}?token=${encodeURIComponent(token)}`;
    }
  } catch {
    /* fall through */
  }
  return null;
}
