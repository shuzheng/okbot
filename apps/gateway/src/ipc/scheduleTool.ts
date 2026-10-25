import type { FileStorage } from '../storage';

export type ScheduleManageAction = 'create' | 'list' | 'pause' | 'resume' | 'delete';

export type ScheduleManageInput = {
  action: ScheduleManageAction;
  prompt?: string | null;
  title?: string | null;
  schedule?: string | null;
  timezone?: string | null;
  job_id?: string | null;
  once?: boolean | null;
};

/** Bound `manage_schedule` execute helper for one owner (bot or squad). */
export function scheduleManageForOwner(storage: FileStorage, ownerId: string) {
  return async (input: ScheduleManageInput): Promise<string> => {
    try {
      return storage.manageScheduledJobs(ownerId, {
        action: input.action,
        prompt: input.prompt ?? undefined,
        title: input.title ?? undefined,
        schedule: input.schedule ?? undefined,
        timezone: input.timezone ?? undefined,
        jobId: input.job_id ?? undefined,
        once: input.once ?? undefined,
      });
    } catch (err) {
      return `错误：${err instanceof Error ? err.message : String(err)}`;
    }
  };
}
