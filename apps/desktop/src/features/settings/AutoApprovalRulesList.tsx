import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import {
  createId,
  type AutoApprovalAction,
  type AutoApprovalRule,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { updateScrollFade } from '../../utils/scrollFade';

type Props = {
  lang: UiLang;
  rules: AutoApprovalRule[];
  onChange: (rules: AutoApprovalRule[]) => void;
  /** When true, start with a blank draft row (e.g. from the header「添加规则」button). */
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

function normName(s: string) {
  return s.trim().toLowerCase();
}

export function AutoApprovalRulesList({ lang, rules, onChange, requestAdd = 0 }: Props) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draftDesc, setDraftDesc] = useState('');
  const [draftAction, setDraftAction] = useState<AutoApprovalAction>('allow');
  const inputRef = useRef<HTMLInputElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const lastRequestAdd = useRef(0);

  useEffect(() => {
    if (requestAdd > 0 && requestAdd !== lastRequestAdd.current) {
      lastRequestAdd.current = requestAdd;
      setEditingId('new');
      setDraftDesc('');
      setDraftAction('allow');
    }
  }, [requestAdd]);

  useEffect(() => {
    if (editingId != null) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  // Match model-list: at scroll edges, forward wheel to the outer settings pane.
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
  }, [rules.length, editingId]);

  const isDuplicate = useMemo(() => {
    const key = normName(draftDesc);
    if (!key) return false;
    return rules.some(
      (r) => r.id !== editingId && normName(r.description) === key,
    );
  }, [draftDesc, rules, editingId]);

  const startEdit = (rule: AutoApprovalRule) => {
    setEditingId(rule.id);
    setDraftDesc(rule.description);
    setDraftAction(rule.action);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftDesc('');
    setDraftAction('allow');
  };

  const saveEdit = () => {
    const description = draftDesc.trim();
    if (!description || isDuplicate) return;
    const now = new Date().toISOString();
    if (editingId === 'new') {
      const created: AutoApprovalRule = {
        id: createId('aar'),
        description,
        action: draftAction,
        createdAt: now,
        updatedAt: now,
      };
      onChange([...rules, created]);
    } else if (editingId) {
      onChange(
        rules.map((r) =>
          r.id === editingId
            ? { ...r, description, action: draftAction, updatedAt: now }
            : r,
        ),
      );
    }
    cancelEdit();
  };

  const deleteRule = (id: string) => {
    onChange(rules.filter((r) => r.id !== id));
    if (editingId === id) cancelEdit();
  };

  const setRuleAction = (id: string, action: AutoApprovalAction) => {
    const now = new Date().toISOString();
    onChange(rules.map((r) => (r.id === id ? { ...r, action, updatedAt: now } : r)));
  };

  const renderEditorRow = (key: string) => {
    const canSave = draftDesc.trim().length > 0 && !isDuplicate;
    const commitOrDiscardOnBlur = (e: FocusEvent<HTMLDivElement>) => {
      // Focus moved within the editor row (input ↔ select ↔ buttons) — ignore.
      const next = e.relatedTarget as Node | null;
      if (next && e.currentTarget.contains(next)) return;

      const description = draftDesc.trim();
      if (!description) {
        // Empty draft: discard new row / cancel existing edit (do not delete saved rules).
        cancelEdit();
        return;
      }
      if (isDuplicate) {
        // Keep editing with red invalid state; do not save duplicates.
        return;
      }
      saveEdit();
    };
    return (
      <div
        key={key}
        className="aar-item aar-item-editing"
        onBlur={commitOrDiscardOnBlur}
      >
        <input
          ref={inputRef}
          type="text"
          className={`aar-inline-input${isDuplicate ? ' invalid' : ''}`}
          spellCheck={false}
          placeholder={t(lang, 'autoApprovalPlaceholder')}
          value={draftDesc}
          onChange={(e) => setDraftDesc(e.target.value)}
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
          aria-invalid={isDuplicate}
          aria-label={t(lang, 'autoApprovalWhen')}
        />
        <select
          className="tool-mgmt-approval-select"
          value={draftAction}
          aria-label={t(lang, 'autoApprovalPolicy')}
          onChange={(e) => setDraftAction(e.target.value === 'allow' ? 'allow' : 'ask')}
        >
          <option value="allow">{t(lang, 'autoApprovalAllow')}</option>
          <option value="ask">{t(lang, 'autoApprovalAsk')}</option>
        </select>
        <div className="aar-item-trailing">
          <button
            type="button"
            className="model-icon-btn"
            title={t(lang, 'autoApprovalSave')}
            aria-label={t(lang, 'autoApprovalSave')}
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

  const showEmpty = rules.length === 0 && editingId !== 'new';

  return (
    <div className="settings-aar-inline">
      <div ref={listScrollRef} className="aar-list-scroll scroll-fade">
        {showEmpty ? <div className="aar-empty">{t(lang, 'autoApprovalEmpty')}</div> : null}
        {rules.map((rule) =>
          editingId === rule.id ? (
            renderEditorRow(rule.id)
          ) : (
            <div key={rule.id} className="aar-item">
              <div className="aar-item-text">
                <div className="aar-item-title">{rule.description}</div>
              </div>
              <select
                className="tool-mgmt-approval-select"
                value={rule.action}
                aria-label={t(lang, 'autoApprovalPolicy')}
                onChange={(e) =>
                  setRuleAction(rule.id, e.target.value === 'allow' ? 'allow' : 'ask')
                }
              >
                <option value="allow">{t(lang, 'autoApprovalAllow')}</option>
                <option value="ask">{t(lang, 'autoApprovalAsk')}</option>
              </select>
              <div className="aar-item-trailing">
                <button
                  type="button"
                  className="model-icon-btn"
                  title={t(lang, 'autoApprovalEditTitle')}
                  aria-label={t(lang, 'autoApprovalEditTitle')}
                  onClick={() => startEdit(rule)}
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  className="model-icon-btn"
                  title={t(lang, 'autoApprovalDelete')}
                  aria-label={t(lang, 'autoApprovalDelete')}
                  onClick={() => deleteRule(rule.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ),
        )}
        {editingId === 'new' ? renderEditorRow('new') : null}
      </div>
      <p className="aar-hint settings-aar-hint">{t(lang, 'autoApprovalHint')}</p>
    </div>
  );
}
