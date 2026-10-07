import { useCallback, useEffect, useState } from 'react';
import type { ScheduledJobInfo } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';

type Props = {
  lang: UiLang;
  /** When true (or when ownerId is set and parent is open), refresh. */
  active: boolean;
  /** When set, only jobs for this bot/squad are shown (edit assistant / squad UI). */
  ownerId?: string | null;
  /** Skip the long settings hint (edit panels use a shorter label above). */
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

export function SchedulesList({ lang, active, ownerId, compact }: Props) {
  const [jobs, setJobs] = useState<ScheduledJobInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const filterOwner = (ownerId || '').trim();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await window.okbot.listScheduledJobs();
      const all = Array.isArray(list) ? list : [];
      setJobs(filterOwner ? all.filter((j) => j.ownerId === filterOwner) : all);
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

  return (
    <div className="settings-card" data-settings-id={filterOwner ? undefined : 'scheduledJobsList'}>
      {compact ? null : (
        <div className="settings-hint" style={{ marginBottom: 8 }}>
          {t(lang, 'scheduledJobsHint')}
        </div>
      )}
      {error ? (
        <div className="settings-hint" style={{ color: 'var(--danger, #c44)', marginBottom: 8 }}>
          {error}
        </div>
      ) : null}
      {loading && jobs.length === 0 ? (
        <div className="settings-hint">{t(lang, 'scheduledJobsLoading')}</div>
      ) : jobs.length === 0 ? (
        <div className="settings-hint">{t(lang, 'scheduledJobsEmpty')}</div>
      ) : (
        <ul className="schedules-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {jobs.map((job) => {
            const title = job.title.trim() || t(lang, 'scheduledJobsUntitled');
            const ownerLabel =
              job.ownerKind === 'squad'
                ? `${t(lang, 'scheduledJobsSquad')}: ${job.ownerName}`
                : `${t(lang, 'scheduledJobsBot')}: ${job.ownerName}`;
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
                    {filterOwner ? null : (
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
                  </div>
                  <div className="settings-hint" style={{ marginTop: 2 }}>
                    {job.prompt.length > 160 ? `${job.prompt.slice(0, 160)}…` : job.prompt}
                  </div>
                </div>
                <div className="tool-mgmt-controls" style={{ gap: 6 }}>
                  {job.enabled ? (
                    <button
                      type="button"
                      className="settings-inline-link"
                      disabled={busyKey !== null}
                      onClick={() => void act(job, 'pause')}
                    >
                      {t(lang, 'scheduledJobsPause')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="settings-inline-link"
                      disabled={busyKey !== null}
                      onClick={() => void act(job, 'resume')}
                    >
                      {t(lang, 'scheduledJobsResume')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="settings-inline-link"
                    disabled={busyKey !== null}
                    onClick={() => {
                      if (!window.confirm(t(lang, 'scheduledJobsDeleteConfirm'))) return;
                      void act(job, 'delete');
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
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="settings-inline-link"
          disabled={loading || busyKey !== null}
          onClick={() => void reload()}
        >
          {t(lang, 'scheduledJobsRefresh')}
        </button>
      </div>
    </div>
  );
}
