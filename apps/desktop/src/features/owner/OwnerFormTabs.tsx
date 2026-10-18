import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { UiLang } from '../../i18n';
import { t } from '../../i18n';

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
  const trackRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Partial<Record<OwnerFormTab, HTMLButtonElement | null>>>({});
  const [pill, setPill] = useState({ left: 0, width: 0 });

  const syncPill = useCallback(() => {
    const track = trackRef.current;
    const btn = btnRefs.current[value];
    if (!track || !btn) return;
    const trackBox = track.getBoundingClientRect();
    const btnBox = btn.getBoundingClientRect();
    setPill({ left: btnBox.left - trackBox.left, width: btnBox.width });
  }, [value]);

  useLayoutEffect(() => {
    syncPill();
  }, [syncPill, lang, tabs]);

  useEffect(() => {
    const onResize = () => syncPill();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [syncPill]);

  return (
    <div className="owner-form-tabs" role="tablist" aria-label={t(lang, 'ownerFormTabs')}>
      <div className="marketplace-tabs-track" ref={trackRef}>
        <span
          className="marketplace-tabs-pill"
          aria-hidden
          style={{
            transform: `translateX(${pill.left}px)`,
            width: pill.width ? `${pill.width}px` : undefined,
            opacity: pill.width ? 1 : 0,
          }}
        />
        {tabs.map((tab) => (
          <button
            key={tab}
            ref={(el) => {
              btnRefs.current[tab] = el;
            }}
            type="button"
            role="tab"
            aria-selected={value === tab}
            className={value === tab ? 'active' : ''}
            onClick={() => onChange(tab)}
          >
            {t(lang, TAB_I18N[tab])}
          </button>
        ))}
      </div>
    </div>
  );
}
