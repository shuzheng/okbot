import type { FileStorage } from '../storage';

export type ScheduleManageAction = 'create' | 'list' | 'pause' | 'resume' | 'delete';

export type ScheduleManageInput = {
  action: ScheduleManageAction;
  prompt?: string;
  title?: string;
  schedule?: string;
  timezone?: string;
  job_id?: string;
  once?: boolean;
};

/** Bound `manage_schedule` execute helper for one owner (bot or squad). */
export function scheduleManageForOwner(storage: FileStorage, ownerId: string) {
  return async (input: ScheduleManageInput): Promise<string> => {
    try {
      return storage.manageScheduledJobs(ownerId, {
        action: input.action,
        prompt: input.prompt,
        title: input.title,
        schedule: input.schedule,
        timezone: input.timezone,
        jobId: input.job_id,
        once: input.once,
      });
    } catch (err) {
      return `错误：${err instanceof Error ? err.message : String(err)}`;
    }
  };
}
