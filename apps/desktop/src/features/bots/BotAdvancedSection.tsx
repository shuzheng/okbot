import { useEffect, useRef, useState } from 'react';
import { type BotSkill, type MemoryEntry } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { MemoryEntriesList } from '../settings/MemoryEntriesList';
import { SettingsToggle } from '../settings/SettingsToggle';
import { updateScrollFade } from '../../utils/scrollFade';
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
      const outer =
        el.closest('.form-drawer-body') || el.closest('.modal');
      if (!(outer instanceof HTMLElement)) return;
      outer.scrollTop += e.deltaY;
      updateScrollFade(outer);
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [depKey]);
  return listScrollRef;
}

type Props = {
  lang: UiLang;
  /** Existing bot id (create flow already allocates before modal). */
  botId: string | null;
  useGlobalSkills: boolean;
  enabledGlobalSkills: string[];
  onAgentsMdChange: (text: string, touched: boolean) => void;
  onGlobalSkillsChange: (next: {
    useGlobalSkills: boolean;
    enabledGlobalSkills: string[];
  }) => void;
};

export function BotAdvancedSection({
  lang,
  botId,
  useGlobalSkills,
  enabledGlobalSkills,
  onAgentsMdChange,
  onGlobalSkillsChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [agentsMd, setAgentsMd] = useState('');
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [skills, setSkills] = useState<BotSkill[]>([]);
  const [globalSkills, setGlobalSkills] = useState<BotSkill[]>([]);
  const [editingSkillSlug, setEditingSkillSlug] = useState<string | null>(null);
  const [draftSkillName, setDraftSkillName] = useState('');
  const [draftSkillDesc, setDraftSkillDesc] = useState('');
  const [draftSkillBody, setDraftSkillBody] = useState('');
  const skillScrollRef = useWheelPassThrough(
    `${skills.length}:${editingSkillSlug ?? ''}:${open ? 1 : 0}`,
  );
  const globalScrollRef = useWheelPassThrough(
    `${globalSkills.length}:${useGlobalSkills ? 1 : 0}:${open ? 1 : 0}`,
  );

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    void (async () => {
      try {
        if (!botId) {
          if (!cancelled) {
            setAgentsMd('');
            setMemories([]);
            setSkills([]);
            setGlobalSkills([]);
            setLoaded(true);
          }
          return;
        }
        const [md, mems, localSkills, globals] = await Promise.all([
          window.okbot.readAgentsMd(botId),
          window.okbot.listBotMemories(botId),
          window.okbot.listBotSkills(botId),
          window.okbot.listGlobalAgentsSkills(),
        ]);
        if (cancelled) return;
        setAgentsMd(typeof md === 'string' ? md : '');
        setMemories(Array.isArray(mems) ? mems : []);
        setSkills(Array.isArray(localSkills) ? localSkills : []);
        setGlobalSkills(Array.isArray(globals) ? globals : []);
        setLoaded(true);
        onAgentsMdChange(typeof md === 'string' ? md : '', false);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loaded, botId, onAgentsMdChange]);

  const persistAgents = async (text: string) => {
    if (!botId) return;
    try {
      await window.okbot.writeAgentsMd(botId, text);
    } catch {
      /* parent toast on apply path */
    }
  };

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
            <p className="bot-form-model-hint">{t(lang, 'botAgentsMdHint')}</p>
            <textarea
              className="settings-paths-textarea bot-agents-md"
              spellCheck={false}
              rows={8}
              value={agentsMd}
              disabled={!botId}
              onChange={(e) => {
                const v = e.target.value;
                setAgentsMd(v);
                onAgentsMdChange(v, true);
              }}
              onBlur={() => {
                onAgentsMdChange(agentsMd, true);
                void persistAgents(agentsMd);
              }}
            />
          </div>

          <div className="field">
            <label>{t(lang, 'botMemories')}</label>
            {!botId ? (
              <div className="aar-empty">{t(lang, 'botMemoriesNeedSave')}</div>
            ) : (
              <MemoryEntriesList
                lang={lang}
                entries={memories}
                emptyLabel={t(lang, 'botMemoriesEmpty')}
                placeholder={t(lang, 'botMemoryPlaceholder')}
                scrollOuterSelector=".modal"
                newBotId={botId}
                onCommit={commitMemory}
                onDelete={deleteMemory}
              />
            )}
          </div>

          <div className="field">
            <label>{t(lang, 'botSkills')}</label>
            {!botId ? (
              <div className="aar-empty">{t(lang, 'botMemoriesNeedSave')}</div>
            ) : (
              <div className="settings-aar-inline">
                <div ref={skillScrollRef} className="aar-list-scroll scroll-fade">
                  {skills.length === 0 && !editingSkillSlug ? (
                    <div className="aar-empty">{t(lang, 'botSkillsEmpty')}</div>
                  ) : null}
                  {skills.map((s) =>
                    editingSkillSlug === s.slug ? (
                      <div key={s.slug} className="aar-item aar-item-editing aar-item-stack">
                        <input
                          type="text"
                          className="aar-inline-input"
                          spellCheck={false}
                          placeholder={t(lang, 'botSkillName')}
                          value={draftSkillName}
                          onChange={(e) => setDraftSkillName(e.target.value)}
                          aria-label={t(lang, 'botSkillName')}
                        />
                        <input
                          type="text"
                          className="aar-inline-input"
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
          </div>

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
              <div className="settings-aar-inline">
                <div ref={globalScrollRef} className="aar-list-scroll scroll-fade">
                  {!botId ? (
                    <div className="aar-empty">{t(lang, 'botMemoriesNeedSave')}</div>
                  ) : globalSkills.length === 0 ? (
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

        </div>
      ) : null}
    </div>
  );
}
