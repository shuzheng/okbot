import { createId, type AutoApprovalRule, type AutoApprovalAction } from '@okbot/shared';

export function normalizeAutoApprovalRules(raw: unknown): AutoApprovalRule[] {
  if (!Array.isArray(raw)) return [];
  const out: AutoApprovalRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Partial<AutoApprovalRule>;
    const description = typeof r.description === 'string' ? r.description.trim() : '';
    if (!description) continue;
    const action: AutoApprovalAction = r.action === 'allow' ? 'allow' : 'ask';
    const id = typeof r.id === 'string' && r.id ? r.id : createId('aar');
    const createdAt = typeof r.createdAt === 'string' && r.createdAt ? r.createdAt : new Date().toISOString();
    const updatedAt = typeof r.updatedAt === 'string' && r.updatedAt ? r.updatedAt : createdAt;
    out.push({ id, description, action, createdAt, updatedAt });
  }
  return out;
}



/** Local calendar date as yyyyMMdd (machine local / Asia/Shanghai on this Mac). */
export function localDateYyyyMmDd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * New-bot id: `bot_yyyyMMdd_<seq>`.
 * seq 1–999 → zero-padded to 3 digits; seq ≥ 1000 → no padding.
 */
export function formatBotId(dateYmd: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`invalid bot sequence: ${seq}`);
  }
  const seqPart = seq <= 999 ? String(seq).padStart(3, '0') : String(seq);
  return `bot_${dateYmd}_${seqPart}`;
}

/** Parse numeric seq from `bot_<dateYmd>_<digits>`; null if not today's pattern. */
export function parseBotIdSeqForDate(id: string, dateYmd: string): number | null {
  const prefix = `bot_${dateYmd}_`;
  if (!id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  const n = Number(rest);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}


export function formatSquadId(dateYmd: string, seq: number): string {
  const seqPart = String(seq).padStart(3, '0');
  return `squad_${dateYmd}_${seqPart}`;
}

export function parseSquadIdSeqForDate(id: string, dateYmd: string): number | null {
  const prefix = `squad_${dateYmd}_`;
  if (!id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  const n = Number(rest);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

export function isSquadOwnerId(id: string): boolean {
  return id.startsWith('squad_');
}

/** Reject empty / path-escape owner id segments from renderer IPC. */
export function assertSafeOwnerSegment(raw: string): string {
  const id = (raw || '').trim();
  if (!id) throw new Error('缺少 id');
  if (
    id.includes('..') ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('\0') ||
    id.includes('\n') ||
    id.includes('\r')
  ) {
    throw new Error(`非法 id：${id}`);
  }
  return id;
}

/** Same slug sanitizer as writeSkill — used by deleteSkill to block path escape. */
export function sanitizeSkillSlug(raw: string): string {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
