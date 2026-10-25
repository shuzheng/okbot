import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { verifyOkbotChallenge } from './authChallenge';
import { joinProbePath, resolveProbeTarget } from './probeTarget';
import { migrateLegacyRuntimeLock, RUNTIME_LOCK_NAME } from './storage/okbotLayout';

export type { ProbeTarget } from './probeTarget';
export { joinProbePath, resolveProbeTarget } from './probeTarget';

/** One OkBot backend per data directory. Electron and `okbot serve` share this file. */
export type ServerLock = {
  pid: number;
  port: number;
  owner: 'serve' | 'electron';
};

const LOCK_NAME = RUNTIME_LOCK_NAME;

export function serverLockPath(root: string): string {
  migrateLegacyRuntimeLock(root);
  return path.join(root, LOCK_NAME);
}

export function publicBase(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readServerLock(root: string): ServerLock | null {
  try {
    const raw = fs.readFileSync(serverLockPath(root), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ServerLock>;
    const pid = parsed.pid;
    const port = parsed.port;
    const owner = parsed.owner;
    if (!Number.isInteger(pid) || !Number.isInteger(port)) return null;
    if (owner !== 'serve' && owner !== 'electron') return null;
    return { pid: pid as number, port: port as number, owner };
  } catch {
    return null;
  }
}

/**
 * Exclusive create. A live pid keeps the data directory.
 * A dead pid is stale and replaced.
 */
export function acquireServerLock(
  root: string,
  info: ServerLock,
): { ok: true } | { ok: false; existing: ServerLock } {
  const file = serverLockPath(root);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      try {
        fs.writeFileSync(fd, JSON.stringify(info));
      } finally {
        fs.closeSync(fd);
      }
      return { ok: true };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;
      const existing = readServerLock(root);
      if (existing && existing.pid !== info.pid && isPidAlive(existing.pid)) {
        return { ok: false, existing };
      }
      try {
        fs.unlinkSync(file);
      } catch {
        /* another starter may have replaced it */
      }
    }
  }
  const existing = readServerLock(root);
  if (existing && isPidAlive(existing.pid) && existing.pid !== info.pid) {
    return { ok: false, existing };
  }
  return { ok: false, existing: existing ?? info };
}

/** Remove the lock only if this process still owns it. */
export function releaseServerLock(root: string, pid = process.pid): void {
  const existing = readServerLock(root);
  if (existing && existing.pid !== pid) return;
  try {
    fs.unlinkSync(serverLockPath(root));
  } catch {
    /* already gone */
  }
}

function readHealthMarker(portOrBase: number | string, timeoutMs: number): Promise<boolean> {
  const target = resolveProbeTarget(portOrBase);
  if (!target) return Promise.resolve(false);
  const lib = target.protocol === 'https:' ? https : http;
  const fullPath = joinProbePath(target, '/v1/health');
  return new Promise((resolve) => {
    const req = lib.get(
      {
        hostname: target.hostname,
        port: target.port,
        path: fullPath,
        timeout: timeoutMs,
        headers: { Accept: 'application/json' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              ok?: unknown;
              service?: unknown;
            };
            resolve(body.ok === true && body.service === 'okbot-local-http-api');
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Without a saved token, GET /v1/health must be this gateway.
 * With a token, prove the peer knows it via HMAC challenge — never send the token
 * to an unverified peer (a faker that only mirrors Authorization must not pass).
 *
 * `portOrBase` may be a loopback port (number) or a full http(s) base URL (remote).
 */
export async function probeOkbotHealth(
  portOrBase: number | string,
  timeoutMs = 400,
  token?: string,
): Promise<boolean> {
  const saved = typeof token === 'string' ? token.trim() : '';
  if (!saved) return readHealthMarker(portOrBase, timeoutMs);
  return verifyOkbotChallenge(portOrBase, saved, timeoutMs);
}

/**
 * Probe with access and/or admin.
 * Default prefers access (least-privilege). Pass `{ prefer: 'admin' }` for Electron
 * loopback attach on the gateway host — host UI must operate Settings → 网关端
 * even when CLI `serve` owns the process (same machine can read server.json).
 * Returns the credential that passed (empty string when unauthenticated health-only probe succeeds).
 */
export async function probeOkbotWithGatewayTokens(
  portOrBase: number | string,
  timeoutMs: number,
  accessToken?: string,
  adminToken?: string,
  opts?: { prefer?: 'access' | 'admin' },
): Promise<{ ok: true; token: string } | { ok: false }> {
  const prefer = opts?.prefer === 'admin' ? 'admin' : 'access';
  const ordered = prefer === 'admin' ? [adminToken, accessToken] : [accessToken, adminToken];
  const candidates: string[] = [];
  for (const raw of ordered) {
    const t = typeof raw === 'string' ? raw.trim() : '';
    if (!t || candidates.includes(t)) continue;
    candidates.push(t);
  }
  if (candidates.length === 0) {
    return (await probeOkbotHealth(portOrBase, timeoutMs)) ? { ok: true, token: '' } : { ok: false };
  }
  for (const token of candidates) {
    if (await probeOkbotHealth(portOrBase, timeoutMs, token)) {
      return { ok: true, token };
    }
  }
  return { ok: false };
}

export type RunningServer =
  | { state: 'free' }
  | { state: 'running'; port: number; pid?: number };

/**
 * Health wins. A live lock with no successful probe is not treated as OkBot —
 * otherwise Electron would attach and send the real token to a faker, and a
 * reused pid after crash would block a fresh start forever.
 */
export async function inspectRunningServer(
  root: string,
  port: number,
  token?: string,
  adminToken?: string,
): Promise<RunningServer> {
  if ((await probeOkbotWithGatewayTokens(port, 400, token, adminToken)).ok) {
    return { state: 'running', port };
  }
  const lock = readServerLock(root);
  if (!lock || lock.pid === process.pid || !isPidAlive(lock.pid)) return { state: 'free' };
  const lockPort = lock.port > 0 ? lock.port : port;
  for (let i = 0; i < 10; i++) {
    if ((await probeOkbotWithGatewayTokens(lockPort, 400, token, adminToken)).ok) {
      return { state: 'running', port: lockPort, pid: lock.pid };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  // Pid still alive but never answered the challenge — not a verified OkBot.
  // Drop the lock so a fresh start is not stuck attaching to a faker / reused pid.
  try {
    const latest = readServerLock(root);
    if (latest && latest.pid === lock.pid) fs.unlinkSync(serverLockPath(root));
  } catch {
    /* ignore */
  }
  return { state: 'free' };
}
