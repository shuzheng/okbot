import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { joinProbePath, resolveProbeTarget } from './probeTarget';

/** Random hex nonce for a one-shot gateway authenticity check. */
export function createProbeNonce(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** HMAC-SHA256(token, nonce) as hex. Client and server must match without sending the token. */
export function probeChallengeMac(token: string, nonce: string): string {
  return crypto.createHmac('sha256', token).update(nonce, 'utf8').digest('hex');
}

export function isProbeNonce(raw: string): boolean {
  return /^[0-9a-f]{32,128}$/i.test(raw);
}

type ChallengeBody = {
  ok?: unknown;
  service?: unknown;
  mac?: unknown;
  adminMac?: unknown;
  /** HMAC for every stored gateway API token (multi-token). */
  macs?: unknown;
};

function getJson(
  portOrBase: number | string,
  requestPath: string,
  timeoutMs: number,
): Promise<{ status: number; body: ChallengeBody | null }> {
  const target = resolveProbeTarget(portOrBase);
  if (!target) return Promise.resolve({ status: 0, body: null });
  const lib = target.protocol === 'https:' ? https : http;
  const fullPath = joinProbePath(target, requestPath);
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
          let body: ChallengeBody | null = null;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChallengeBody;
          } catch {
            body = null;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', () => resolve({ status: 0, body: null }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: null });
    });
  });
}

/**
 * Prove the process at `portOrBase` knows `token` without sending the token.
 * `portOrBase` is a loopback port number or a full http(s) base URL (remote host).
 * A faker that only echoes Authorization cannot pass.
 */
export async function verifyOkbotChallenge(
  portOrBase: number | string,
  token: string,
  timeoutMs = 400,
): Promise<boolean> {
  const saved = token.trim();
  if (!saved) return false;
  const nonce = createProbeNonce();
  const { status, body } = await getJson(
    portOrBase,
    `/v1/auth-challenge?nonce=${encodeURIComponent(nonce)}`,
    timeoutMs,
  );
  if (status !== 200 || !body) return false;
  if (body.ok !== true || body.service !== 'okbot-local-http-api') return false;
  const expected = probeChallengeMac(saved, nonce);
  const fromList = Array.isArray(body.macs)
    ? body.macs.filter((v): v is string => typeof v === 'string')
    : [];
  const candidates = [body.mac, body.adminMac, ...fromList]
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length === 64);
  for (const mac of candidates) {
    try {
      if (crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'))) {
        return true;
      }
    } catch {
      /* ignore length mismatch */
    }
  }
  return false;
}
