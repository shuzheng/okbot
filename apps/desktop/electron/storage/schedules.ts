/**
 * Per-owner scheduled jobs (`~/.okbot/<ownerId>/schedules.json`).
 * Presets + simple 5-field cron; next-run uses IANA timezone via Intl (empty = host local).
 */
import { createId } from '@okbot/shared';
import { readJson, writeJson } from './fs';

export const SCHEDULES_FILE_VERSION = 1 as const;

export type ScheduleSpec =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'hourly'; minute: number }
  | { kind: 'cron'; expr: string };

export type ScheduledJob = {
  id: string;
  ownerId: string;
  title: string;
  prompt: string;
  enabled: boolean;
  /** IANA tz; empty = host local at compute time. */
  timezone: string;
  schedule: ScheduleSpec;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  once: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SchedulesFile = {
  version: typeof SCHEDULES_FILE_VERSION;
  jobs: ScheduledJob[];
};

export function emptySchedulesFile(): SchedulesFile {
  return { version: SCHEDULES_FILE_VERSION, jobs: [] };
}

export function normalizeSchedulesFile(raw: unknown, ownerId: string): SchedulesFile {
  const out = emptySchedulesFile();
  if (!raw || typeof raw !== 'object') return out;
  const jobsRaw = (raw as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobsRaw)) return out;
  const oid = (ownerId || '').trim();
  for (const row of jobsRaw) {
    const job = normalizeJob(row, oid);
    if (job) out.jobs.push(job);
  }
  return out;
}

function normalizeJob(raw: unknown, ownerId: string): ScheduledJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : '';
  const prompt = typeof o.prompt === 'string' ? o.prompt.trim() : '';
  if (!id || !prompt) return null;
  const schedule = normalizeScheduleSpec(o.schedule);
  if (!schedule) return null;
  const nowIso = new Date().toISOString();
  return {
    id,
    ownerId,
    title: typeof o.title === 'string' ? o.title.trim() : '',
    prompt,
    enabled: o.enabled !== false,
    timezone: typeof o.timezone === 'string' ? o.timezone.trim() : '',
    schedule,
    nextRunAt: typeof o.nextRunAt === 'string' && o.nextRunAt ? o.nextRunAt : null,
    lastRunAt: typeof o.lastRunAt === 'string' && o.lastRunAt ? o.lastRunAt : null,
    lastError: typeof o.lastError === 'string' && o.lastError ? o.lastError : null,
    once: o.once === true,
    createdAt: typeof o.createdAt === 'string' && o.createdAt ? o.createdAt : nowIso,
    updatedAt: typeof o.updatedAt === 'string' && o.updatedAt ? o.updatedAt : nowIso,
  };
}

export function normalizeScheduleSpec(raw: unknown): ScheduleSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === 'daily') {
    const hour = clampInt(o.hour, 0, 23);
    const minute = clampInt(o.minute, 0, 59);
    if (hour == null || minute == null) return null;
    return { kind: 'daily', hour, minute };
  }
  if (o.kind === 'hourly') {
    const minute = clampInt(o.minute, 0, 59);
    if (minute == null) return null;
    return { kind: 'hourly', minute };
  }
  if (o.kind === 'cron') {
    const expr = typeof o.expr === 'string' ? o.expr.trim() : '';
    if (!expr || cronExprError(expr)) return null;
    return { kind: 'cron', expr };
  }
  return null;
}

function clampInt(raw: unknown, min: number, max: number): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < min || i > max) return null;
  return i;
}

/** Parse tool `schedule` string → spec. */
export function parseScheduleString(input: string): ScheduleSpec | { error: string } {
  const s = (input || '').trim();
  if (!s) return { error: 'schedule 不能为空' };

  const cronDirect = s.match(/^cron\s+(.+)$/i);
  if (cronDirect) {
    const expr = cronDirect[1]!.trim();
    const bad = cronExprError(expr);
    if (bad) return { error: bad };
    return { kind: 'cron', expr };
  }
  if (s.split(/\s+/).length === 5) {
    const bad = cronExprError(s);
    if (!bad) return { kind: 'cron', expr: s };
    // Fall through to other parsers only when it is not a 5-field cron attempt
    // that failed for unsatisfiable/invalid reasons — still report cron errors.
    if (parseCron(s) || /[*,\/-]/.test(s) || /^\d/.test(s)) {
      return { error: bad };
    }
  }

  const daily =
    s.match(/^(?:daily|every\s*day|每天|每日)\s*(?:at\s*)?(\d{1,2})[:：.](\d{2})\s*$/i) ||
    s.match(/^(?:daily|every\s*day|每天|每日)\s*(?:at\s*)?(\d{1,2})\s*$/i);
  if (daily) {
    const hour = clampInt(daily[1], 0, 23);
    const minute = daily[2] != null ? clampInt(daily[2], 0, 59) : 0;
    if (hour == null || minute == null) return { error: `无效每日时间：${s}` };
    return { kind: 'daily', hour, minute };
  }

  const hourly = s.match(/^(?:hourly|每小时)(?:\s*(?::|：)?\s*(\d{1,2}))?\s*$/i);
  if (hourly) {
    const minute = hourly[1] != null ? clampInt(hourly[1], 0, 59) : 0;
    if (minute == null) return { error: `无效每小时分钟：${s}` };
    return { kind: 'hourly', minute };
  }

  const everyMin = s.match(/^(?:every|每)\s*(\d{1,3})\s*(?:m|min|mins|minutes|分钟)\s*$/i);
  if (everyMin) {
    const n = clampInt(everyMin[1], 1, 59);
    if (n == null) return { error: `无效间隔：${s}` };
    if (60 % n !== 0) {
      return { error: '每隔 N 分钟时 N 须整除 60（如 1/2/3/4/5/6/10/12/15/20/30）' };
    }
    return { kind: 'cron', expr: `*/${n} * * * *` };
  }

  const everyHour = s.match(/^(?:every|每)\s*(\d{1,2})\s*(?:h|hr|hrs|hour|hours|小时)\s*$/i);
  if (everyHour) {
    const n = clampInt(everyHour[1], 1, 23);
    if (n == null) return { error: `无效间隔：${s}` };
    return { kind: 'cron', expr: `0 */${n} * * *` };
  }

  return {
    error:
      '无法解析 schedule。示例：daily 09:00、每天 09:00、hourly、hourly 30、every 15m、cron 0 9 * * 1-5',
  };
}

export function formatScheduleSpec(spec: ScheduleSpec): string {
  if (spec.kind === 'daily') return `daily ${pad2(spec.hour)}:${pad2(spec.minute)}`;
  if (spec.kind === 'hourly') return spec.minute === 0 ? 'hourly' : `hourly ${pad2(spec.minute)}`;
  return `cron ${spec.expr}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

type CronField = { any: true } | { values: Set<number> };
type CronParsed = {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
};

export function parseCron(expr: string): CronParsed | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseCronField(parts[0]!, 0, 59);
  const hour = parseCronField(parts[1]!, 0, 23);
  const dom = parseCronField(parts[2]!, 1, 31);
  const month = parseCronField(parts[3]!, 1, 12);
  const dow = parseCronField(parts[4]!, 0, 7, true);
  if (!minute || !hour || !dom || !month || !dow) return null;
  return { minute, hour, dom, month, dow };
}

function parseCronField(raw: string, min: number, max: number, sun7 = false): CronField | null {
  const s = raw.trim();
  if (s === '*') return { any: true };
  const values = new Set<number>();
  for (const piece of s.split(',')) {
    const stepMatch = piece.match(/^(?:\*|(\d+)-(\d+))\/(\d+)$/);
    if (stepMatch) {
      const lo = stepMatch[1] != null ? Number(stepMatch[1]) : min;
      const hi = stepMatch[2] != null ? Number(stepMatch[2]) : max;
      const step = Number(stepMatch[3]);
      if (![lo, hi, step].every(Number.isFinite) || step < 1 || lo < min || hi > max || lo > hi) {
        return null;
      }
      for (let v = lo; v <= hi; v += step) values.add(sun7 && v === 7 ? 0 : v);
      continue;
    }
    const range = piece.match(/^(\d+)-(\d+)$/);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (![lo, hi].every(Number.isFinite) || lo < min || hi > max || lo > hi) return null;
      for (let v = lo; v <= hi; v++) values.add(sun7 && v === 7 ? 0 : v);
      continue;
    }
    if (!/^\d+$/.test(piece)) return null;
    const n = Number(piece);
    if (!Number.isFinite(n) || n < min || n > max) return null;
    values.add(sun7 && n === 7 ? 0 : n);
  }
  if (values.size === 0) return null;
  return { values };
}

function fieldMatch(field: CronField, value: number): boolean {
  return 'any' in field && field.any === true ? true : 'values' in field && field.values.has(value);
}

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function resolveScheduleTimezone(tz: string | undefined | null): string {
  const t = (tz || '').trim();
  if (t) {
    try {
      Intl.DateTimeFormat('en-US', { timeZone: t }).format(new Date());
      return t;
    } catch {
      /* fall through */
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_MAP[map.weekday || ''] ?? 0,
  };
}

/** UTC instant whose wall clock in `timeZone` is Y-M-D H:M:00. */
export function zonedWallTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  for (let i = 0; i < 8; i++) {
    const got = getZonedParts(new Date(guess), timeZone);
    const gotAsUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
    const wantAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    const delta = wantAsUtc - gotAsUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

function addCalendarDays(
  y: number,
  m: number,
  d: number,
  days: number,
): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function fieldIsAny(field: CronField): boolean {
  return 'any' in field && field.any === true;
}

function expandCronField(field: CronField, min: number, max: number): number[] {
  if (fieldIsAny(field)) {
    const out: number[] = [];
    for (let v = min; v <= max; v++) out.push(v);
    return out;
  }
  const values = 'values' in field ? field.values : new Set<number>();
  return [...values].filter((v) => v >= min && v <= max).sort((a, b) => a - b);
}

function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Vixie cron: when both day-of-month and day-of-week are restricted (not `*`),
 * match if either matches; otherwise AND.
 */
function cronDomDowMatch(cron: CronParsed, day: number, weekday: number): boolean {
  const domAny = fieldIsAny(cron.dom);
  const dowAny = fieldIsAny(cron.dow);
  const domOk = domAny || ('values' in cron.dom && cron.dom.values.has(day));
  const dowOk = dowAny || ('values' in cron.dow && cron.dow.values.has(weekday));
  if (!domAny && !dowAny) return domOk || dowOk;
  return domOk && dowOk;
}

/** True when no calendar date can satisfy month+DOM (DOW-unrestricted). */
export function isCronUnsatisfiable(cron: CronParsed): boolean {
  if (!fieldIsAny(cron.dow)) return false; // OR with weekday can still fire
  if (fieldIsAny(cron.dom)) return false;
  const months = expandCronField(cron.month, 1, 12);
  const doms = expandCronField(cron.dom, 1, 31);
  if (!months.length || !doms.length) return true;
  // Leap year so Feb 29 is considered possible.
  for (const month of months) {
    const dim = daysInCalendarMonth(2024, month);
    if (doms.some((d) => d >= 1 && d <= dim)) return false;
  }
  return true;
}

/** Human error for invalid / unsatisfiable 5-field cron, or null if ok. */
export function cronExprError(expr: string): string | null {
  const parsed = parseCron(expr);
  if (!parsed) return `无效 cron（需 5 段：分 时 日 月 周）：${expr}`;
  if (isCronUnsatisfiable(parsed)) {
    return `无法满足的 cron（日与月组合不存在）：${expr}`;
  }
  return null;
}

/**
 * Next fire strictly after `after`.
 * Cron uses step-based calendar walk (not minute-by-minute) so bad expressions
 * fail fast instead of freezing the main process for ~13s.
 */
export function computeNextRunAt(
  schedule: ScheduleSpec,
  timezone: string,
  after: Date = new Date(),
): Date | null {
  const tz = resolveScheduleTimezone(timezone);
  if (schedule.kind === 'daily') {
    const parts = getZonedParts(after, tz);
    const candidate = zonedWallTimeToUtc(
      { year: parts.year, month: parts.month, day: parts.day, hour: schedule.hour, minute: schedule.minute },
      tz,
    );
    if (candidate.getTime() > after.getTime()) return candidate;
    const next = addCalendarDays(parts.year, parts.month, parts.day, 1);
    return zonedWallTimeToUtc(
      { year: next.year, month: next.month, day: next.day, hour: schedule.hour, minute: schedule.minute },
      tz,
    );
  }
  if (schedule.kind === 'hourly') {
    const parts = getZonedParts(after, tz);
    let candidate = zonedWallTimeToUtc(
      {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        minute: schedule.minute,
      },
      tz,
    );
    if (candidate.getTime() > after.getTime()) return candidate;
    if (parts.hour < 23) {
      candidate = zonedWallTimeToUtc(
        {
          year: parts.year,
          month: parts.month,
          day: parts.day,
          hour: parts.hour + 1,
          minute: schedule.minute,
        },
        tz,
      );
      if (candidate.getTime() > after.getTime()) return candidate;
    }
    const next = addCalendarDays(parts.year, parts.month, parts.day, 1);
    return zonedWallTimeToUtc(
      { year: next.year, month: next.month, day: next.day, hour: 0, minute: schedule.minute },
      tz,
    );
  }
  const parsed = parseCron(schedule.expr);
  if (!parsed || isCronUnsatisfiable(parsed)) return null;
  return nextCron(parsed, tz, after);
}

function nextCron(cron: CronParsed, tz: string, after: Date): Date | null {
  const minutes = expandCronField(cron.minute, 0, 59);
  const hours = expandCronField(cron.hour, 0, 23);
  const monthSet = new Set(expandCronField(cron.month, 1, 12));
  if (!minutes.length || !hours.length || monthSet.size === 0) return null;

  const start = getZonedParts(new Date(after.getTime() + 60_000), tz);
  let year = start.year;
  let month = start.month;
  let day = start.day;
  let hour = start.hour;
  let minute = start.minute;

  for (let daySteps = 0; daySteps < 400; daySteps++) {
    if (!monthSet.has(month)) {
      // Jump to the next allowed month (same year or later).
      let advanced = false;
      for (let guard = 0; guard < 30 && !advanced; guard++) {
        const nextMonths = [...monthSet].filter((m) => m > month).sort((a, b) => a - b);
        if (nextMonths.length) {
          month = nextMonths[0]!;
          day = 1;
          hour = 0;
          minute = 0;
          advanced = true;
        } else {
          year += 1;
          month = 0;
          day = 1;
          hour = 0;
          minute = 0;
          const first = Math.min(...monthSet);
          month = first;
          advanced = true;
        }
      }
      if (!advanced) return null;
      continue;
    }

    const dim = daysInCalendarMonth(year, month);
    if (day > dim) {
      const next = addCalendarDays(year, month, dim, 1);
      year = next.year;
      month = next.month;
      day = next.day;
      hour = 0;
      minute = 0;
      continue;
    }

    const probe = zonedWallTimeToUtc({ year, month, day, hour: 12, minute: 0 }, tz);
    const weekday = getZonedParts(probe, tz).weekday;
    if (!cronDomDowMatch(cron, day, weekday)) {
      const next = addCalendarDays(year, month, day, 1);
      year = next.year;
      month = next.month;
      day = next.day;
      hour = 0;
      minute = 0;
      continue;
    }

    for (const h of hours) {
      if (h < hour) continue;
      for (const mi of minutes) {
        if (h === hour && mi < minute) continue;
        const cand = zonedWallTimeToUtc({ year, month, day, hour: h, minute: mi }, tz);
        if (cand.getTime() <= after.getTime()) continue;
        const got = getZonedParts(cand, tz);
        // Skip DST gaps / mismatches.
        if (
          got.year === year &&
          got.month === month &&
          got.day === day &&
          got.hour === h &&
          got.minute === mi
        ) {
          return cand;
        }
      }
    }

    const next = addCalendarDays(year, month, day, 1);
    year = next.year;
    month = next.month;
    day = next.day;
    hour = 0;
    minute = 0;
  }
  return null;
}

export function refreshJobNextRun(job: ScheduledJob, after: Date = new Date()): ScheduledJob {
  if (!job.enabled) return { ...job, nextRunAt: null };
  const next = computeNextRunAt(job.schedule, job.timezone, after);
  return { ...job, nextRunAt: next ? next.toISOString() : null };
}

export function createScheduledJob(input: {
  ownerId: string;
  prompt: string;
  title?: string;
  schedule: ScheduleSpec;
  timezone?: string;
  once?: boolean;
  now?: Date;
}): ScheduledJob {
  const now = input.now ?? new Date();
  const iso = now.toISOString();
  const base: ScheduledJob = {
    id: createId('sched'),
    ownerId: (input.ownerId || '').trim(),
    title: (input.title || '').trim(),
    prompt: input.prompt.trim(),
    enabled: true,
    timezone: (input.timezone || '').trim(),
    schedule: input.schedule,
    nextRunAt: null,
    lastRunAt: null,
    lastError: null,
    once: input.once === true,
    createdAt: iso,
    updatedAt: iso,
  };
  return refreshJobNextRun(base, now);
}

export function readSchedulesFile(filePath: string, ownerId: string): SchedulesFile {
  return normalizeSchedulesFile(readJson<unknown>(filePath, emptySchedulesFile()), ownerId);
}

export function writeSchedulesFile(filePath: string, data: SchedulesFile): void {
  writeJson(filePath, { version: SCHEDULES_FILE_VERSION, jobs: data.jobs });
}

export function formatJobSummary(job: ScheduledJob): string {
  const title = job.title || '(无标题)';
  const state = job.enabled ? '启用' : '暂停';
  const once = job.once ? '，一次性' : '';
  const tz = job.timezone || '系统本地';
  return [
    `- id=${job.id}`,
    `  标题: ${title}`,
    `  状态: ${state}${once}`,
    `  日程: ${formatScheduleSpec(job.schedule)}（${tz}）`,
    `  下次: ${job.nextRunAt || '—'}`,
    `  上次: ${job.lastRunAt || '—'}`,
    job.lastError ? `  错误: ${job.lastError}` : null,
    `  提示词: ${job.prompt.length > 120 ? `${job.prompt.slice(0, 120)}…` : job.prompt}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatScheduledTurnText(job: ScheduledJob): string {
  const head = job.title ? `【定时：${job.title}】` : '【定时】';
  return `${head}\n${job.prompt}`;
}
