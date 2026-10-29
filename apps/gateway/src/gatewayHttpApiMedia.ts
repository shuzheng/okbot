/** Media path resolution + bindLan media CORS helpers (split from gatewayHttpApi.ts). */

import type { IncomingMessage } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { isLoopbackHostname } from '@okbot/shared';

/** MIME for owner resources served at GET /v1/media/… */
export function mediaMimeForExt(ext: string): string {
  const e = (ext || '').toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  if (e === '.svg') return 'image/svg+xml';
  if (e === '.png') return 'image/png';
  return 'application/octet-stream';
}

/**
 * Resolve ~/.okbot/<ownerId>/{resources|uploads}/<file> for the media gateway.
 * Same path rules as IPC readGeneratedAssetDataUrl.
 */
export function resolveOwnerMediaFile(
  /** Durable data root (`~/.okbot/data`), not the okbot config root. */
  dataRootRaw: string,
  ownerId: string,
  subdir: 'resources' | 'uploads',
  fileName: string,
): { ok: true; filePath: string } | { ok: false; error: string } {
  const id = (ownerId || '').trim();
  const name = (fileName || '').trim();
  if (subdir !== 'resources' && subdir !== 'uploads') {
    return { ok: false, error: 'invalid asset path' };
  }
  if (!id || !name || id.includes('..') || name.includes('..')) {
    return { ok: false, error: 'invalid asset path' };
  }
  if (id.includes('/') || id.includes('\\') || id.includes('\0')) {
    return { ok: false, error: 'invalid asset path' };
  }
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return { ok: false, error: 'invalid asset path' };
  }
  const okbotRoot = path.resolve(dataRootRaw);
  const mediaDir = path.resolve(okbotRoot, id, subdir);
  const filePath = path.resolve(mediaDir, name);
  if (filePath !== mediaDir && !filePath.startsWith(mediaDir + path.sep)) {
    return { ok: false, error: 'path outside owner media' };
  }
  if (filePath !== okbotRoot && !filePath.startsWith(okbotRoot + path.sep)) {
    return { ok: false, error: 'path outside okbot data root' };
  }
  // Resolve symlinks and re-check containment so a link cannot escape the owner tree.
  let realFile: string;
  try {
    realFile = fs.realpathSync(filePath);
  } catch {
    return { ok: false, error: 'not_found' };
  }
  let realMediaDir = mediaDir;
  try {
    if (fs.existsSync(mediaDir)) realMediaDir = fs.realpathSync(mediaDir);
  } catch {
    /* keep logical mediaDir */
  }
  let realRoot = okbotRoot;
  try {
    if (fs.existsSync(okbotRoot)) realRoot = fs.realpathSync(okbotRoot);
  } catch {
    /* keep logical root */
  }
  if (realFile !== realMediaDir && !realFile.startsWith(realMediaDir + path.sep)) {
    return { ok: false, error: 'path outside owner media' };
  }
  if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) {
    return { ok: false, error: 'path outside okbot data root' };
  }
  return { ok: true, filePath: realFile };
}

/**
 * ACAO for tokenized media under bindLan.
 * Allow: exact gateway origin, Origin host === Host, or URL-parsed hostname that is
 * exact loopback (localhost / ::1 / 127.0.0.0/8). Never prefix-match —
 * `http://localhost.attacker.com` must not echo ACAO.
 * Returns the Origin to echo, or undefined to omit ACAO.
 */
export function resolveMediaCorsAllowOrigin(
  reqOrigin: string,
  gatewayOrigin: string,
  hostHdr: string,
): string | undefined {
  const origin = (reqOrigin || '').trim();
  if (!origin) return undefined;
  if (origin === gatewayOrigin) return origin;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    if (u.host === hostHdr) return origin;
    // Hostname exact loopback only (isLoopbackHostname rejects localhost.evil.com).
    if (isLoopbackHostname(u.hostname)) return origin;
  } catch {
    return undefined;
  }
  return undefined;
}

/** Loopback clients must not be reachable via a foreign Host (DNS rebinding). */
export function isLoopbackHost(req: IncomingMessage): boolean {
  const raw = req.headers.host;
  const host = String(Array.isArray(raw) ? raw[0] : raw || '').trim().toLowerCase();
  if (!host) return false;
  let name = host;
  if (name.startsWith('[')) {
    const end = name.indexOf(']');
    if (end > 0) name = name.slice(0, end + 1);
  } else {
    name = name.replace(/:\d+$/, '');
  }
  return isLoopbackHostname(name) || name === 'localhost';
}


