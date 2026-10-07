import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeNextRunAt,
  createScheduledJob,
  formatScheduleSpec,
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
  assert.ok(job.id.startsWith('sched_'));
  assert.ok(job.nextRunAt);
  assert.equal(job.enabled, true);
  const paused = refreshJobNextRun({ ...job, enabled: false });
  assert.equal(paused.nextRunAt, null);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-sched-'));
  const file = path.join(root, 'schedules.json');
  const job = createScheduledJob({
    ownerId: 'bot_a',
    prompt: 'hi',
    schedule: { kind: 'daily', hour: 8, minute: 0 },
    timezone: 'UTC',
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
  writeSchedulesFile(file, { version: 1, jobs: [job] });
  const loaded = readSchedulesFile(file, 'bot_a');
  assert.equal(loaded.jobs.length, 1);
  assert.equal(loaded.jobs[0]!.prompt, 'hi');
  assert.equal(loaded.jobs[0]!.ownerId, 'bot_a');
  const norm = normalizeSchedulesFile({ jobs: [{ id: '', prompt: 'x' }] }, 'bot_a');
  assert.equal(norm.jobs.length, 0);
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

console.log('schedules.test.ts OK');
