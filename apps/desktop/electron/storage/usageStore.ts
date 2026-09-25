import path from 'node:path';
import {
  addTokenUsage,
  emptyTokenUsage,
  emptyUsageStats,
  normalizeTokenUsage,
  type TokenUsage,
  type UsageStats,
} from '@okbot/shared';
import { ensureDir, readJson, writeJson } from './fs';

/** Keep this many trailing calendar days in usage.json `daily` (inclusive of today). */
export const USAGE_DAILY_RETENTION_DAYS = 90;

/** Local calendar YYYY-MM-DD (Asia/Shanghai box clock / user zone). */
export function localUsageDay(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayOffset(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  dt.setDate(dt.getDate() + days);
  return localUsageDay(dt);
}

/** Drop daily keys older than retention; returns whether anything was removed. */
export function pruneUsageDaily(
  daily: Record<string, TokenUsage>,
  today = localUsageDay(),
  retainDays = USAGE_DAILY_RETENTION_DAYS,
): boolean {
  const cutoff = dayOffset(today, -(retainDays - 1));
  let changed = false;
  for (const key of Object.keys(daily)) {
    if (key < cutoff) {
      delete daily[key];
      changed = true;
    }
  }
  return changed;
}

export function loadUsageStats(file: string): UsageStats {
  const raw = readJson<UsageStats>(file, emptyUsageStats());
  const lifetime = normalizeTokenUsage(raw.lifetime) ?? emptyTokenUsage();
  const daily: Record<string, TokenUsage> = {};
  if (raw.daily && typeof raw.daily === 'object') {
    for (const [k, v] of Object.entries(raw.daily)) {
      const u = normalizeTokenUsage(v);
      if (u) daily[k] = u;
    }
  }
  pruneUsageDaily(daily);
  const byOwner: Record<string, TokenUsage> = {};
  if (raw.byOwner && typeof raw.byOwner === 'object') {
    for (const [k, v] of Object.entries(raw.byOwner)) {
      const u = normalizeTokenUsage(v);
      if (u) byOwner[k] = u;
    }
  }
  return { lifetime, daily, byOwner };
}

/**
 * Per-file write serialization (sync). Electron main RMW is already atomic between
 * calls. byOwner for squads is aggregate-only; member squad-token slices stay on
 * exchange bubbles, not byOwner during squad.
 */
export function recordTokenUsage(
  file: string,
  ownerId: string,
  usage: TokenUsage,
  opts?: { alsoOwnerIds?: string[]; /** When true, only bump byOwner (e.g. member slice). */ skipLifetime?: boolean },
): UsageStats {
  const next = loadUsageStats(file);
  const u = normalizeTokenUsage(usage) ?? emptyTokenUsage();
  if (!u.input && !u.output && !u.cache) {
    // Still prune on touch so retention advances without new tokens.
    if (pruneUsageDaily(next.daily)) {
      ensureDir(path.dirname(file));
      writeJson(file, next);
    }
    return next;
  }

  if (!opts?.skipLifetime) {
    next.lifetime = addTokenUsage(next.lifetime, u);
    const day = localUsageDay();
    next.daily[day] = addTokenUsage(next.daily[day] ?? emptyTokenUsage(), u);
  }

  const owners = new Set<string>([ownerId, ...(opts?.alsoOwnerIds ?? [])].filter(Boolean));
  for (const id of owners) {
    next.byOwner[id] = addTokenUsage(next.byOwner[id] ?? emptyTokenUsage(), u);
  }

  pruneUsageDaily(next.daily);
  ensureDir(path.dirname(file));
  writeJson(file, next);
  return next;
}

/** Drop byOwner entry when a bot/squad is deleted (lifetime/daily kept). */
export function removeOwnerUsage(file: string, ownerId: string): UsageStats {
  const next = loadUsageStats(file);
  const id = (ownerId || '').trim();
  if (id && id in next.byOwner) {
    delete next.byOwner[id];
  }
  pruneUsageDaily(next.daily);
  ensureDir(path.dirname(file));
  writeJson(file, next);
  return next;
}
