import { useState } from 'react';
import { t, type UiLang } from '../../i18n';
import { SchedulesList } from '../settings/SchedulesList';

type Props = {
  lang: UiLang;
  /** Existing squad id (create flow may not have one yet). */
  squadId: string | null;
};

/** Collapsible Advanced block (schedules), matching BotAdvancedSection chrome. */
export function SquadAdvancedSection({ lang, squadId }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bot-advanced">
      <button
        type="button"
        className={`bot-advanced-toggle${open ? ' open' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{t(lang, 'botAdvanced')}</span>
        <span className={`bot-advanced-chevron${open ? ' open' : ''}`} aria-hidden>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path
              d="M8 10l4 4 4-4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="bot-advanced-body">
          <div className="field">
            <label>{t(lang, 'scheduledJobsList')}</label>
            <SchedulesList lang={lang} active={Boolean(squadId)} compact ownerId={squadId} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
