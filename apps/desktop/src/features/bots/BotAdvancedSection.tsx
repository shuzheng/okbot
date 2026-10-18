import { useEffect, useRef, useState } from 'react';
import { type BotSkill, type MemoryEntry } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { MemoryEntriesList } from '../settings/MemoryEntriesList';
import { SettingsToggle } from '../settings/SettingsToggle';
import { resolveWheelPassOuter, updateScrollFade } from '../../utils/scrollFade';
import { formatSystemError } from '../../utils/formatSystemError';
import { toast } from '../../components/ui';

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

function useWheelPassThrough(depKey: string | number) {
  const listScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
      if (!(atTop && e.deltaY < 0) && !(atBottom && e.deltaY > 0)) return;
      const outer = resolveWheelPassOuter(el, '.form-drawer-body');
      if (!outer || outer === el) return;
      outer.scrollTop += e.deltaY;
      updateScrollFade(outer);
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [depKey]);
  return listScrollRef;
}

type AdvancedProps = {
  lang: UiLang;
  /** Existing bot id (create flow already allocates before modal). */
  botId: string | null;
  onSoulMdChange: (text: string, touched: boolean) => void;
};

/** Details-tab Advanced: SOUL.md / 灵魂 only (memory & skills moved to their own tabs). */
export function BotAdvancedSection({ lang, botId, onSoulMdChange }: AdvancedProps) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [soulMd, setSoulMd] = useState('');

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    void (async () => {
      try {
        if (!botId) {
          if (!cancelled) {
            setSoulMd('');
            setLoaded(true);
          }
          return;
        }
        const md = await window.okbot.readSoulMd(botId);
        if (cancelled) return;
        setSoulMd(typeof md === 'string' ? md : '');
        setLoaded(true);
        onSoulMdChange(typeof md === 'string' ? md : '', false);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loaded, botId, onSoulMdChange]);

  const persistSoul = async (text: string) => {
    if (!botId) return;
    try {
      await window.okbot.writeSoulMd(botId, text);
    } catch {
      /* parent toast on apply path */
    }
  };

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
            <label>{t(lang, 'botAgentsMd')}</label>
            <textarea
              className="settings-paths-textarea bot-agents-md"
              spellCheck={false}
              rows={8}
              value={soulMd}
              disabled={!botId}
              onChange={(e) => {
                const v = e.target.value;
                setSoulMd(v);
                onSoulMdChange(v, true);
              }}
              onBlur={() => {
                onSoulMdChange(soulMd, true);
                void persistSoul(soulMd);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 记忆 tab: existing MemoryEntriesList card UI moved as-is from details Advanced. */
export function BotMemoryPanel({
  lang,
  botId,
  active,
}: {
  lang: UiLang;
  botId: string | null;
  active: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        if (!botId) {
          if (!cancelled) {
            setMemories([]);
            setLoaded(true);
          }
          return;
        }
        const mems = await window.okbot.listBotMemories(botId);
        if (cancelled) return;
        setMemories(Array.isArray(mems) ? mems : []);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, botId]);

  // Reload when switching bots while tab already loaded once.
  useEffect(() => {
    setLoaded(false);
  }, [botId]);

  const commitMemory = async (entry: MemoryEntry) => {
    if (!botId) return;
    try {
      await window.okbot.upsertBotMemory(entry);
      setMemories((list) => {
        const idx = list.findIndex((m) => m.id === entry.id);
        if (idx >= 0) {
          const next = list.slice();
          next[idx] = entry;
          return next;
        }
        return [...list, entry];
      });
    } catch (err) {
      toast.error(formatSystemError(err));
      throw err;
    }
  };

  const deleteMemory = async (id: string) => {
    if (!botId) return;
    try {
      await window.okbot.deleteBotMemory(botId, id);
      setMemories((list) => list.filter((m) => m.id !== id));
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  };

  if (!active) return null;

  if (!botId) {
    return (
      <div className="settings-aar-inline list-card">
        <div className="aar-empty">{t(lang, 'botMemoriesNeedSave')}</div>
      </div>
    );
  }
  if (!loaded) return null;
  return (
    <MemoryEntriesList
      lang={lang}
      entries={memories}
      emptyLabel={t(lang, 'botMemoriesEmpty')}
      placeholder={t(lang, 'botMemoryPlaceholder')}
      scrollOuterSelector=".form-drawer-body"
      newBotId={botId}
      onCommit={commitMemory}
      onDelete={deleteMemory}
    />
  );
}

/** 技能 tab: 私有技能 cards, then 全局技能 toggle list (moved from details Advanced). */
export function BotSkillsPanel({
  lang,
  botId,
  active,
  useGlobalSkills,
  enabledGlobalSkills,
  onGlobalSkillsChange,
}: {
  lang: UiLang;
  botId: string | null;
  active: boolean;
  useGlobalSkills: boolean;
  enabledGlobalSkills: string[];
  onGlobalSkillsChange: (next: {
    useGlobalSkills: boolean;
    enabledGlobalSkills: string[];
  }) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [skills, setSkills] = useState<BotSkill[]>([]);
  const [globalSkills, setGlobalSkills] = useState<BotSkill[]>([]);
  const [editingSkillSlug, setEditingSkillSlug] = useState<string | null>(null);
  const [draftSkillName, setDraftSkillName] = useState('');
  const [draftSkillDesc, setDraftSkillDesc] = useState('');
  const [draftSkillBody, setDraftSkillBody] = useState('');
  const skillScrollRef = useWheelPassThrough(
    `${skills.length}:${editingSkillSlug ?? ''}:${active ? 1 : 0}`,
  );
  const globalScrollRef = useWheelPassThrough(
    `${globalSkills.length}:${useGlobalSkills ? 1 : 0}:${active ? 1 : 0}`,
  );

  useEffect(() => {
    setLoaded(false);
    setEditingSkillSlug(null);
  }, [botId]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        if (!botId) {
          if (!cancelled) {
            setSkills([]);
            setGlobalSkills([]);
            setLoaded(true);
          }
          return;
        }
        const [localSkills, globals] = await Promise.all([
          window.okbot.listBotSkills(botId),
          window.okbot.listGlobalAgentsSkills(),
        ]);
        if (cancelled) return;
        setSkills(Array.isArray(localSkills) ? localSkills : []);
        setGlobalSkills(Array.isArray(globals) ? globals : []);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, botId]);

  const saveSkill = async () => {
    if (!botId || !editingSkillSlug) return;
    const name = draftSkillName.trim() || editingSkillSlug;
    const description = draftSkillDesc.trim() || name;
    const body = draftSkillBody;
    const skill: BotSkill = {
      slug: editingSkillSlug,
      name,
      description,
      body,
    };
    try {
      await window.okbot.writeBotSkill(botId, skill);
      setSkills((list) => {
        const idx = list.findIndex((s) => s.slug === skill.slug);
        if (idx >= 0) {
          const next = list.slice();
          next[idx] = skill;
          return next;
        }
        return [...list, skill].sort((a, b) => a.slug.localeCompare(b.slug));
      });
      setEditingSkillSlug(null);
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  };

  const deleteSkill = async (slug: string) => {
    if (!botId) return;
    try {
      await window.okbot.deleteBotSkill(botId, slug);
      setSkills((list) => list.filter((s) => s.slug !== slug));
      if (editingSkillSlug === slug) setEditingSkillSlug(null);
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  };

  const toggleGlobalSlug = (slug: string) => {
    const set = new Set(enabledGlobalSkills);
    if (set.has(slug)) set.delete(slug);
    else set.add(slug);
    onGlobalSkillsChange({
      useGlobalSkills,
      enabledGlobalSkills: [...set],
    });
  };

  if (!active) return null;

  return (
    <>
      {!botId ? (
        <div className="settings-aar-inline list-card">
          <div className="aar-empty">{t(lang, 'botMemoriesNeedSave')}</div>
        </div>
      ) : !loaded ? null : (
        <div className="settings-aar-inline list-card">
          <div ref={skillScrollRef} className="aar-list-scroll scroll-fade">
            {skills.length === 0 && !editingSkillSlug ? (
              <div className="aar-empty">{t(lang, 'botSkillsEmpty')}</div>
            ) : null}
            {skills.map((s) =>
              editingSkillSlug === s.slug ? (
                <div key={s.slug} className="aar-item aar-item-editing aar-item-stack">
                  <input
                    type="text"
                    className="aar-inline-input bot-skill-field"
                    spellCheck={false}
                    placeholder={t(lang, 'botSkillName')}
                    value={draftSkillName}
                    onChange={(e) => setDraftSkillName(e.target.value)}
                    aria-label={t(lang, 'botSkillName')}
                  />
                  <input
                    type="text"
                    className="aar-inline-input bot-skill-field"
                    spellCheck={false}
                    placeholder={t(lang, 'botSkillDescription')}
                    value={draftSkillDesc}
                    onChange={(e) => setDraftSkillDesc(e.target.value)}
                    aria-label={t(lang, 'botSkillDescription')}
                  />
                  <textarea
                    className="aar-inline-input bot-skill-body"
                    spellCheck={false}
                    rows={4}
                    placeholder={t(lang, 'botSkillBody')}
                    value={draftSkillBody}
                    onChange={(e) => setDraftSkillBody(e.target.value)}
                    aria-label={t(lang, 'botSkillBody')}
                  />
                  <div className="aar-item-trailing">
                    <button
                      type="button"
                      className="model-icon-btn"
                      title={t(lang, 'botSkillSave')}
                      aria-label={t(lang, 'botSkillSave')}
                      onClick={() => void saveSkill()}
                    >
                      <CheckIcon />
                    </button>
                    <button
                      type="button"
                      className="model-icon-btn"
                      title={t(lang, 'cancel')}
                      aria-label={t(lang, 'cancel')}
                      onClick={() => setEditingSkillSlug(null)}
                    >
                      <XIcon />
                    </button>
                  </div>
                </div>
              ) : (
                <div key={s.slug} className="aar-item">
                  <div className="aar-item-text">
                    <div className="aar-item-title">{s.name}</div>
                    <div className="aar-item-sub">{s.description}</div>
                  </div>
                  <div className="aar-item-trailing">
                    <button
                      type="button"
                      className="model-icon-btn"
                      title={t(lang, 'botSkillEdit')}
                      aria-label={t(lang, 'botSkillEdit')}
                      onClick={() => {
                        setEditingSkillSlug(s.slug);
                        setDraftSkillName(s.name);
                        setDraftSkillDesc(s.description);
                        setDraftSkillBody(s.body);
                      }}
                    >
                      <EditIcon />
                    </button>
                    <button
                      type="button"
                      className="model-icon-btn"
                      title={t(lang, 'botSkillDelete')}
                      aria-label={t(lang, 'botSkillDelete')}
                      onClick={() => void deleteSkill(s.slug)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      <div className="field">
        <div className="settings-row bot-global-skills-master">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'botGlobalSkills')}</span>
          </span>
          <SettingsToggle
            checked={useGlobalSkills}
            disabled={!botId}
            aria-label={t(lang, 'botGlobalSkills')}
            onChange={() =>
              onGlobalSkillsChange({
                useGlobalSkills: !useGlobalSkills,
                enabledGlobalSkills,
              })
            }
          />
        </div>
        <p className="bot-form-model-hint">{t(lang, 'botGlobalSkillsHint')}</p>
        {useGlobalSkills ? (
          <div className="settings-aar-inline list-card">
            <div ref={globalScrollRef} className="aar-list-scroll scroll-fade">
              {!botId ? (
                <div className="aar-empty">{t(lang, 'botMemoriesNeedSave')}</div>
              ) : !loaded ? null : globalSkills.length === 0 ? (
                <div className="aar-empty">{t(lang, 'botGlobalSkillsEmpty')}</div>
              ) : (
                globalSkills.map((s) => (
                  <div key={s.slug} className="aar-item">
                    <div className="aar-item-text">
                      <div className="aar-item-title">{s.name}</div>
                      <div className="aar-item-sub">{s.description}</div>
                    </div>
                    <SettingsToggle
                      checked={enabledGlobalSkills.includes(s.slug)}
                      aria-label={s.name}
                      onChange={() => toggleGlobalSlug(s.slug)}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
