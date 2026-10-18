import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isUlid } from '@okbot/shared';
import {
  computeNextRunAt,
  resolveScheduleTimezone,
  createScheduledJob,
  formatScheduleSpec,
  migrateSchedulesJsonToJsonl,
  normalizeSchedulesFile,
  parseCron,
  parseScheduleString,
  readSchedulesFile,
  refreshJobNextRun,
  writeSchedulesFile,
  zonedWallTimeToUtc,
  getZonedParts,
  isCronUnsatisfiable,
  cronExprError,
} from './schedules';

{
  const d = parseScheduleString('daily 09:00');
  assert.ok(!('error' in d));
  assert.deepEqual(d, { kind: 'daily', hour: 9, minute: 0 });
  assert.equal(formatScheduleSpec(d), 'daily 09:00');
}

{
  const d = parseScheduleString('每天 18:30');
  assert.ok(!('error' in d));
  assert.deepEqual(d, { kind: 'daily', hour: 18, minute: 30 });
}

{
  const h = parseScheduleString('hourly 15');
  assert.ok(!('error' in h));
  assert.deepEqual(h, { kind: 'hourly', minute: 15 });
}

{
  const c = parseScheduleString('every 15m');
  assert.ok(!('error' in c));
  assert.deepEqual(c, { kind: 'cron', expr: '*/15 * * * *' });
}

{
  const c = parseScheduleString('cron 0 9 * * 1-5');
  assert.ok(!('error' in c));
  assert.ok(parseCron('0 9 * * 1-5'));
}

assert.ok('error' in parseScheduleString(''));
assert.ok('error' in parseScheduleString('every 7m'));
assert.equal(parseCron('bad'), null);

{
  const tz = 'Asia/Shanghai';
  // 2026-03-15 08:00 Shanghai = 2026-03-15 00:00 UTC
  const after = new Date('2026-03-15T00:00:00.000Z');
  const next = computeNextRunAt({ kind: 'daily', hour: 9, minute: 0 }, tz, after);
  assert.ok(next);
  const parts = getZonedParts(next, tz);
  assert.equal(parts.hour, 9);
  assert.equal(parts.minute, 0);
  assert.equal(parts.day, 15);
  assert.ok(next.getTime() > after.getTime());
}

{
  const tz = 'Asia/Shanghai';
  // Already past 09:00 → next day
  const after = zonedWallTimeToUtc({ year: 2026, month: 3, day: 15, hour: 10, minute: 0 }, tz);
  const next = computeNextRunAt({ kind: 'daily', hour: 9, minute: 0 }, tz, after);
  assert.ok(next);
  const parts = getZonedParts(next, tz);
  assert.equal(parts.day, 16);
  assert.equal(parts.hour, 9);
}

{
  const tz = 'UTC';
  const after = new Date('2026-01-01T10:10:00.000Z');
  const next = computeNextRunAt({ kind: 'hourly', minute: 30 }, tz, after);
  assert.ok(next);
  assert.equal(next.toISOString(), '2026-01-01T10:30:00.000Z');
}

{
  const tz = 'UTC';
  const after = new Date('2026-01-01T10:00:00.000Z');
  const next = computeNextRunAt({ kind: 'cron', expr: '*/15 * * * *' }, tz, after);
  assert.ok(next);
  assert.equal(next.toISOString(), '2026-01-01T10:15:00.000Z');
}

{
  const job = createScheduledJob({
    ownerId: 'bot_x',
    prompt: '提醒喝水',
    title: '喝水',
    schedule: { kind: 'daily', hour: 9, minute: 0 },
    timezone: 'Asia/Shanghai',
    now: new Date('2026-03-15T00:00:00.000Z'),
  });
  assert.ok(isUlid(job.id), `new job id must be ULID, got ${job.id}`);
  assert.ok(job.nextRunAt);
  assert.equal(job.enabled, true);
  const paused = refreshJobNextRun({ ...job, enabled: false });
  assert.equal(paused.nextRunAt, null);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-sched-'));
  const file = path.join(root, 'schedules.jsonl');
  const job = createScheduledJob({
    ownerId: 'bot_a',
    prompt: 'hi',
    schedule: { kind: 'daily', hour: 8, minute: 0 },
    timezone: 'UTC',
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
  assert.ok(isUlid(job.id));
  writeSchedulesFile(file, { version: 1, jobs: [job] });
  assert.ok(fs.existsSync(file));
  const raw = fs.readFileSync(file, 'utf8').trim();
  assert.equal(raw.split('\n').length, 1);
  const lineObj = JSON.parse(raw) as { id?: string; jobs?: unknown };
  assert.equal(lineObj.id, job.id);
  assert.equal(lineObj.jobs, undefined, 'jsonl line must be a job, not {version,jobs}');
  const loaded = readSchedulesFile(file, 'bot_a');
  assert.equal(loaded.jobs.length, 1);
  assert.equal(loaded.jobs[0]!.prompt, 'hi');
  assert.equal(loaded.jobs[0]!.ownerId, 'bot_a');
  assert.equal(loaded.jobs[0]!.id, job.id);
  const norm = normalizeSchedulesFile({ jobs: [{ id: '', prompt: 'x' }] }, 'bot_a');
  assert.equal(norm.jobs.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
}

{
  // Legacy schedules.json → schedules.jsonl migration keeps old ids.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-sched-mig-'));
  const legacy = path.join(root, 'schedules.json');
  const jsonl = path.join(root, 'schedules.jsonl');
  const legacyJob = {
    id: 'sched_legacy_keep_me',
    ownerId: 'bot_m',
    title: '旧',
    prompt: 'migrate me',
    enabled: true,
    timezone: 'UTC',
    schedule: { kind: 'daily', hour: 7, minute: 0 },
    nextRunAt: '2026-01-02T07:00:00.000Z',
    lastRunAt: null,
    lastError: null,
    once: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  fs.writeFileSync(legacy, JSON.stringify({ version: 1, jobs: [legacyJob] }, null, 2), 'utf8');
  assert.equal(migrateSchedulesJsonToJsonl(jsonl, 'bot_m'), true);
  assert.ok(fs.existsSync(jsonl));
  assert.ok(!fs.existsSync(legacy), 'legacy schedules.json should be deleted after migrate');
  const loaded = readSchedulesFile(jsonl, 'bot_m');
  assert.equal(loaded.jobs.length, 1);
  assert.equal(loaded.jobs[0]!.id, 'sched_legacy_keep_me');
  assert.equal(loaded.jobs[0]!.prompt, 'migrate me');
  // Second call is a no-op (no leftover json).
  assert.equal(migrateSchedulesJsonToJsonl(jsonl, 'bot_m'), false);
  fs.rmSync(root, { recursive: true, force: true });
}

{
  // readSchedulesFile auto-migrates when only legacy JSON is present.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-sched-auto-'));
  const legacy = path.join(root, 'schedules.json');
  const jsonl = path.join(root, 'schedules.jsonl');
  fs.writeFileSync(
    legacy,
    JSON.stringify({
      version: 1,
      jobs: [
        {
          id: 'sched_auto_1',
          prompt: 'auto',
          enabled: true,
          timezone: '',
          schedule: { kind: 'hourly', minute: 0 },
          nextRunAt: null,
          lastRunAt: null,
          lastError: null,
          once: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }),
    'utf8',
  );
  const loaded = readSchedulesFile(jsonl, 'bot_auto');
  assert.equal(loaded.jobs.length, 1);
  assert.equal(loaded.jobs[0]!.id, 'sched_auto_1');
  assert.ok(fs.existsSync(jsonl));
  assert.ok(!fs.existsSync(legacy));
  fs.rmSync(root, { recursive: true, force: true });
}


{
  const parsed = parseCron('0 0 31 2 *');
  assert.ok(parsed);
  assert.equal(isCronUnsatisfiable(parsed), true);
  assert.ok(cronExprError('0 0 31 2 *'));
  assert.ok('error' in parseScheduleString('0 0 31 2 *'));
  const t0 = performance.now();
  const next = computeNextRunAt(
    { kind: 'cron', expr: '0 0 31 2 *' },
    'Asia/Shanghai',
    new Date('2026-01-01T00:00:00Z'),
  );
  const ms = performance.now() - t0;
  assert.equal(next, null);
  assert.ok(ms < 500, `unsatisfiable cron must not hang (took ${ms}ms)`);
}

{
  // DOM+DOW both restricted → OR (15th or Monday), not AND-only.
  const tz = 'UTC';
  const after = new Date('2026-01-01T00:00:00.000Z'); // Thursday
  const next = computeNextRunAt({ kind: 'cron', expr: '0 9 15 * 1' }, tz, after);
  assert.ok(next);
  // Next Monday 2026-01-05 09:00 UTC (before the 15th)
  assert.equal(next.toISOString(), '2026-01-05T09:00:00.000Z');
}

{
  const t0 = performance.now();
  const next = computeNextRunAt(
    { kind: 'cron', expr: '0 9 * * 1-5' },
    'Asia/Shanghai',
    new Date('2026-01-01T00:00:00Z'),
  );
  const ms = performance.now() - t0;
  assert.ok(next);
  assert.ok(ms < 200, `weekday cron should be fast (took ${ms}ms)`);
}


{
  // Empty job tz + app timezone → app zone; empty both → host local.
  assert.equal(resolveScheduleTimezone('', 'Asia/Tokyo'), 'Asia/Tokyo');
  assert.equal(resolveScheduleTimezone('UTC', 'Asia/Tokyo'), 'UTC');
  assert.equal(resolveScheduleTimezone('Not/AZone', 'Asia/Shanghai'), 'Asia/Shanghai');
  const host = resolveScheduleTimezone('', '');
  assert.ok(typeof host === 'string' && host.length > 0);
}

console.log('schedules.test.ts OK');
