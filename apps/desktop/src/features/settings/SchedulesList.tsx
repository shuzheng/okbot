import { useCallback, useEffect, useState } from 'react';
import type { ScheduledJobInfo } from '@okbot/shared';
import { TrashIcon } from '../../components/ui/icons';
import { t, type UiLang } from '../../i18n';
import { requestConfirm } from '../../components/ui';
import { SettingsToggle } from './SettingsToggle';

type Props = {
  lang: UiLang;
  /** When true (or when ownerId is set and parent is open), refresh. */
  active: boolean;
  /** When set, only jobs for this bot/squad are shown (edit assistant / squad UI). */
  ownerId?: string | null;
  /** Reserved for denser edit-panel layout (no extra chrome). */
  compact?: boolean;
};

function shortIso(iso: string | null): string {
  if (!iso) return '—';
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return iso;
  try {
    return new Date(d).toLocaleString();
  } catch {
    return iso;
  }
}

export function SchedulesList({ lang, active, ownerId, compact: _compact }: Props) {
  const [jobs, setJobs] = useState<ScheduledJobInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const filterOwner = (ownerId || '').trim();
  /** Edit 自动化 tab: toggle + icon delete, no「已暂停」badge, full-width description. */
  const editMode = Boolean(filterOwner);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await window.okbot.listScheduledJobs();
      const all = Array.isArray(list) ? list : [];
      const filtered = filterOwner ? all.filter((j) => j.ownerId === filterOwner) : all;
      // Edit 自动化 tab: newest created first. Settings page keeps enabled/nextRun order.
      const next = filterOwner
        ? [...filtered].sort((a, b) => {
            const c = (b.createdAt || '').localeCompare(a.createdAt || '');
            if (c !== 0) return c;
            return (b.id || '').localeCompare(a.id || '');
          })
        : filtered;
      setJobs(next);
    } catch (err) {
      setJobs([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filterOwner]);

  useEffect(() => {
    if (!active) return;
    void reload();
  }, [active, reload]);

  // Re-fetch when the drawer stays open but the window regains focus / tab becomes visible
  // (e.g. a schedule was created or edited in chat meanwhile).
  useEffect(() => {
    if (!active) return;
    const onVis = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    const onFocus = () => {
      void reload();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [active, reload]);

  const act = async (job: ScheduledJobInfo, action: 'pause' | 'resume' | 'delete') => {
    const key = `${job.ownerId}:${job.id}:${action}`;
    setBusyKey(key);
    setError(null);
    try {
      await window.okbot.manageScheduledJob({
        ownerId: job.ownerId,
        jobId: job.id,
        action,
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  };

  const busy = busyKey !== null;

  return (
    <div
      className={editMode ? 'settings-aar-inline list-card' : 'settings-card'}
      data-settings-id={filterOwner ? undefined : 'scheduledJobsList'}
    >
      {error ? (
        <div className="settings-hint" style={{ color: 'var(--danger, #c44)', marginBottom: 8 }}>
          {error}
        </div>
      ) : null}
      {loading && jobs.length === 0 ? (
        <div className="settings-hint">{t(lang, 'scheduledJobsLoading')}</div>
      ) : jobs.length === 0 ? (
        <div className="settings-hint">
          {t(lang, editMode ? 'ownerFormAutomationEmpty' : 'scheduledJobsEmpty')}
        </div>
      ) : (
        <ul className={`schedules-list${editMode ? ' schedules-list-edit' : ''}`}>
          {jobs.map((job) => {
            const title = job.title.trim() || t(lang, 'scheduledJobsUntitled');
            const ownerLabel =
              job.ownerKind === 'squad'
                ? `${t(lang, 'scheduledJobsSquad')}: ${job.ownerName}`
                : `${t(lang, 'scheduledJobsBot')}: ${job.ownerName}`;
            const meta = (
              <>
                {editMode ? null : (
                  <>
                    {ownerLabel}
                    {' · '}
                  </>
                )}
                {job.scheduleLabel}
                {job.timezone ? ` (${job.timezone})` : ''}
                {' · '}
                {t(lang, 'scheduledJobsNext')}: {shortIso(job.nextRunAt)}
                {job.lastError ? ` · ${t(lang, 'scheduledJobsError')}: ${job.lastError}` : ''}
              </>
            );
            const prompt =
              job.prompt.length > 160 ? `${job.prompt.slice(0, 160)}…` : job.prompt;

            if (editMode) {
              return (
                <li key={`${job.ownerId}:${job.id}`} className="schedule-edit-row">
                  <div className="schedule-edit-head">
                    <div className="settings-row-label schedule-edit-title">
                      {title}
                      {job.once ? ` · ${t(lang, 'scheduledJobsOnce')}` : ''}
                    </div>
                    <div className="schedule-edit-controls">
                      <SettingsToggle
                        checked={job.enabled}
                        disabled={busy}
                        aria-label={
                          job.enabled
                            ? t(lang, 'scheduledJobsPause')
                            : t(lang, 'scheduledJobsResume')
                        }
                        onChange={() => {
                          void act(job, job.enabled ? 'pause' : 'resume');
                        }}
                      />
                      <button
                        type="button"
                        className="model-icon-btn"
                        disabled={busy}
                        title={t(lang, 'scheduledJobsDelete')}
                        aria-label={t(lang, 'scheduledJobsDelete')}
                        onClick={() => {
                          void (async () => {
                            const ok = await requestConfirm({
                              message: t(lang, editMode ? 'ownerFormAutomationDeleteConfirm' : 'scheduledJobsDeleteConfirm'),
                              confirmLabel: t(lang, 'scheduledJobsDelete'),
                              cancelLabel: t(lang, 'cancel'),
                              danger: true,
                            });
                            if (!ok) return;
                            await act(job, 'delete');
                          })();
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                  <div className="settings-hint schedule-edit-meta">{meta}</div>
                  <div className="settings-hint schedule-edit-prompt">{prompt}</div>
                </li>
              );
            }

            return (
              <li
                key={`${job.ownerId}:${job.id}`}
                className="settings-row"
                style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}
              >
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div className="settings-row-label">
                    {title}
                    {job.once ? ` · ${t(lang, 'scheduledJobsOnce')}` : ''}
                    {!job.enabled ? ` · ${t(lang, 'scheduledJobsPaused')}` : ''}
                  </div>
                  <div className="settings-hint" style={{ marginTop: 2 }}>
                    {meta}
                  </div>
                  <div className="settings-hint" style={{ marginTop: 2 }}>
                    {prompt}
                  </div>
                </div>
                <div className="tool-mgmt-controls" style={{ gap: 6 }}>
                  {job.enabled ? (
                    <button
                      type="button"
                      className="settings-inline-link"
                      disabled={busy}
                      onClick={() => void act(job, 'pause')}
                    >
                      {t(lang, 'scheduledJobsPause')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="settings-inline-link"
                      disabled={busy}
                      onClick={() => void act(job, 'resume')}
                    >
                      {t(lang, 'scheduledJobsResume')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="settings-inline-link"
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        const ok = await requestConfirm({
                          message: t(lang, editMode ? 'ownerFormAutomationDeleteConfirm' : 'scheduledJobsDeleteConfirm'),
                          confirmLabel: t(lang, 'scheduledJobsDelete'),
                          cancelLabel: t(lang, 'cancel'),
                          danger: true,
                        });
                        if (!ok) return;
                        await act(job, 'delete');
                      })();
                    }}
                  >
                    {t(lang, 'scheduledJobsDelete')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
