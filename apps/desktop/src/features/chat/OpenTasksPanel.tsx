import { memo, useCallback, useRef, useState } from 'react';
import type { TaskRecord, TaskStatus } from '@okbot/shared';
import { ChevronDownIcon } from '../../components/ui/icons';
import { useScrollFade } from '../../hooks/useScrollFade';
import { t, type UiLang } from '../../i18n';
import { TASK_STATUS_ICON } from '../owner/taskStatusIcons';

export type OpenTasksPanelProps = {
  lang: UiLang;
  tasks: TaskRecord[];
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
 * All unfinished (pending/in_progress) tasks above the composer — not just the current one.
 * Header stays in flow (default collapsed). Expanding the list opens an absolute overlay
 * upward above the header so chat messages are not pushed; list/steps use drawer frost glass.
 * Each task expands/collapses its steps (default expanded when the list is shown);
 * per-task chevron matches sidebar.
 */
export const OpenTasksPanel = memo(function OpenTasksPanel({ lang, tasks }: OpenTasksPanelProps) {
  const [listOpen, setListOpen] = useState(false);
  /** Per-task steps: missing key = expanded (default). Explicit false = user collapsed. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLUListElement>(null);
  useScrollFade(listRef, [tasks, expanded, listOpen]);

  const toggleList = useCallback(() => {
    setListOpen((v) => !v);
  }, []);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const isOpen = prev[id] !== false;
      return { ...prev, [id]: !isOpen };
    });
  }, []);

  if (!tasks.length) return null;

  return (
    <div className="open-tasks-panel" role="region" aria-label={t(lang, 'openTasksTitle')}>
      <button
        type="button"
        className={`open-tasks-header${listOpen ? ' expanded' : ''}`}
        aria-expanded={listOpen}
        onClick={toggleList}
      >
        <span className="open-tasks-title">{t(lang, 'openTasksTitle')}</span>
        <span className="open-tasks-count">{tasks.length}</span>
        <span className="session-owner-group-chevron" aria-hidden>
          <ChevronDownIcon />
        </span>
      </button>
      <div
        className={`open-tasks-list-fold${listOpen ? ' is-open' : ''}`}
        aria-hidden={!listOpen}
      >
        <div className="open-tasks-list-fold-inner">
          <ul ref={listRef} className="open-tasks-list scroll-fade">
            {tasks.map((task) => {
              const open = expanded[task.id] !== false;
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
                      {TASK_STATUS_ICON[task.status]}
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
                                {TASK_STATUS_ICON[step.status]}
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
      </div>
    </div>
  );
});
