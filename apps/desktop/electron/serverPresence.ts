import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

/** One OkBot backend per data directory. Electron and `okbot serve` share this file. */
export type ServerLock = {
  pid: number;
  port: number;
  owner: 'serve' | 'electron';
};

const LOCK_NAME = 'server.json';

export function serverLockPath(root: string): string {
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

/** True when GET /v1/health is this gateway, not some other listener. */
export function probeOkbotHealth(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/health',
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

export type RunningServer =
  | { state: 'free' }
  | { state: 'running'; port: number; pid?: number };

/**
 * Health wins. A live lock with no health yet means another OkBot still owns the data dir
 * (it may be binding, or it is the desktop app between restarts of the listener).
 */
export async function inspectRunningServer(root: string, port: number): Promise<RunningServer> {
  if (await probeOkbotHealth(port)) return { state: 'running', port };
  const lock = readServerLock(root);
  if (!lock || lock.pid === process.pid || !isPidAlive(lock.pid)) return { state: 'free' };
  const lockPort = lock.port > 0 ? lock.port : port;
  for (let i = 0; i < 10; i++) {
    if (await probeOkbotHealth(lockPort)) return { state: 'running', port: lockPort, pid: lock.pid };
    await new Promise((r) => setTimeout(r, 200));
  }
  return { state: 'running', port: lockPort, pid: lock.pid };
}
