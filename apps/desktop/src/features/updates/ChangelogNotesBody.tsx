import type { LocalizedChangelogNotes } from '@okbot/shared';
import { MarkdownContent } from '../chat/MarkdownContent';
import type { UiLang } from '../../i18n';

/** Shared highlights + markdown body for What's New / update / settings history. */
export function ChangelogNotesBody({
  notes,
  lang,
  compact,
}: {
  notes: LocalizedChangelogNotes;
  lang: UiLang;
  /** Tighter spacing for accordion rows in Settings. */
  compact?: boolean;
}) {
  return (
    <div className={`changelog-notes${compact ? ' compact' : ''}`}>
      {notes.highlights.length > 0 ? (
        <ul className="changelog-highlights">
          {notes.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}
      {notes.bodyMarkdown.trim() ? (
        <div className="changelog-body scroll-fade">
          <MarkdownContent lang={lang}>{notes.bodyMarkdown}</MarkdownContent>
        </div>
      ) : null}
    </div>
  );
}
