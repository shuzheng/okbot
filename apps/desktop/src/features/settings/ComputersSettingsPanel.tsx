import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_SANDBOX_PORT,
  LOCAL_COMPUTER_ID,
  generateComputerId,
  normalizeDefaultComputerId,
  type ComputerEntry,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { requestConfirm } from '../../components/ui';
import { SettingsHelpTip } from './SettingsHelpTip';
import { SettingsToggle } from './SettingsToggle';

type Draft = { name: string; host: string; port: string; token: string };

type ProbeState = { kind: 'idle' | 'loading' | 'error' | 'ok'; message: string; id?: string };

const EMPTY_DRAFT = (): Draft => ({
  name: 'Cloud',
  host: '127.0.0.1',
  port: String(DEFAULT_SANDBOX_PORT),
  token: '',
});

function updateAt(
  computers: ComputerEntry[],
  index: number,
  patch: Partial<ComputerEntry>,
): ComputerEntry[] {
  return computers.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
}

async function probeDraft(
  lang: UiLang,
  draft: Draft,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const host = draft.host.trim();
  const token = draft.token.trim();
  const port = Number(draft.port);
  if (!host || !token || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, message: t(lang, 'computerProbeNeedFields') };
  }
  try {
    const res = await window.okbot.probeComputer({
      name: draft.name.trim() || 'Cloud',
      host,
      port,
      token,
    });
    if (!res.ok) {
      const key =
        res.error === 'unauthorized'
          ? 'computerProbeUnauthorized'
          : res.error === 'not_sandbox'
            ? 'computerProbeNotSandbox'
            : res.error === 'need_fields'
              ? 'computerProbeNeedFields'
              : 'computerProbeUnreachable';
      return { ok: false, message: t(lang, key) };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: t(lang, 'computerProbeUnreachable') };
  }
}

function ComputerFields({
  lang,
  draft,
  onChange,
}: {
  lang: UiLang;
  draft: Draft;
  onChange: (next: Draft) => void;
}) {
  return (
    <>
      <div className="settings-row">
        <span className="settings-row-label">
          <span className="settings-row-label-text">{t(lang, 'computerName')}</span>
        </span>
        <input
          className="wide"
          spellCheck={false}
          value={draft.name}
          placeholder={t(lang, 'computerName')}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          <span className="settings-row-label-text">{t(lang, 'computerHost')}</span>
          <SettingsHelpTip text={t(lang, 'computerHostHint')} />
        </span>
        <input
          className="wide"
          spellCheck={false}
          value={draft.host}
          placeholder={t(lang, 'computerHost')}
          onChange={(e) => onChange({ ...draft, host: e.target.value })}
        />
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          <span className="settings-row-label-text">{t(lang, 'computerPort')}</span>
          <SettingsHelpTip text={t(lang, 'computerPortHint')} />
        </span>
        <input
          className="wide"
          spellCheck={false}
          inputMode="numeric"
          value={draft.port}
          placeholder={t(lang, 'computerPort')}
          onChange={(e) => onChange({ ...draft, port: e.target.value })}
        />
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          <span className="settings-row-label-text">{t(lang, 'computerToken')}</span>
          <SettingsHelpTip text={t(lang, 'computerTokenHint')} />
        </span>
        <input
          className="wide"
          type="password"
          spellCheck={false}
          autoComplete="off"
          value={draft.token}
          placeholder={t(lang, 'computerToken')}
          onChange={(e) => onChange({ ...draft, token: e.target.value })}
        />
      </div>
    </>
  );
}

function ComputerEditDialog({
  lang,
  mode,
  initial,
  onCancel,
  onSave,
}: {
  lang: UiLang;
  mode: 'add' | 'edit';
  initial: Draft;
  onCancel: () => void;
  onSave: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [probe, setProbe] = useState<ProbeState>({ kind: 'idle', message: '' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  async function submit() {
    if (probe.kind === 'loading') return;
    const next: Draft = {
      ...draft,
      port: draft.port.trim() || (mode === 'edit' ? initial.port : ''),
    };
    if (next.port !== draft.port) setDraft(next);
    const connectionUnchanged =
      mode === 'edit' &&
      next.host.trim() === initial.host.trim() &&
      next.port.trim() === initial.port.trim() &&
      next.token.trim() === initial.token.trim();
    if (connectionUnchanged) {
      if (!next.name.trim()) {
        setProbe({ kind: 'error', message: t(lang, 'computerProbeNeedFields') });
        return;
      }
      onSave(next);
      return;
    }
    setProbe({ kind: 'loading', message: t(lang, 'computerProbing') });
    const result = await probeDraft(lang, next);
    if (!result.ok) {
      setProbe({ kind: 'error', message: result.message });
      return;
    }
    onSave(next);
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="model-edit-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="model-edit-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{mode === 'add' ? t(lang, 'computerAdd') : t(lang, 'computerEdit')}</h3>
        <div className="settings-card settings-card-model">
          <ComputerFields lang={lang} draft={draft} onChange={setDraft} />
        </div>
        {probe.kind === 'loading' || probe.kind === 'error' ? (
          <div className={`model-list-status${probe.kind === 'error' ? ' error' : ''}`}>{probe.message}</div>
        ) : null}
        <div className="model-edit-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            {t(lang, 'close')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={probe.kind === 'loading'}
            onClick={() => {
              void submit();
            }}
          >
            {lang === 'en' ? 'Save' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Registered computers. List matches the model list: header, icon actions, enable switch.
 * Local is always listed and has no actions.
 */
export function ComputersSettingsPanel({
  lang,
  computers,
  defaultComputerId,
  onChange,
  onDefaultComputerIdChange,
}: {
  lang: UiLang;
  computers: ComputerEntry[];
  defaultComputerId: string;
  onChange: (next: ComputerEntry[]) => void;
  onDefaultComputerIdChange: (id: string) => void;
}) {
  const [editor, setEditor] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null);
  const [probe, setProbe] = useState<ProbeState>({ kind: 'idle', message: '' });

  const editing = editor?.mode === 'edit' ? computers.find((c) => c.id === editor.id) : undefined;
  const enabledComputers = computers.filter((c) => c.enabled !== false);

  async function testComputer(computer: ComputerEntry) {
    setProbe({ kind: 'loading', message: t(lang, 'computerProbing'), id: computer.id });
    const result = await probeDraft(lang, {
      name: computer.name,
      host: computer.host,
      port: String(computer.port),
      token: computer.token,
    });
    if (!result.ok) {
      setProbe({ kind: 'error', message: result.message, id: computer.id });
      return;
    }
    setProbe({ kind: 'ok', message: t(lang, 'computerProbeOk'), id: computer.id });
  }

  function saveDraft(draft: Draft) {
    const host = draft.host.trim();
    const token = draft.token.trim();
    const port = Number(draft.port);
    const name = draft.name.trim() || 'Cloud';
    if (editor?.mode === 'edit') {
      const index = computers.findIndex((c) => c.id === editor.id);
      if (index >= 0) {
        onChange(updateAt(computers, index, { name, host, port, token }));
      }
    } else {
      onChange([
        ...computers,
        {
          id: generateComputerId(),
          name,
          host,
          port,
          token,
          enabled: true,
        },
      ]);
    }
    setEditor(null);
  }

  return (
    <div>
      <div
        className="settings-section-label settings-section-label-with-help"
        data-settings-id="computers"
      >
        <span>{t(lang, 'computers')}</span>
        <SettingsHelpTip text={t(lang, 'computersHint')} />
      </div>
      <div className="settings-card settings-card-model">
        <div className="settings-row" data-settings-id="defaultComputer">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'defaultComputer')}</span>
            <SettingsHelpTip text={t(lang, 'defaultComputerHint')} />
          </span>
          <select
            value={normalizeDefaultComputerId(defaultComputerId, enabledComputers)}
            aria-label={t(lang, 'defaultComputer')}
            onChange={(e) => onDefaultComputerIdChange(e.target.value)}
          >
            <option value={LOCAL_COMPUTER_ID}>{t(lang, 'computerLocal')}</option>
            {enabledComputers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-card settings-card-model model-list-card" style={{ marginTop: 12 }}>
        <div className="model-list-head">
          <span className="model-list-head-title">{t(lang, 'computerNameColumn')}</span>
          <div className="model-list-actions">
            <button type="button" className="model-list-btn" onClick={() => setEditor({ mode: 'add' })}>
              + {t(lang, 'computerAdd')}
            </button>
          </div>
        </div>
        {probe.kind !== 'idle' ? (
          <div
            className={`model-list-status${
              probe.kind === 'error' ? ' error' : probe.kind === 'ok' ? ' ok' : ''
            }`}
          >
            {probe.message}
          </div>
        ) : null}
        <div className="model-row">
          <div className="model-row-main">
            <span className="model-row-name">{t(lang, 'computerLocal')}</span>
          </div>
        </div>
        {computers.map((computer, index) => (
          <div key={computer.id} className="model-row">
            <div className="model-row-main">
              <span className="model-row-name">{computer.name}</span>
            </div>
            <div className="model-row-trailing">
              <button
                type="button"
                className={`model-icon-btn${
                  probe.id === computer.id && probe.kind === 'ok' ? ' active' : ''
                }`}
                title={t(lang, 'computerTest')}
                aria-label={t(lang, 'computerTest')}
                disabled={probe.id === computer.id && probe.kind === 'loading'}
                onClick={() => {
                  void testComputer(computer);
                }}
              >
                {probe.id === computer.id && probe.kind === 'loading' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 3a9 9 0 109 9" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                    <path d="M5 7v10" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className="model-icon-btn"
                title={t(lang, 'computerEdit')}
                aria-label={t(lang, 'computerEdit')}
                onClick={() => setEditor({ mode: 'edit', id: computer.id })}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </button>
              <button
                type="button"
                className="model-icon-btn"
                title={t(lang, 'delete')}
                aria-label={t(lang, 'delete')}
                onClick={() => {
                  void (async () => {
                    const ok = await requestConfirm({
                      message: t(lang, 'computerDeleteConfirm'),
                      confirmLabel: t(lang, 'delete'),
                      cancelLabel: t(lang, 'cancel'),
                      danger: true,
                    });
                    if (!ok) return;
                    const removed = computer.id;
                    onChange(computers.filter((_, i) => i !== index));
                    if (defaultComputerId === removed) onDefaultComputerIdChange(LOCAL_COMPUTER_ID);
                    if (probe.id === removed) setProbe({ kind: 'idle', message: '' });
                  })();
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                </svg>
              </button>
              <SettingsToggle
                checked={computer.enabled !== false}
                aria-label={t(lang, 'computerEnable')}
                onChange={() => {
                  const nextEnabled = computer.enabled === false;
                  onChange(updateAt(computers, index, { enabled: nextEnabled }));
                  if (!nextEnabled && defaultComputerId === computer.id) {
                    onDefaultComputerIdChange(LOCAL_COMPUTER_ID);
                  }
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {editor && (editor.mode === 'add' || editing) ? (
        <ComputerEditDialog
          lang={lang}
          mode={editor.mode}
          initial={
            editor.mode === 'edit' && editing
              ? {
                  name: editing.name,
                  host: editing.host,
                  port: String(editing.port),
                  token: editing.token,
                }
              : EMPTY_DRAFT()
          }
          onCancel={() => setEditor(null)}
          onSave={saveDraft}
        />
      ) : null}
    </div>
  );
}
