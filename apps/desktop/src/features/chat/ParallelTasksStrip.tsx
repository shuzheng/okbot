import { useEffect, useState } from 'react';
import { t, type UiLang } from '../../i18n';

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

function truncateLabel(text: string, max = 28): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one || '…';
  return `${one.slice(0, max - 1)}…`;
}

function statusLabel(lang: UiLang, status: ParallelTaskStatus): string {
  if (status === 'awaiting_approval') return t(lang, 'parallelTaskAwaiting');
  if (status === 'wrapping_up') return t(lang, 'parallelTaskWrapping');
  return t(lang, 'parallelTaskRunning');
}

function formatElapsed(startedAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ParallelTasksStrip({
  lang,
  tasks,
  onJump,
}: {
  lang: UiLang;
  tasks: ParallelTask[];
  onJump: (task: ParallelTask) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (tasks.length < 2) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tasks.length]);

  if (tasks.length < 2) return null;

  return (
    <div className="parallel-tasks-strip" role="status" aria-label={t(lang, 'parallelTasksTitle')}>
      <div className="parallel-tasks-head">
        <span className="parallel-tasks-title">{t(lang, 'parallelTasksTitle')}</span>
        <span className="parallel-tasks-count">{t(lang, 'parallelTasksCount', { n: String(tasks.length) })}</span>
      </div>
      <ul className="parallel-tasks-list">
        {tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              className={`parallel-task-chip status-${task.status}`}
              title={task.label}
              onClick={() => onJump(task)}
            >
              <span className="parallel-task-dot" aria-hidden />
              <span className="parallel-task-label">{truncateLabel(task.label)}</span>
              <span className="parallel-task-meta">
                {statusLabel(lang, task.status)}
                <span className="parallel-task-elapsed">{formatElapsed(task.startedAt, now)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function upsertParallelTask(
  list: ParallelTask[],
  patch: Partial<ParallelTask> & { id: string },
): ParallelTask[] {
  const idx = list.findIndex((t) => t.id === patch.id || (patch.runId && t.runId === patch.runId) || (patch.clientTurnId && t.clientTurnId === patch.clientTurnId));
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
