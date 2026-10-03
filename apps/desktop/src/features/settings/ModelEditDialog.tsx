import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CatalogModel } from '@okbot/shared';
import { t } from '../../i18n';
import { SettingsToggle } from './SettingsToggle';

/** Trim only — duplicate model names are case-sensitive within a provider. */
function normName(s: string) {
  return s.trim();
}

/** Empty / invalid → null (provider default); positive integer → floor. */
function parseMaxTokensInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return null;
}

export function ModelEditDialog({
  lang,
  mode,
  initial,
  existingIds,
  existingNames,
  onCancel,
  onSave,
}: {
  lang: 'zh' | 'en';
  mode: 'add' | 'edit';
  initial: CatalogModel;
  existingIds: string[];
  /** Display names of other models (excludes the one being edited). */
  existingNames: string[];
  onCancel: () => void;
  onSave: (m: CatalogModel) => void;
}) {
  const [id, setId] = useState(initial.id);
  const [name, setName] = useState(initial.name || initial.id);
  const [contextWindow, setContextWindow] = useState(String(initial.contextWindow || 128000));
  const [maxTokens, setMaxTokens] = useState(
    typeof initial.maxTokens === 'number' && initial.maxTokens >= 1
      ? String(initial.maxTokens)
      : '',
  );
  const [showThinking, setShowThinking] = useState(initial.showThinking !== false);

  const nextId = id.trim();
  const effectiveName = (name.trim() || nextId);
  const idClash = Boolean(
    nextId && existingIds.some((x) => x === nextId && x !== initial.id),
  );
  const nameClash = useMemo(() => {
    const key = normName(effectiveName);
    if (!key) return false;
    return existingNames.some((n) => normName(n) === key);
  }, [effectiveName, existingNames]);

  const canSave = Boolean(nextId) && !idClash && !nameClash;

  /* Escape cancels this dialog before SettingsModal's window listener closes settings. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // IME Esc dismisses a composition candidate; do not close the dialog.
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  function submit() {
    if (!canSave) return;
    const cw = Number(contextWindow);
    onSave({
      id: nextId,
      name: effectiveName,
      contextWindow: Number.isFinite(cw) && cw >= 1000 ? Math.floor(cw) : 128_000,
      maxTokens: parseMaxTokensInput(maxTokens),
      enabled: initial.enabled !== false,
      ...(showThinking ? {} : { showThinking: false }),
    });
  }

  if (typeof document === 'undefined') return null;

  /* Portal to body: nested under .settings-shell/.settings-body overflow, fixed
   * backdrop was clipped so the settings left nav painted over the dialog. */
  return createPortal(
    <div className="model-edit-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="model-edit-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{mode === 'add' ? t(lang, 'modelAdd') : t(lang, 'modelEdit')}</h3>
        <div className="model-edit-field">
          <label>{t(lang, 'modelIdLabel')}</label>
          <input
            spellCheck={false}
            className={idClash ? 'invalid' : undefined}
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="gpt-4o / deepseek-chat"
            autoFocus
            aria-invalid={idClash}
          />
          {idClash ? (
            <p className="model-edit-error">{t(lang, 'modelIdDuplicate')}</p>
          ) : null}
        </div>
        <div className="model-edit-field">
          <label>{t(lang, 'modelName')}</label>
          <input
            spellCheck={false}
            className={nameClash ? 'invalid' : undefined}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={id || 'display name'}
            aria-invalid={nameClash}
          />
          {nameClash ? (
            <p className="model-edit-error">{t(lang, 'modelNameDuplicate')}</p>
          ) : null}
        </div>
        <div className="model-edit-field">
          <label>{t(lang, 'modelContextLabel')}</label>
          <input
            spellCheck={false}
            type="number"
            min={1000}
            step={1000}
            value={contextWindow}
            onChange={(e) => setContextWindow(e.target.value)}
          />
        </div>
        <div className="model-edit-field">
          <label>{t(lang, 'modelMaxTokensLabel')}</label>
          <input
            spellCheck={false}
            type="number"
            min={1}
            step={1000}
            value={maxTokens}
            placeholder={t(lang, 'modelMaxTokensPlaceholder')}
            onChange={(e) => setMaxTokens(e.target.value)}
            onBlur={() => {
              const raw = maxTokens.trim();
              if (!raw) {
                setMaxTokens('');
                return;
              }
              const n = Number(raw);
              if (Number.isFinite(n) && n >= 1) {
                setMaxTokens(String(Math.floor(n)));
              } else {
                // Invalid → empty (null / provider default); do not restore a numeric default.
                setMaxTokens('');
              }
            }}
          />
        </div>
        <div className="model-edit-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SettingsToggle checked={showThinking} onChange={() => setShowThinking((v) => !v)} />
          <span style={{ fontSize: 12 }}>{t(lang, 'modelShowThinking')}</span>
        </div>
        <div className="model-edit-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            {t(lang, 'close')}
          </button>
          <button type="button" className="primary" onClick={submit} disabled={!canSave}>
            {lang === 'en' ? 'Save' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
