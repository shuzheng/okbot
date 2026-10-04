import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { createId, type MemoryEntry } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { updateScrollFade } from '../../utils/scrollFade';

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
  emptyLabel,
  placeholder,
  scrollOuterSelector = '.settings-body',
  newBotId,
  onCommit,
  onDelete,
}: Props) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draftMemory, setDraftMemory] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const lastRequestAdd = useRef(0);

  useEffect(() => {
    if (requestAdd > 0 && requestAdd !== lastRequestAdd.current) {
      lastRequestAdd.current = requestAdd;
      setEditingId('new');
      setDraftMemory('');
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
      const outer = el.closest(scrollOuterSelector);
      if (!(outer instanceof HTMLElement)) return;
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
        expires: null,
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

  const renderEditor = (key: string) => (
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
  );

  return (
    <div className="settings-aar-inline">
      <div ref={listScrollRef} className="aar-list-scroll scroll-fade">
        {entries.length === 0 && editingId == null ? (
          <div className="aar-empty">{emptyLabel}</div>
        ) : null}
        {editingId === 'new' ? renderEditor('new') : null}
        {entries.map((m) =>
          editingId === m.id ? (
            renderEditor(m.id)
          ) : (
            <div key={m.id} className="aar-item">
              <div className="aar-item-text">
                <div className="aar-item-title">{m.memory}</div>
                {m.expires ? <div className="aar-item-sub">{m.expires}</div> : null}
              </div>
              <div className="aar-item-trailing">
                <button
                  type="button"
                  className="model-icon-btn"
                  title={t(lang, 'botMemoryEdit')}
                  aria-label={t(lang, 'botMemoryEdit')}
                  onClick={() => {
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
                  onClick={() => void onDelete(m.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
