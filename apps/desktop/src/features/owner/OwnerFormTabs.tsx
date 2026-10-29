import type { UiLang } from '../../i18n';
import { t } from '../../i18n';
import { SlidingPillTabs } from '../../components/ui';

export type OwnerFormTab =
  | 'details'
  | 'tasks'
  | 'automation'
  | 'memory'
  | 'skills'
  | 'resources';

/** Default tabs for squads (no memory/skills). Bots pass BOT_OWNER_FORM_TABS. */
export const DEFAULT_OWNER_FORM_TABS: OwnerFormTab[] = [
  'details',
  'tasks',
  'automation',
  'resources',
];

/** Bot edit tabs: 详情 / 任务 / 自动化 / 记忆 / 技能 / 资源 */
export const BOT_OWNER_FORM_TABS: OwnerFormTab[] = [
  'details',
  'tasks',
  'automation',
  'memory',
  'skills',
  'resources',
];

const TAB_I18N: Record<
  OwnerFormTab,
  | 'ownerFormTabDetails'
  | 'ownerFormTabTasks'
  | 'ownerFormTabAutomation'
  | 'ownerFormTabMemory'
  | 'ownerFormTabSkills'
  | 'ownerFormTabResources'
> = {
  details: 'ownerFormTabDetails',
  tasks: 'ownerFormTabTasks',
  automation: 'ownerFormTabAutomation',
  memory: 'ownerFormTabMemory',
  skills: 'ownerFormTabSkills',
  resources: 'ownerFormTabResources',
};

/**
 * Edit-modal tabs — same sliding-pill track as
 * Market 「助手 / 连接器」 (marketplace-tabs-track / marketplace-tabs-pill).
 * Default order omits 记忆/技能 (squads). Pass `tabs={BOT_OWNER_FORM_TABS}` for bots.
 */
export function OwnerFormTabs({
  lang,
  value,
  onChange,
  tabs = DEFAULT_OWNER_FORM_TABS,
}: {
  lang: UiLang;
  value: OwnerFormTab;
  onChange: (tab: OwnerFormTab) => void;
  /** Visible tabs; defaults to details/tasks/automation/resources. */
  tabs?: OwnerFormTab[];
}) {
  return (
    <SlidingPillTabs
      ariaLabel={t(lang, 'ownerFormTabs')}
      value={value}
      onChange={onChange}
      className="owner-form-tabs"
      options={tabs.map((tab) => ({
        id: tab,
        label: t(lang, TAB_I18N[tab]),
      }))}
    />
  );
}
