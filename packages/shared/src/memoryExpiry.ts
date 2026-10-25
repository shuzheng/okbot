/**
 * Memory row expiry: ISO timestamp or null/omit = permanent.
 * Existing rows without `expires` migrate as permanent.
 */

/** Normalize raw expires to ISO string, or null for permanent / invalid. */
export function normalizeMemoryExpires(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    // Heuristic: seconds vs ms
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return new Date(ms).toISOString();
  }
  const s = String(raw).trim();
  if (!s || s === 'null' || s === 'undefined') return null;
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

/** True when expires is set and already past `now` (ms). null/invalid = not expired (permanent). */
export function isMemoryExpired(
  expires: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (expires == null || expires === '') return false;
  const ts = Date.parse(expires);
  return Number.isFinite(ts) && ts <= now;
}

/** ISO expiry `msFromNow` milliseconds from `now`, or null if non-positive. */
export function memoryExpiresFromNow(
  msFromNow: number,
  now: number = Date.now(),
): string | null {
  if (!Number.isFinite(msFromNow) || msFromNow <= 0) return null;
  return new Date(now + msFromNow).toISOString();
}

/** Common TTL presets for scenario mapping (not forced — LLM may pick any ISO). */
export const MEMORY_TTL_MS = {
  /** Short-lived context: ~1 day */
  short: 24 * 60 * 60 * 1000,
  /** Temporary facts: ~7 days */
  medium: 7 * 24 * 60 * 60 * 1000,
  /** Soft long: ~90 days (prefer null/permanent for identity) */
  long: 90 * 24 * 60 * 60 * 1000,
} as const;

/**
 * System-prompt lines teaching the model how to set `expires`.
 * Uncertain → null (permanent). Explicit user deadline wins.
 */
export const MEMORY_EXPIRES_INSTRUCTION_LINES = [
  'expires：ISO 过期时间（UTC）或 null（永久）。按场景选 TTL：',
  '- 临时上下文 / 短命事实（今晚计划、临时行程、一次性约定）→ 数小时到数天的 ISO；',
  '- 偏好 / 身份 / 长期习惯 / 跨会话约定 → null（永久），或很长；',
  '- 用户明确说「记住 N 天 / 到某日」→ 按该期限给 ISO；',
  '- 拿不准 → null（永久）。',
] as const;
