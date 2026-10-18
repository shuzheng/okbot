import type { UiLang } from '../../i18n';

type Props = {
  lang: UiLang;
  /** Existing squad id (create flow may not have one yet). */
  squadId: string | null;
};

/**
 * Formerly held schedules (now under OwnerFormTabs → 自动化).
 * Kept as a no-op export so callers can drop the import gradually.
 */
export function SquadAdvancedSection(_props: Props) {
  return null;
}
