import type { StepStatus, TaskStatus } from '@okbot/shared';

/** Glyphs for task status — keep edit panel + chat open-tasks in sync. */
export const TASK_STATUS_ICON: Record<TaskStatus, string> = {
  backlog: '▢',
  pending: '○',
  in_progress: '◐',
  done: '✓',
};

/** Glyphs for step status. */
export const STEP_STATUS_ICON: Record<StepStatus, string> = {
  pending: '○',
  in_progress: '◐',
  blocked: '⏸',
  succeeded: '✓',
  failed: '!',
  cancelled: '✕',
};

export type TaskOrStepStatus = TaskStatus | StepStatus;

export function statusIcon(status: TaskOrStepStatus): string {
  if (status in TASK_STATUS_ICON) return TASK_STATUS_ICON[status as TaskStatus];
  if (status in STEP_STATUS_ICON) return STEP_STATUS_ICON[status as StepStatus];
  return '?';
}
