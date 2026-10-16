import type { UiLang } from '../../i18n';

export type ParallelTaskStatus = 'running' | 'awaiting_approval' | 'wrapping_up';

export type ParallelTask = {
  /** Stable key: clientTurnId or runId. */
  id: string;
  runId?: string;
  clientTurnId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  label: string;
  status: ParallelTaskStatus;
  startedAt: number;
};

/**
 * Formerly showed「进行中的任务 N 个」chips for program-forked parallel composer
 * runs. Composer now appends into one soft-steered run; hide the strip.
 * Upsert helpers remain for event plumbing / schedule-api infra.
 */
export function ParallelTasksStrip(_props: {
  lang: UiLang;
  tasks: ParallelTask[];
  onJump: (task: ParallelTask) => void;
}) {
  return null;
}

export function upsertParallelTask(
  list: ParallelTask[],
  patch: Partial<ParallelTask> & { id: string },
): ParallelTask[] {
  const idx = list.findIndex(
    (t) =>
      t.id === patch.id ||
      (patch.runId && t.runId === patch.runId) ||
      (patch.clientTurnId && t.clientTurnId === patch.clientTurnId),
  );
  if (idx < 0) {
    return [
      ...list,
      {
        id: patch.id,
        label: patch.label || '…',
        status: patch.status || 'running',
        startedAt: patch.startedAt || Date.now(),
        runId: patch.runId,
        clientTurnId: patch.clientTurnId,
        userMessageId: patch.userMessageId,
        assistantMessageId: patch.assistantMessageId,
      },
    ];
  }
  const next = [...list];
  next[idx] = { ...next[idx]!, ...patch, id: next[idx]!.id };
  return next;
}

export function removeParallelTask(
  list: ParallelTask[],
  match: { id?: string; runId?: string; clientTurnId?: string },
): ParallelTask[] {
  return list.filter((t) => {
    if (match.id && t.id === match.id) return false;
    if (match.runId && t.runId === match.runId) return false;
    if (match.clientTurnId && t.clientTurnId === match.clientTurnId) return false;
    return true;
  });
}
