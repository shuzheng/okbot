import crypto from 'node:crypto';
import http from 'node:http';

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
};

function getJson(
  port: number,
  requestPath: string,
  timeoutMs: number,
): Promise<{ status: number; body: ChallengeBody | null }> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
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
 * Prove the process on `port` knows `token` without sending the token.
 * A faker that only echoes Authorization cannot pass.
 */
export async function verifyOkbotChallenge(
  port: number,
  token: string,
  timeoutMs = 400,
): Promise<boolean> {
  const saved = token.trim();
  if (!saved) return false;
  const nonce = createProbeNonce();
  const { status, body } = await getJson(
    port,
    `/v1/auth-challenge?nonce=${encodeURIComponent(nonce)}`,
    timeoutMs,
  );
  if (status !== 200 || !body) return false;
  if (body.ok !== true || body.service !== 'okbot-local-http-api') return false;
  const mac = typeof body.mac === 'string' ? body.mac.trim().toLowerCase() : '';
  if (!mac || mac.length !== 64) return false;
  const expected = probeChallengeMac(saved, nonce);
  try {
    return crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
