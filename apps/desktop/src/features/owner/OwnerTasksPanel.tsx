import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StepStatus, TaskRecord, TaskStatus } from '@okbot/shared';
import { ChevronDownIcon, TrashIcon } from '../../components/ui/icons';
import { requestConfirm } from '../../components/ui';
import { t, type UiLang } from '../../i18n';
import { OWNER_LIST_PAGE_SIZE } from './ownerListPage';
import { STEP_STATUS_ICON, TASK_STATUS_ICON } from './taskStatusIcons';

function taskStatusLabel(lang: UiLang, status: TaskStatus): string {
  switch (status) {
    case 'backlog':
      return t(lang, 'taskStatusBacklog');
    case 'pending':
      return t(lang, 'taskStatusPending');
    case 'in_progress':
      return t(lang, 'taskStatusInProgress');
    case 'done':
      return t(lang, 'taskStatusDone');
    default:
      return status;
  }
}

function stepStatusLabel(lang: UiLang, status: StepStatus): string {
  switch (status) {
    case 'pending':
      return t(lang, 'taskStatusPending');
    case 'in_progress':
      return t(lang, 'taskStatusInProgress');
    case 'blocked':
      return t(lang, 'taskStatusBlocked');
    case 'succeeded':
      return t(lang, 'taskStatusSucceeded');
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

type Phase = 'backlog' | 'active' | 'done';

function phaseOf(status: TaskStatus): Phase {
  if (status === 'backlog') return 'backlog';
  if (status === 'done') return 'done';
  return 'active'; // pending + in_progress
}

function TaskRow({
  lang,
  task,
  open,
  onToggle,
  expandedStepTitles,
  onToggleStepTitle,
  onDelete,
  deleting,
}: {
  lang: UiLang;
  task: TaskRecord;
  open: boolean;
  onToggle: () => void;
  expandedStepTitles: Record<string, boolean>;
  onToggleStepTitle: (stepId: string) => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const title = task.title?.trim() || t(lang, 'openTaskUntitled');
  const when = shortTime(task.startedAt || task.updatedAt);
  const hasSteps = task.steps.length > 0;
  return (
    <li className={`owner-task-item status-${task.status}`}>
      <div className={`owner-task-row-wrap${open ? ' expanded' : ''}`}>
        <button
          type="button"
          className={`owner-task-row${open ? ' expanded' : ''}`}
          aria-expanded={open}
          onClick={onToggle}
        >
          <span
            className="owner-task-status"
            title={taskStatusLabel(lang, task.status)}
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
        {onDelete ? (
          <button
            type="button"
            className="owner-task-delete"
            title={t(lang, 'ownerTasksDelete')}
            aria-label={t(lang, 'ownerTasksDelete')}
            disabled={deleting}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <TrashIcon />
          </button>
        ) : null}
      </div>
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
                      onClick={() => onToggleStepTitle(step.id)}
                    >
                      <span
                        className="owner-task-status"
                        title={stepStatusLabel(lang, step.status)}
                        aria-hidden
                      >
                        {STEP_STATUS_ICON[step.status]}
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
}

function PhaseSection({
  lang,
  title,
  tasks,
  expanded,
  onToggle,
  expandedStepTitles,
  onToggleStepTitle,
  onDelete,
  deletingId,
  visibleCount,
  onLoadMore,
}: {
  lang: UiLang;
  title: string;
  tasks: TaskRecord[];
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  expandedStepTitles: Record<string, boolean>;
  onToggleStepTitle: (stepId: string) => void;
  onDelete?: (task: TaskRecord) => void;
  deletingId: string | null;
  visibleCount: number;
  onLoadMore: () => void;
}) {
  if (!tasks.length) return null;
  const visible = tasks.slice(0, visibleCount);
  const hasMore = tasks.length > visibleCount;
  return (
    <section className="owner-tasks-phase">
      <h4 className="owner-tasks-phase-title">
        {title}
        <span className="owner-tasks-phase-count">{tasks.length}</span>
      </h4>
      <ul className="owner-tasks-list">
        {visible.map((task) => (
          <TaskRow
            key={task.id}
            lang={lang}
            task={task}
            open={expanded[task.id] === true}
            onToggle={() => onToggle(task.id)}
            expandedStepTitles={expandedStepTitles}
            onToggleStepTitle={onToggleStepTitle}
            onDelete={onDelete ? () => onDelete(task) : undefined}
            deleting={deletingId === task.id}
          />
        ))}
      </ul>
      {hasMore ? (
        <button
          type="button"
          className="owner-list-load-more"
          onClick={onLoadMore}
        >
          {t(lang, 'ownerFormLoadMore')}
        </button>
      ) : null}
    </section>
  );
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
  const [visibleBacklog, setVisibleBacklog] = useState(OWNER_LIST_PAGE_SIZE);
  const [visibleActive, setVisibleActive] = useState(OWNER_LIST_PAGE_SIZE);
  const [visibleDone, setVisibleDone] = useState(OWNER_LIST_PAGE_SIZE);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
    setVisibleBacklog(OWNER_LIST_PAGE_SIZE);
    setVisibleActive(OWNER_LIST_PAGE_SIZE);
    setVisibleDone(OWNER_LIST_PAGE_SIZE);
  }, [id]);

  const toggle = useCallback((taskId: string) => {
    setExpanded((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  }, []);

  const toggleStepTitle = useCallback((stepId: string) => {
    setExpandedStepTitles((prev) => ({ ...prev, [stepId]: !prev[stepId] }));
  }, []);

  const phases = useMemo(() => {
    const backlog: TaskRecord[] = [];
    const activeTasks: TaskRecord[] = [];
    const done: TaskRecord[] = [];
    for (const task of tasks) {
      const p = phaseOf(task.status);
      if (p === 'backlog') backlog.push(task);
      else if (p === 'done') done.push(task);
      else activeTasks.push(task);
    }
    return { backlog, active: activeTasks, done };
  }, [tasks]);

  const onDelete = useCallback(
    async (task: TaskRecord) => {
      if (task.status !== 'backlog' || !id) return;
      if (typeof window.okbot.deleteOwnerTask !== 'function') return;
      const ok = await requestConfirm({
        message: t(lang, 'ownerTasksDeleteConfirm'),
        confirmLabel: t(lang, 'ownerTasksDelete'),
      });
      if (!ok) return;
      setDeletingId(task.id);
      try {
        const res = await window.okbot.deleteOwnerTask(id, task.id);
        if (!res?.ok) {
          setError(res?.error || t(lang, 'ownerTasksDeleteFailed'));
        } else {
          setTasks((prev) => prev.filter((x) => x.id !== task.id));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t(lang, 'ownerTasksDeleteFailed'));
      } finally {
        setDeletingId(null);
      }
    },
    [id, lang],
  );

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
    <PhaseSection
      lang={lang}
      title={t(lang, 'ownerTasksPhaseBacklog')}
      tasks={phases.backlog}
      expanded={expanded}
      onToggle={toggle}
      expandedStepTitles={expandedStepTitles}
      onToggleStepTitle={toggleStepTitle}
      onDelete={onDelete}
      deletingId={deletingId}
      visibleCount={visibleBacklog}
      onLoadMore={() => setVisibleBacklog((n) => n + OWNER_LIST_PAGE_SIZE)}
    />
    <PhaseSection
      lang={lang}
      title={t(lang, 'ownerTasksPhaseActive')}
      tasks={phases.active}
      expanded={expanded}
      onToggle={toggle}
      expandedStepTitles={expandedStepTitles}
      onToggleStepTitle={toggleStepTitle}
      deletingId={deletingId}
      visibleCount={visibleActive}
      onLoadMore={() => setVisibleActive((n) => n + OWNER_LIST_PAGE_SIZE)}
    />
    <PhaseSection
      lang={lang}
      title={t(lang, 'ownerTasksPhaseDone')}
      tasks={phases.done}
      expanded={expanded}
      onToggle={toggle}
      expandedStepTitles={expandedStepTitles}
      onToggleStepTitle={toggleStepTitle}
      deletingId={deletingId}
      visibleCount={visibleDone}
      onLoadMore={() => setVisibleDone((n) => n + OWNER_LIST_PAGE_SIZE)}
    />
    </>
    )}
    </div>
  );
}
