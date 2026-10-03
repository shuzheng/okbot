import type { IncomingMessage } from 'node:http';

export function extractBearerToken(req: IncomingMessage): string {
  const x = req.headers['x-okbot-token'];
  if (typeof x === 'string' && x.trim()) return x.trim();
  if (Array.isArray(x) && x[0]) return String(x[0]).trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

export function assertAuthorized(req: IncomingMessage, expected: string): boolean {
  if (!expected) return false;
  return extractBearerToken(req) === expected;
}
