import type { TaskRecord, TaskStatus } from '@okbot/shared';
import type { FileStorage } from '../storage';
import { formatTasksForPrompt } from '../storage/TaskProgressStore';

export type TaskProgressManageAction = 'add' | 'update' | 'list';

export type TaskProgressManageInput = {
  action: TaskProgressManageAction;
  /** Task id (required for update). */
  id?: string | null;
  title?: string | null;
  note?: string | null;
  status?: TaskStatus | null;
  steps?: Array<{
    id?: string | null;
    title: string;
    status?: TaskStatus | null;
    note?: string | null;
  }> | null;
  /** update: patch one step by id (or unique step_title). */
  step_id?: string | null;
  step_title?: string | null;
  step_status?: TaskStatus | null;
  step_note?: string | null;
  step_new_title?: string | null;
  /** list: when true, include done/cancelled/failed history. Default false = open only. */
  include_done?: boolean | null;
};

function formatOne(task: TaskRecord): string {
  return formatTasksForPrompt([task]) || `任务 ${task.id}`;
}

/** Bound `manage_task_progress` execute helper for one owner (bot or squad). */
export function taskProgressManageForOwner(storage: FileStorage, ownerId: string) {
  return async (input: TaskProgressManageInput): Promise<string> => {
    try {
      switch (input.action) {
        case 'list': {
          const all = storage.loadTasks(ownerId);
          const tasks = input.include_done ? all : all.filter((t) => t.status === 'pending' || t.status === 'in_progress');
          if (!tasks.length) {
            return input.include_done ? '当前没有任务记录。' : '当前没有未完成任务。';
          }
          return formatTasksForPrompt(tasks) || '当前没有任务。';
        }
        case 'add': {
          const steps = (input.steps || []).map((it) => ({
            id: it.id ?? undefined,
            title: it.title,
            status: it.status ?? undefined,
            note: it.note ?? undefined,
          }));
          if (!steps.length && !(input.title || '').trim()) {
            return '错误：add 需要 title 和/或至少一项 steps（title 必填）。';
          }
          const task = storage.addTask(ownerId, {
            id: input.id ?? undefined,
            title: input.title ?? undefined,
            note: input.note ?? undefined,
            status: input.status ?? undefined,
            steps,
          });
          return `已添加任务（${task.id}）。\n${formatOne(task)}`;
        }
        case 'update': {
          const id = (input.id || '').trim();
          if (!id) return '错误：update 需要任务 id。';
          const task = storage.updateTask(ownerId, {
            id,
            title: input.title ?? undefined,
            note: input.note ?? undefined,
            status: input.status ?? undefined,
            steps: input.steps
              ? input.steps.map((it) => ({
                  id: it.id ?? undefined,
                  title: it.title,
                  status: it.status ?? undefined,
                  note: it.note ?? undefined,
                }))
              : undefined,
            step_id: input.step_id ?? undefined,
            step_title: input.step_title ?? undefined,
            step_status: input.step_status ?? undefined,
            step_note: input.step_note ?? undefined,
            step_new_title: input.step_new_title ?? undefined,
          });
          return `已更新任务（${task.id}）。\n${formatOne(task)}`;
        }
        default:
          return `错误：未知 action「${String((input as { action?: string }).action || '')}」。请用 add / update / list。`;
      }
    } catch (err) {
      return `错误：${err instanceof Error ? err.message : String(err)}`;
    }
  };
}
