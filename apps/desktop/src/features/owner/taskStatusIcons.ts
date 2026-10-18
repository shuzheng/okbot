import type { TaskStatus } from '@okbot/shared';

/** Glyphs for task/step status — keep edit panel + chat open-tasks in sync. */
export const TASK_STATUS_ICON: Record<TaskStatus, string> = {
  pending: '○',
  in_progress: '◐',
  done: '✓',
  cancelled: '✕',
  failed: '!',
};
