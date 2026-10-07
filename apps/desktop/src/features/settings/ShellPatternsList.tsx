import { useEffect, useRef, useState, type FocusEvent } from 'react';
import {
  createId,
  tryCompileShellPattern,
  type DangerousShellPattern,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { updateScrollFade } from '../../utils/scrollFade';

type Props = {
  lang: UiLang;
  patterns: DangerousShellPattern[];
  onChange: (patterns: DangerousShellPattern[]) => void;
  disabled?: boolean;
  requestAdd?: number;
};

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

export function ShellPatternsList({
  lang,
  patterns,
  onChange,
  disabled = false,
  requestAdd = 0,
}: Props) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draftPattern, setDraftPattern] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const patternInputRef = useRef<HTMLInputElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const lastRequestAdd = useRef(0);

  const patternInvalid =
    draftPattern.trim().length > 0 && tryCompileShellPattern(draftPattern) == null;

  useEffect(() => {
    if (requestAdd > 0 && requestAdd !== lastRequestAdd.current) {
      lastRequestAdd.current = requestAdd;
      if (disabled) return;
      setEditingId('new');
      setDraftPattern('');
      setDraftLabel('');
    }
  }, [requestAdd, disabled]);

  useEffect(() => {
    if (editingId != null) {
      patternInputRef.current?.focus();
      patternInputRef.current?.select();
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
      const outer = el.closest('.settings-body');
      if (!(outer instanceof HTMLElement)) return;
      outer.scrollTop += e.deltaY;
      updateScrollFade(outer);
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [patterns.length, editingId]);

  const startEdit = (row: DangerousShellPattern) => {
    if (disabled) return;
    setEditingId(row.id);
    setDraftPattern(row.pattern);
    setDraftLabel(row.label ?? '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftPattern('');
    setDraftLabel('');
  };

  const saveEdit = () => {
    const pattern = draftPattern.trim();
    if (!pattern || patternInvalid) return;
    const label = draftLabel.trim();
    if (editingId === 'new') {
      const created: DangerousShellPattern = label
        ? { id: createId('sp'), pattern, label }
        : { id: createId('sp'), pattern };
      onChange([...patterns, created]);
    } else if (editingId) {
      onChange(
        patterns.map((p) =>
          p.id === editingId
            ? label
              ? { id: p.id, pattern, label }
              : { id: p.id, pattern }
            : p,
        ),
      );
    }
    cancelEdit();
  };

  const deleteRow = (id: string) => {
    if (disabled) return;
    onChange(patterns.filter((p) => p.id !== id));
    if (editingId === id) cancelEdit();
  };

  const renderEditorRow = (key: string) => {
    const canSave = draftPattern.trim().length > 0 && !patternInvalid;
    const commitOrDiscardOnBlur = (e: FocusEvent<HTMLDivElement>) => {
      const next = e.relatedTarget as Node | null;
      if (next && e.currentTarget.contains(next)) return;
      const pattern = draftPattern.trim();
      if (!pattern) {
        cancelEdit();
        return;
      }
      if (patternInvalid) return;
      saveEdit();
    };
    return (
      <div
        key={key}
        className="aar-item aar-item-editing shell-pattern-item-editing"
        onBlur={commitOrDiscardOnBlur}
      >
        <div className="shell-pattern-edit-fields">
          <input
            ref={patternInputRef}
            type="text"
            className={`aar-inline-input${patternInvalid ? ' invalid' : ''}`}
            spellCheck={false}
            placeholder={t(lang, 'securityShellPatternPlaceholder')}
            value={draftPattern}
            onChange={(e) => setDraftPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                saveEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
              }
            }}
            aria-invalid={patternInvalid}
            aria-label={t(lang, 'securityShellPatternField')}
          />
          <input
            type="text"
            className="aar-inline-input"
            spellCheck={false}
            placeholder={t(lang, 'securityShellLabelPlaceholder')}
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                saveEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
              }
            }}
            aria-label={t(lang, 'securityShellLabelField')}
          />
          {patternInvalid ? (
            <div className="shell-pattern-invalid-hint">{t(lang, 'securityShellPatternInvalid')}</div>
          ) : null}
        </div>
        <div className="aar-item-trailing">
          <button
            type="button"
            className="model-icon-btn"
            title={t(lang, 'securityShellPatternSave')}
            aria-label={t(lang, 'securityShellPatternSave')}
            disabled={!canSave}
            onClick={saveEdit}
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
  };

  const showEmpty = patterns.length === 0 && editingId !== 'new';

  return (
    <div className="settings-aar-inline settings-shell-patterns-inline">
      <div ref={listScrollRef} className="aar-list-scroll scroll-fade">
        {showEmpty ? <div className="aar-empty">{t(lang, 'securityShellPatternsEmpty')}</div> : null}
        {patterns.map((row) =>
          editingId === row.id ? (
            renderEditorRow(row.id)
          ) : (
            <div key={row.id} className="aar-item">
              <div className="aar-item-text">
                <div className="aar-item-title">
                  {row.label?.trim() || row.pattern}
                </div>
                {row.label?.trim() ? (
                  <div className="aar-item-sub shell-pattern-source">{row.pattern}</div>
                ) : null}
              </div>
              <div className="aar-item-trailing">
                <button
                  type="button"
                  className="model-icon-btn"
                  title={t(lang, 'securityShellPatternEdit')}
                  aria-label={t(lang, 'securityShellPatternEdit')}
                  disabled={disabled}
                  onClick={() => startEdit(row)}
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  className="model-icon-btn"
                  title={t(lang, 'securityShellPatternDelete')}
                  aria-label={t(lang, 'securityShellPatternDelete')}
                  disabled={disabled}
                  onClick={() => deleteRow(row.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ),
        )}
        {editingId === 'new' ? renderEditorRow('new') : null}
      </div>
    </div>
  );
}
