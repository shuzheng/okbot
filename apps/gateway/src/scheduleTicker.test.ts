import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from './storage';
import {
  createScheduledJob,
  writeSchedulesFile,
  type ScheduledJob,
} from './storage/schedules';
import { fireScheduledJob, type ScheduleTickerDeps } from './scheduleTicker';
import {
  registerOwnerRun,
  unregisterOwnerRun,
  resetOwnerRunQueuesForTests,
  type AbortControllerMap,
} from './ipc/ownerRuns';
import type { IpcContext } from './ipc/context';

resetOwnerRunQueuesForTests();

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-sched-ticker-'));
const storage = new FileStorage(root);
const bot = storage.createBot({ name: 'SchedOnce' });

const dueAt = new Date(Date.now() - 60_000).toISOString();
const onceJob = createScheduledJob({
  ownerId: bot.id,
  prompt: 'remind me once',
  title: 'once-busy',
  schedule: { kind: 'daily', hour: 9, minute: 0 },
  once: true,
  appTimezone: 'Asia/Shanghai',
});
onceJob.nextRunAt = dueAt;
onceJob.enabled = true;

const schedPath = path.join(storage.dataRoot, bot.id, 'schedules.jsonl');
fs.mkdirSync(path.dirname(schedPath), { recursive: true });
writeSchedulesFile(schedPath, { version: 1, jobs: [onceJob] });

function readJob(): ScheduledJob {
  const jobs = storage.listScheduledJobs(bot.id);
  assert.equal(jobs.length, 1);
  return jobs[0]!;
}

{
  // once + owner busy → must NOT claim (would have disabled forever under old semantics).
  const abortControllers: AbortControllerMap = new Map();
  const ac = new AbortController();
  registerOwnerRun(abortControllers, bot.id, 'run_busy', ac);

  const deps: ScheduleTickerDeps = {
    storage,
    ctx: {
      storage,
      abortControllers,
      pendingToolApprovals: new Map(),
      hardwareAccelerationActive: true,
      sendRuntimeEvent: () => {},
      snapshotActiveRuns: () => ({ busyBotIds: [], pendingToolRequests: [] }),
      rejectPendingApprovalsForBot: () => {},
      applyTheme: () => {},
      applyWindowTranslucent: () => {},
    } as IpcContext,
  };

  const realClaim = storage.claimScheduledJobDue.bind(storage);
  let claimCalls = 0;
  (storage as { claimScheduledJobDue: FileStorage['claimScheduledJobDue'] }).claimScheduledJobDue = (
    ownerId,
    jobId,
    now,
  ) => {
    claimCalls += 1;
    return realClaim(ownerId, jobId, now);
  };

  const inflight = new Set<string>([`${bot.id}:${onceJob.id}`]);
  await fireScheduledJob(deps, readJob(), inflight, `${bot.id}:${onceJob.id}`);

  assert.equal(claimCalls, 0, 'busy owner must not claim once job');
  const still = readJob();
  assert.equal(still.enabled, true, 'once job stays enabled while busy');
  assert.equal(still.nextRunAt, dueAt, 'nextRunAt unchanged');
  assert.equal(still.lastError, null);

  unregisterOwnerRun(abortControllers, bot.id, 'run_busy', ac);
  (storage as { claimScheduledJobDue: FileStorage['claimScheduledJobDue'] }).claimScheduledJobDue =
    realClaim;

  // Claim alone must NOT disable once / clear nextRunAt (crash mid-turn catch-up).
  const claimed = storage.claimScheduledJobDue(bot.id, onceJob.id);
  assert.ok(claimed, 'once job claimable after owner idle');
  assert.equal(claimed.enabled, true, 'claim keeps once enabled');
  assert.equal(claimed.nextRunAt, dueAt, 'claim keeps nextRunAt for catch-up');
  const afterClaim = readJob();
  assert.equal(afterClaim.enabled, true);
  assert.equal(afterClaim.nextRunAt, dueAt);

  // markScheduledJobFired advances / disables once.
  const marked = storage.markScheduledJobFired(bot.id, onceJob.id, { ok: true });
  assert.ok(marked);
  assert.equal(marked.enabled, false);
  assert.equal(marked.nextRunAt, null);
  assert.ok(marked.lastRunAt);
}

{
  // Recurring: claim leaves nextRunAt; mark advances it.
  const recurring = createScheduledJob({
    ownerId: bot.id,
    prompt: 'hourly ping',
    title: 'recur',
    schedule: { kind: 'hourly', minute: 0 },
    once: false,
    appTimezone: 'Asia/Shanghai',
  });
  const past = new Date(Date.now() - 120_000).toISOString();
  recurring.nextRunAt = past;
  recurring.enabled = true;
  writeSchedulesFile(schedPath, {
    version: 1,
    jobs: [readJob(), recurring],
  });

  const snap = storage.claimScheduledJobDue(bot.id, recurring.id);
  assert.ok(snap);
  assert.equal(snap.nextRunAt, past);
  const stillDue = storage.listScheduledJobs(bot.id).find((j) => j.id === recurring.id)!;
  assert.equal(stillDue.nextRunAt, past);

  const after = storage.markScheduledJobFired(bot.id, recurring.id, { ok: false, error: 'boom' });
  assert.ok(after);
  assert.equal(after.enabled, true);
  assert.ok(after.nextRunAt);
  assert.notEqual(after.nextRunAt, past, 'recurring nextRunAt advanced after mark');
  assert.equal(after.lastError, 'boom');
}

console.log('scheduleTicker.test.ts OK');
