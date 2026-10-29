import {
  type ScheduledJobInfo,
} from '@okbot/shared';
import { assertSafeOwnerSegment } from './ids';
import {
  type ScheduledJob,
  type SchedulesFile,
  createScheduledJob,
  formatJobSummary,
  formatScheduleSpec,
  parseScheduleString,
  readSchedulesFile,
  refreshJobNextRun,
  writeSchedulesFile,
} from './schedules';
import type { OwnerLifecycle } from './ownerLifecycle';
import type { Bot, Squad } from '@okbot/shared';
import path from 'node:path';

export type ScheduleStoreDeps = {
  ownerDir(ownerId: string): string;
  ensureChatLayout(ownerId: string): void;
  assertKnownOwnerId(ownerId: string): void;
  listBots(): Bot[];
  listSquads(): Squad[];
  /** settings.timezone (empty = auto). Used when a job omits timezone. */
  getAppTimezone(): string;
};

/** Per-owner schedules.jsonl wiring (logic lives in schedules.ts). */
export class ScheduleStore {
  constructor(
    private readonly life: OwnerLifecycle,
    private readonly deps: ScheduleStoreDeps,
  ) {}

  private appTimezone(): string {
    try {
      return (this.deps.getAppTimezone() || '').trim();
    } catch {
      return '';
    }
  }

  /** `~/.okbot/<ownerId>/schedules.jsonl` */
  private schedulesFile(ownerId: string): string {
    return path.join(this.deps.ownerDir(ownerId), 'schedules.jsonl');
  }

  listScheduledJobs(ownerId: string): ScheduledJob[] {
    const id = assertSafeOwnerSegment(ownerId);
    this.deps.assertKnownOwnerId(id);
    this.deps.ensureChatLayout(id);
    return readSchedulesFile(this.schedulesFile(id), id).jobs;
  }

  private writeScheduledJobs(ownerId: string, jobs: ScheduledJob[]): ScheduledJob[] {
    const id = assertSafeOwnerSegment(ownerId);
    this.deps.assertKnownOwnerId(id);
    this.deps.ensureChatLayout(id);
    const now = new Date().toISOString();
    const next: SchedulesFile = {
      version: 1,
      jobs: jobs.map((j) => ({ ...j, ownerId: id, updatedAt: j.updatedAt || now })),
    };
    writeSchedulesFile(this.schedulesFile(id), next);
    return next.jobs;
  }

  /**
   * Create / list / pause / resume / delete scheduled jobs for one owner.
   * Returns a Chinese summary string for the model tool.
   */
  manageScheduledJobs(
    ownerId: string,
    input: {
      action: 'create' | 'list' | 'pause' | 'resume' | 'delete';
      prompt?: string;
      title?: string;
      schedule?: string;
      timezone?: string;
      jobId?: string;
      once?: boolean;
    },
  ): string {
    const id = assertSafeOwnerSegment(ownerId);
    this.deps.assertKnownOwnerId(id);
    this.deps.ensureChatLayout(id);
    const action = input.action;
    let jobs = readSchedulesFile(this.schedulesFile(id), id).jobs;

    const findJob = (jobId?: string, title?: string): ScheduledJob | null => {
      const jid = (jobId || '').trim();
      if (jid) {
        const hit = jobs.find((j) => j.id === jid);
        if (hit) return hit;
      }
      const t = (title || '').trim();
      if (t) {
        const hits = jobs.filter((j) => j.title === t);
        if (hits.length === 1) return hits[0]!;
        if (hits.length > 1) return null;
      }
      return null;
    };

    if (action === 'list') {
      if (!jobs.length) return '（当前会话没有定时任务）';
      return ['定时任务列表：', ...jobs.map((j) => formatJobSummary(j))].join('\n');
    }

    if (action === 'create') {
      const prompt = (input.prompt || '').trim();
      if (!prompt) return '错误：create 需要 prompt';
      if (jobs.length >= 50) return '错误：每个助手/小队最多 50 个定时任务';
      const parsed = parseScheduleString(input.schedule || '');
      if ('error' in parsed) return `错误：${parsed.error}`;
      const job = createScheduledJob({
        ownerId: id,
        prompt,
        title: input.title,
        schedule: parsed,
        timezone: input.timezone,
        appTimezone: this.appTimezone(),
        once: input.once === true,
      });
      if (!job.nextRunAt) {
        return '错误：无法计算下次运行时间（日程可能无法满足，请检查 cron / 时区）';
      }
      jobs = [...jobs, job];
      this.writeScheduledJobs(id, jobs);
      return ['已创建定时任务：', formatJobSummary(job)].join('\n');
    }

    if (action === 'pause' || action === 'resume' || action === 'delete') {
      const job = findJob(input.jobId, input.title);
      if (!job) {
        if ((input.title || '').trim() && jobs.filter((j) => j.title === (input.title || '').trim()).length > 1) {
          return '错误：同名任务不唯一，请传 job_id';
        }
        return '错误：未找到任务（请传 job_id，或 list 后重试）';
      }
      if (action === 'delete') {
        jobs = jobs.filter((j) => j.id !== job.id);
        this.writeScheduledJobs(id, jobs);
        return `已删除定时任务 ${job.id}${job.title ? `（${job.title}）` : ''}`;
      }
      const enabled = action === 'resume';
      const now = new Date();
      jobs = jobs.map((j) => {
        if (j.id !== job.id) return j;
        const next = refreshJobNextRun(
          { ...j, enabled, updatedAt: now.toISOString(), lastError: enabled ? j.lastError : j.lastError },
          now,
          this.appTimezone(),
        );
        return next;
      });
      this.writeScheduledJobs(id, jobs);
      const updated = jobs.find((j) => j.id === job.id)!;
      return [`已${enabled ? '恢复' : '暂停'}定时任务：`, formatJobSummary(updated)].join('\n');
    }

    return '错误：未知 action';
  }

  /** Settings / gateway: every job with owner display name. */
  listAllScheduledJobInfos(): ScheduledJobInfo[] {
    const out: ScheduledJobInfo[] = [];
    const push = (
      ownerId: string,
      ownerName: string,
      ownerKind: 'bot' | 'squad',
      jobs: ScheduledJob[],
    ) => {
      for (const j of jobs) {
        out.push({
          id: j.id,
          ownerId,
          ownerName,
          ownerKind,
          title: j.title,
          prompt: j.prompt,
          enabled: j.enabled,
          timezone: j.timezone,
          scheduleLabel: formatScheduleSpec(j.schedule),
          nextRunAt: j.nextRunAt,
          lastRunAt: j.lastRunAt,
          lastError: j.lastError,
          once: j.once,
          createdAt: j.createdAt || '',
        });
      }
    };
    for (const b of this.deps.listBots()) {
      try {
        push(b.id, b.name || b.id, 'bot', this.listScheduledJobs(b.id));
      } catch {
        /* skip */
      }
    }
    for (const s of this.deps.listSquads()) {
      try {
        push(s.id, s.name || s.id, 'squad', this.listScheduledJobs(s.id));
      } catch {
        /* skip */
      }
    }
    out.sort((a, b) => {
      const ae = a.enabled === b.enabled ? 0 : a.enabled ? -1 : 1;
      if (ae !== 0) return ae;
      return (a.nextRunAt || '').localeCompare(b.nextRunAt || '');
    });
    return out;
  }

  /** All enabled jobs across bots/squads (for the process ticker). */
  listAllEnabledScheduledJobs(): ScheduledJob[] {
    const out: ScheduledJob[] = [];
    for (const b of this.deps.listBots()) {
      try {
        for (const j of this.listScheduledJobs(b.id)) {
          if (j.enabled) out.push(j);
        }
      } catch {
        /* skip missing */
      }
    }
    for (const s of this.deps.listSquads()) {
      try {
        for (const j of this.listScheduledJobs(s.id)) {
          if (j.enabled) out.push(j);
        }
      } catch {
        /* skip missing */
      }
    }
    return out;
  }

  /**
   * Claim a due job for firing: verifies due+enabled and returns a snapshot.
   * Does **not** advance nextRunAt or disable `once` — that happens in
   * {@link markScheduledJobFired} after the turn ends, so a crash mid-turn
   * still leaves nextRunAt in the past for catch-up. Same-minute stacking is
   * prevented by the ticker's in-memory inflight set (held until fire completes).
   */
  claimScheduledJobDue(ownerId: string, jobId: string, now: Date = new Date()): ScheduledJob | null {
    const id = assertSafeOwnerSegment(ownerId);
    this.deps.assertKnownOwnerId(id);
    const jobs = readSchedulesFile(this.schedulesFile(id), id).jobs;
    const idx = jobs.findIndex((j) => j.id === jobId);
    if (idx < 0) return null;
    const job = { ...jobs[idx]! };
    if (!job.enabled) return null;
    if (!job.nextRunAt || Date.parse(job.nextRunAt) > now.getTime()) return null;
    return job;
  }

  /**
   * After a claimed fire completes (ok or fail): record lastRunAt / lastError,
   * then advance nextRunAt (or disable when once).
   */
  markScheduledJobFired(
    ownerId: string,
    jobId: string,
    result: { ok: boolean; error?: string; firedAt?: Date },
  ): ScheduledJob | null {
    const id = assertSafeOwnerSegment(ownerId);
    this.deps.assertKnownOwnerId(id);
    const jobs = readSchedulesFile(this.schedulesFile(id), id).jobs;
    const idx = jobs.findIndex((j) => j.id === jobId);
    if (idx < 0) return null;
    const firedAt = result.firedAt ?? new Date();
    let job = { ...jobs[idx]! };
    job.lastRunAt = firedAt.toISOString();
    job.lastError = result.ok ? null : (result.error || 'failed').slice(0, 500);
    job.updatedAt = firedAt.toISOString();
    if (job.once) {
      job.enabled = false;
      job.nextRunAt = null;
    } else {
      job = refreshJobNextRun(job, firedAt, this.appTimezone());
    }
    jobs[idx] = job;
    this.writeScheduledJobs(id, jobs);
    return job;
  }
}
