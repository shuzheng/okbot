import { memo, useCallback, useRef, useState } from 'react';
import type { TaskRecord, TaskStatus } from '@okbot/shared';
import { ChevronDownIcon } from '../../components/ui/icons';
import { useScrollFade } from '../../hooks/useScrollFade';
import { t, type UiLang } from '../../i18n';

export type OpenTasksPanelProps = {
  lang: UiLang;
  tasks: TaskRecord[];
};

const STATUS_ICON: Record<TaskStatus, string> = {
  pending: '○',
  in_progress: '◐',
  done: '●',
  cancelled: '✕',
  failed: '!',
};

function statusLabel(lang: UiLang, status: TaskStatus): string {
  switch (status) {
    case 'pending':
      return t(lang, 'taskStatusPending');
    case 'in_progress':
      return t(lang, 'taskStatusInProgress');
    case 'done':
      return t(lang, 'taskStatusDone');
    case 'cancelled':
      return t(lang, 'taskStatusCancelled');
    case 'failed':
      return t(lang, 'taskStatusFailed');
    default:
      return status;
  }
}

/**
 * Open (pending/in_progress) tasks above the composer.
 * Click a task to expand its steps. Done/cancelled/failed are omitted by the host.
 */
export const OpenTasksPanel = memo(function OpenTasksPanel({ lang, tasks }: OpenTasksPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLUListElement>(null);
  useScrollFade(listRef, [tasks, expanded]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  if (!tasks.length) return null;

  return (
    <div className="open-tasks-panel" role="region" aria-label={t(lang, 'openTasksTitle')}>
      <div className="open-tasks-header">
        <span className="open-tasks-title">{t(lang, 'openTasksTitle')}</span>
        <span className="open-tasks-count">{tasks.length}</span>
      </div>
      <ul ref={listRef} className="open-tasks-list scroll-fade">
        {tasks.map((task) => {
          const open = expanded[task.id] === true;
          const label = task.title?.trim() || t(lang, 'openTaskUntitled');
          return (
            <li key={task.id} className={`open-task-item status-${task.status}`}>
              <button
                type="button"
                className={`open-task-row${open ? ' expanded' : ''}`}
                aria-expanded={open}
                onClick={() => toggle(task.id)}
              >
                <span className="open-task-status" title={statusLabel(lang, task.status)} aria-hidden>
                  {STATUS_ICON[task.status]}
                </span>
                <span className="open-task-label">{label}</span>
                <span className="open-task-meta">
                  {task.steps.filter((s) => s.status === 'done').length}/{task.steps.length}
                </span>
                <span className="session-owner-group-chevron" aria-hidden>
                  <ChevronDownIcon />
                </span>
              </button>
              {task.steps.length > 0 ? (
                <div
                  className={`open-task-fold${open ? ' is-open' : ''}`}
                  aria-hidden={!open}
                >
                  <div className="open-task-fold-inner">
                    <ul className="open-task-steps">
                      {task.steps.map((step) => (
                        <li key={step.id} className={`open-task-step status-${step.status}`}>
                          <span
                            className="open-task-status"
                            title={statusLabel(lang, step.status)}
                            aria-hidden
                          >
                            {STATUS_ICON[step.status]}
                          </span>
                          <span className="open-task-step-title">{step.title}</span>
                          {step.note ? <span className="open-task-step-note">{step.note}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
});
