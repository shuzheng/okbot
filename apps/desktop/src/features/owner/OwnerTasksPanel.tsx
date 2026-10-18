import { useCallback, useEffect, useState } from 'react';
import type { TaskRecord, TaskStatus } from '@okbot/shared';
import { ChevronDownIcon } from '../../components/ui/icons';
import { t, type UiLang } from '../../i18n';
import { OWNER_LIST_PAGE_SIZE } from './ownerListPage';
import { TASK_STATUS_ICON } from './taskStatusIcons';

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

function shortTime(iso: string | undefined): string {
  if (!iso) return '—';
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return iso;
  try {
    return new Date(d).toLocaleString();
  } catch {
    return iso;
  }
}

export function OwnerTasksPanel({
  lang,
  ownerId,
  active,
}: {
  lang: UiLang;
  ownerId: string | null | undefined;
  active: boolean;
}) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /** Step titles expand independently (task titles unwrap with the row). */
  const [expandedStepTitles, setExpandedStepTitles] = useState<Record<string, boolean>>({});
  const [visibleCount, setVisibleCount] = useState(OWNER_LIST_PAGE_SIZE);
  const id = (ownerId || '').trim();

  const reload = useCallback(async () => {
    if (!id || typeof window.okbot.listOwnerTasks !== 'function') {
      setTasks([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await window.okbot.listOwnerTasks(id);
      setTasks(Array.isArray(list) ? list : []);
    } catch (err) {
      setTasks([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!active) return;
    void reload();
  }, [active, reload]);

  useEffect(() => {
    setExpanded({});
    setExpandedStepTitles({});
    setVisibleCount(OWNER_LIST_PAGE_SIZE);
  }, [id]);

  const toggle = useCallback((taskId: string) => {
    setExpanded((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  }, []);

  const toggleStepTitle = useCallback((stepId: string) => {
    setExpandedStepTitles((prev) => ({ ...prev, [stepId]: !prev[stepId] }));
  }, []);

  const visible = tasks.slice(0, visibleCount);
  const hasMore = tasks.length > visibleCount;

  return (
    <div className="settings-aar-inline list-card">
    {!id ? (
      <div className="settings-hint">{t(lang, 'ownerFormNeedSave')}</div>
    ) : error ? (
      <div className="settings-hint" style={{ color: 'var(--danger, #c44)' }}>{error}</div>
    ) : loading && tasks.length === 0 ? (
      <div className="settings-hint">{t(lang, 'ownerFormTasksLoading')}</div>
    ) : tasks.length === 0 ? (
      <div className="settings-hint">{t(lang, 'ownerFormTasksEmpty')}</div>
    ) : (
    <>
    <ul className="owner-tasks-list">
      {visible.map((task) => {
        const title = task.title?.trim() || t(lang, 'openTaskUntitled');
        const when = shortTime(task.startedAt || task.updatedAt);
        const open = expanded[task.id] === true;
        const hasSteps = task.steps.length > 0;
        return (
          <li key={task.id} className={`owner-task-item status-${task.status}`}>
            <button
              type="button"
              className={`owner-task-row${open ? ' expanded' : ''}`}
              aria-expanded={open}
              onClick={() => toggle(task.id)}
            >
              <span
                className="owner-task-status"
                title={statusLabel(lang, task.status)}
                aria-hidden
              >
                {TASK_STATUS_ICON[task.status]}
              </span>
              <span className="owner-task-title">{title}</span>
              <span className="owner-task-time">{when}</span>
              <span className="session-owner-group-chevron" aria-hidden>
                <ChevronDownIcon />
              </span>
            </button>
            {hasSteps ? (
              <div className={`owner-task-fold${open ? ' is-open' : ''}`} aria-hidden={!open}>
                <div className="owner-task-fold-inner">
                  <ul className="owner-task-steps">
                    {task.steps.map((step) => {
                      const stepOpen = expandedStepTitles[step.id] === true;
                      return (
                        <li key={step.id} className={`owner-task-step status-${step.status}`}>
                          <button
                            type="button"
                            className={`owner-task-row owner-task-step-row${stepOpen ? ' title-expanded' : ''}`}
                            aria-expanded={stepOpen}
                            onClick={() => toggleStepTitle(step.id)}
                          >
                            <span
                              className="owner-task-status"
                              title={statusLabel(lang, step.status)}
                              aria-hidden
                            >
                              {TASK_STATUS_ICON[step.status]}
                            </span>
                            <span className={`owner-task-title${stepOpen ? ' is-expanded' : ''}`}>
                              {step.title}
                            </span>
                            <span className="owner-task-time">
                              {shortTime(step.startedAt || step.updatedAt || step.endedAt)}
                            </span>
                            <span className="owner-task-chevron-spacer" aria-hidden />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
    {hasMore ? (
      <button
        type="button"
        className="owner-list-load-more"
        onClick={() => setVisibleCount((n) => n + OWNER_LIST_PAGE_SIZE)}
      >
        {t(lang, 'ownerFormLoadMore')}
      </button>
    ) : null}
    </>
    )}
    </div>
  );
}
