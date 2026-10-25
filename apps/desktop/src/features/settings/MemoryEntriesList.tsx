import { useEffect, useRef, useState, type FocusEvent } from 'react';
import {
  createId,
  memoryExpiresFromNow,
  MEMORY_TTL_MS,
  type MemoryEntry,
} from '@okbot/shared';
import { ChevronDownIcon } from '../../components/ui/icons';
import { t, type UiLang } from '../../i18n';
import { resolveWheelPassOuter, updateScrollFade } from '../../utils/scrollFade';

/** Add-flow TTL presets (permanent + common durations). */
type MemoryTtlPreset = 'permanent' | '1d' | '7d' | '30d' | '90d';

const MEMORY_TTL_PRESET_MS: Record<Exclude<MemoryTtlPreset, 'permanent'>, number> = {
  '1d': MEMORY_TTL_MS.short,
  '7d': MEMORY_TTL_MS.medium,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': MEMORY_TTL_MS.long,
};

function expiresFromTtlPreset(preset: MemoryTtlPreset): string | null {
  if (preset === 'permanent') return null;
  return memoryExpiresFromNow(MEMORY_TTL_PRESET_MS[preset]);
}

function formatMemoryExpiryDate(iso: string, lang: UiLang): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  try {
    return new Date(ts).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function memoryExpiryLabel(lang: UiLang, expires: string | null | undefined): string {
  if (!expires) return t(lang, 'memoryExpiresPermanent');
  return t(lang, 'memoryExpiresAt', { date: formatMemoryExpiryDate(expires, lang) });
}

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

type Props = {
  lang: UiLang;
  entries: MemoryEntry[];
  /** Bump to open a blank draft row (header「添加」). */
  requestAdd?: number;
  /** When set, show an in-card Add button (bot memory tab). */
  addLabel?: string;
  emptyLabel: string;
  placeholder: string;
  /** CSS selector for the outer scroll pane (wheel passthrough at edges). */
  scrollOuterSelector?: string;
  /**
   * bot_id for newly created rows.
   * Global file rows historically store the writing bot id; Settings uses `'global'`.
   * Empty string is rejected by FileStorage.readMemoryFile — do not use.
   */
  newBotId: string;
  onCommit: (entry: MemoryEntry) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
};

export function MemoryEntriesList({
  lang,
  entries,
  requestAdd = 0,
  addLabel,
  emptyLabel,
  placeholder,
  scrollOuterSelector = '.settings-body',
  newBotId,
  onCommit,
  onDelete,
}: Props) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draftMemory, setDraftMemory] = useState('');
  /** TTL preset for the add (new-row) editor; edit keeps prior expires. */
  const [draftTtl, setDraftTtl] = useState<MemoryTtlPreset>('permanent');
  /** Expanded memory ids show full text; collapsed keep single-line ellipsis. */
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const lastRequestAdd = useRef(0);

  useEffect(() => {
    if (requestAdd > 0 && requestAdd !== lastRequestAdd.current) {
      lastRequestAdd.current = requestAdd;
      setEditingId('new');
      setDraftMemory('');
      setDraftTtl('permanent');
    }
  }, [requestAdd]);

  useEffect(() => {
    if (editingId != null) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  useEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
      if (!(atTop && e.deltaY < 0) && !(atBottom && e.deltaY > 0)) return;
      const outer = resolveWheelPassOuter(el, scrollOuterSelector);
      if (!outer || outer === el) return;
      outer.scrollTop += e.deltaY;
      updateScrollFade(outer);
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [entries.length, editingId, scrollOuterSelector]);

  const cancelEdit = () => {
    setEditingId(null);
    setDraftMemory('');
    setDraftTtl('permanent');
  };

  const saveEdit = async () => {
    const memory = draftMemory.trim();
    if (!memory) {
      cancelEdit();
      return;
    }
    if (editingId === 'new') {
      const entry: MemoryEntry = {
        id: createId('mem'),
        bot_id: newBotId,
        memory,
        expires: expiresFromTtlPreset(draftTtl),
      };
      await onCommit(entry);
    } else if (editingId) {
      const prev = entries.find((m) => m.id === editingId);
      const entry: MemoryEntry = {
        id: editingId,
        bot_id: prev?.bot_id || newBotId,
        memory,
        expires: prev?.expires ?? null,
      };
      await onCommit(entry);
    }
    cancelEdit();
  };

  const renderEditor = (key: string) => {
    const isNew = key === 'new';
    return (
      <div
        key={key}
        className="aar-item aar-item-editing aar-item-stack"
        onBlur={(e: FocusEvent<HTMLDivElement>) => {
          const next = e.relatedTarget as Node | null;
          if (next && e.currentTarget.contains(next)) return;
          if (!draftMemory.trim()) {
            cancelEdit();
            return;
          }
          void saveEdit().catch((err) => { console.error("[okbot] memory save failed", err); });
        }}
      >
        <textarea
          ref={inputRef}
          className="aar-inline-input bot-memory-input"
          spellCheck={false}
          rows={3}
          placeholder={placeholder}
          value={draftMemory}
          onChange={(e) => setDraftMemory(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
            }
          }}
          aria-label={placeholder}
        />
        <div className="memory-expiry-editor-row">
          {isNew ? (
            <span className="settings-select-chevron-host">
              <select
                className="tool-mgmt-approval-select"
                value={draftTtl}
                aria-label={t(lang, 'memoryExpirySelect')}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'permanent' || v === '1d' || v === '7d' || v === '30d' || v === '90d') {
                    setDraftTtl(v);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <option value="permanent">{t(lang, 'memoryTtlPermanent')}</option>
                <option value="1d">{t(lang, 'memoryTtl1d')}</option>
                <option value="7d">{t(lang, 'memoryTtl7d')}</option>
                <option value="30d">{t(lang, 'memoryTtl30d')}</option>
                <option value="90d">{t(lang, 'memoryTtl90d')}</option>
              </select>
            </span>
          ) : (
            <span />
          )}
          <div className="aar-item-trailing">
            <button
              type="button"
              className="model-icon-btn"
              title={t(lang, 'botMemorySave')}
              aria-label={t(lang, 'botMemorySave')}
              disabled={!draftMemory.trim()}
              onClick={() => { void saveEdit().catch((err) => { console.error("[okbot] memory save failed", err); }); }}
            >
              <CheckIcon />
            </button>
            <button
              type="button"
              className="model-icon-btn"
              title={t(lang, 'cancel')}
              aria-label={t(lang, 'cancel')}
              onClick={cancelEdit}
            >
              <XIcon />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const openNew = () => {
    setEditingId('new');
    setDraftMemory('');
    setDraftTtl('permanent');
  };

  return (
    <div className="settings-aar-inline list-card">
      {addLabel ? (
        <div className="aar-list-add-bar">
          <span className="settings-row-label">{t(lang, 'memoryList')}</span>
          <button type="button" className="settings-aar-add-btn" onClick={openNew}>
            {addLabel}
          </button>
        </div>
      ) : null}
      <div ref={listScrollRef} className="aar-list-scroll scroll-fade">
        {entries.length === 0 && editingId == null ? (
          <div className="aar-empty">{emptyLabel}</div>
        ) : null}
        {editingId === 'new' ? renderEditor('new') : null}
        {entries.map((m) =>
          editingId === m.id ? (
            renderEditor(m.id)
          ) : (
            <div
              key={m.id}
              className={`aar-item aar-item-clickable${expandedIds[m.id] ? ' is-expanded' : ''}`}
              role="button"
              tabIndex={0}
              aria-expanded={expandedIds[m.id] === true}
              onClick={() =>
                setExpandedIds((prev) => ({ ...prev, [m.id]: !prev[m.id] }))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExpandedIds((prev) => ({ ...prev, [m.id]: !prev[m.id] }));
                }
              }}
            >
              <div className="aar-item-text">
                <div className={`aar-item-title${expandedIds[m.id] ? ' is-expanded' : ''}`}>{m.memory}</div>
                {expandedIds[m.id] ? (
                  <div className="aar-item-sub">{memoryExpiryLabel(lang, m.expires)}</div>
                ) : null}
              </div>
              <div className="aar-item-trailing">
                <button
                  type="button"
                  className="model-icon-btn"
                  title={t(lang, 'botMemoryEdit')}
                  aria-label={t(lang, 'botMemoryEdit')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(m.id);
                    setDraftMemory(m.memory);
                  }}
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  className="model-icon-btn"
                  title={t(lang, 'botMemoryDelete')}
                  aria-label={t(lang, 'botMemoryDelete')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDelete(m.id);
                  }}
                >
                  <TrashIcon />
                </button>
                <button
                  type="button"
                  className={`model-icon-btn aar-expand-btn${expandedIds[m.id] ? ' expanded' : ''}`}
                  title={expandedIds[m.id] ? t(lang, 'avatarPickerCollapse') : t(lang, 'avatarPickerExpand')}
                  aria-label={expandedIds[m.id] ? t(lang, 'avatarPickerCollapse') : t(lang, 'avatarPickerExpand')}
                  aria-expanded={expandedIds[m.id] === true}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedIds((prev) => ({ ...prev, [m.id]: !prev[m.id] }));
                  }}
                >
                  <ChevronDownIcon />
                </button>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
