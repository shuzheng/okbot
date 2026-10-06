import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createId,
  formatKeyValueLines,
  parseKeyValueLines,
  type McpServerEntry,
  type McpSettings,
  type McpTransport,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { requestConfirm } from '../../components/ui';
import { SettingsHelpTip } from './SettingsHelpTip';
import { SettingsToggle } from './SettingsToggle';

type Draft = {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
};

type ProbeState = { kind: 'idle' | 'loading' | 'error' | 'ok'; message: string; id?: string };

const EMPTY_DRAFT = (): Draft => ({
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  env: '',
  url: '',
  headers: '',
});

function toDraft(s: McpServerEntry): Draft {
  return {
    name: s.name,
    transport: s.transport,
    command: s.command ?? '',
    args: (s.args ?? []).join('\n'),
    env: formatKeyValueLines(s.env, '='),
    url: s.url ?? '',
    headers: formatKeyValueLines(s.headers, ':'),
  };
}

function fromDraft(id: string, enabled: boolean, d: Draft): McpServerEntry {
  const name = d.name.trim() || (d.transport === 'http' ? 'http' : d.command.trim()) || 'mcp';
  if (d.transport === 'http') {
    const headers = parseKeyValueLines(d.headers, ':');
    return {
      id,
      name,
      enabled,
      transport: 'http',
      url: d.url.trim(),
      ...(Object.keys(headers).length ? { headers } : {}),
    };
  }
  const args = d.args
    .split(/\r?\n/)
    .map((a) => a.trim())
    .filter(Boolean);
  const env = parseKeyValueLines(d.env, '=');
  return {
    id,
    name,
    enabled,
    transport: 'stdio',
    command: d.command.trim(),
    ...(args.length ? { args } : {}),
    ...(Object.keys(env).length ? { env } : {}),
  };
}

function draftComplete(d: Draft): boolean {
  if (d.transport === 'http') return /^https?:\/\//i.test(d.url.trim());
  return Boolean(d.command.trim());
}

async function probe(lang: UiLang, entry: McpServerEntry): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await window.okbot.mcpTestServer(entry);
    if (res.ok) {
      return { ok: true, message: t(lang, 'mcpTestOk').replace('{n}', String(res.toolCount)) };
    }
    if (res.error === 'incomplete') return { ok: false, message: t(lang, 'mcpNeedFields') };
    if (res.error?.includes('mcp_insecure_url')) return { ok: false, message: t(lang, 'mcpInsecureUrl') };
    return { ok: false, message: `${t(lang, 'mcpTestFailed')}${res.error ? `：${res.error}` : ''}` };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (raw.includes('mcp_insecure_url')) return { ok: false, message: t(lang, 'mcpInsecureUrl') };
    return { ok: false, message: `${t(lang, 'mcpTestFailed')}：${raw}` };
  }
}

function McpServerDialog({
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
  const [status, setStatus] = useState<ProbeState>({ kind: 'idle', message: '' });

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

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="model-edit-backdrop" role="presentation" onClick={onCancel}>
      <div className="model-edit-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{mode === 'add' ? t(lang, 'mcpAdd') : t(lang, 'mcpEdit')}</h3>
        <div className="settings-card settings-card-model">
          <div className="settings-row">
            <span className="settings-row-label">
              <span className="settings-row-label-text">{t(lang, 'mcpName')}</span>
              <SettingsHelpTip text={t(lang, 'mcpNameHint')} />
            </span>
            <input
              className="wide"
              spellCheck={false}
              value={draft.name}
              placeholder={t(lang, 'mcpName')}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">
              <span className="settings-row-label-text">{t(lang, 'mcpTransport')}</span>
            </span>
            <select
              value={draft.transport}
              onChange={(e) => set({ transport: e.target.value === 'http' ? 'http' : 'stdio' })}
            >
              <option value="stdio">{t(lang, 'mcpTransportStdio')}</option>
              <option value="http">{t(lang, 'mcpTransportHttp')}</option>
            </select>
          </div>
          {draft.transport === 'stdio' ? (
            <>
              <div className="settings-row">
                <span className="settings-row-label">
                  <span className="settings-row-label-text">{t(lang, 'mcpCommand')}</span>
                  <SettingsHelpTip text={t(lang, 'mcpCommandHint')} />
                </span>
                <input
                  className="wide"
                  spellCheck={false}
                  value={draft.command}
                  placeholder="npx"
                  onChange={(e) => set({ command: e.target.value })}
                />
              </div>
              <div className="settings-row settings-row-stack">
                <span className="settings-row-label">
                  <span className="settings-row-label-text">{t(lang, 'mcpArgs')}</span>
                  <SettingsHelpTip text={t(lang, 'mcpArgsHint')} />
                </span>
                <textarea
                  className="settings-paths-textarea"
                  spellCheck={false}
                  rows={3}
                  value={draft.args}
                  placeholder={'-y\n@modelcontextprotocol/server-everything'}
                  onChange={(e) => set({ args: e.target.value })}
                />
              </div>
              <div className="settings-row settings-row-stack">
                <span className="settings-row-label">
                  <span className="settings-row-label-text">{t(lang, 'mcpEnv')}</span>
                  <SettingsHelpTip text={t(lang, 'mcpEnvHint')} />
                </span>
                <textarea
                  className="settings-paths-textarea"
                  spellCheck={false}
                  rows={2}
                  value={draft.env}
                  placeholder="KEY=value"
                  onChange={(e) => set({ env: e.target.value })}
                />
              </div>
            </>
          ) : (
            <>
              <div className="settings-row">
                <span className="settings-row-label">
                  <span className="settings-row-label-text">{t(lang, 'mcpUrl')}</span>
                  <SettingsHelpTip text={t(lang, 'mcpUrlHint')} />
                </span>
                <input
                  className="wide"
                  spellCheck={false}
                  value={draft.url}
                  placeholder="https://example.com/mcp"
                  onChange={(e) => set({ url: e.target.value })}
                />
              </div>
              <div className="settings-row settings-row-stack">
                <span className="settings-row-label">
                  <span className="settings-row-label-text">{t(lang, 'mcpHeaders')}</span>
                  <SettingsHelpTip text={t(lang, 'mcpHeadersHint')} />
                </span>
                <textarea
                  className="settings-paths-textarea"
                  spellCheck={false}
                  rows={2}
                  value={draft.headers}
                  placeholder="Authorization: Bearer …"
                  onChange={(e) => set({ headers: e.target.value })}
                />
              </div>
            </>
          )}
        </div>
        {status.kind === 'loading' || status.kind === 'error' ? (
          <div className={`model-list-status${status.kind === 'error' ? ' error' : ''}`}>{status.message}</div>
        ) : null}
        <div className="model-edit-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            {t(lang, 'close')}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (!draftComplete(draft)) {
                setStatus({ kind: 'error', message: t(lang, 'mcpNeedFields') });
                return;
              }
              onSave(draft);
            }}
          >
            {t(lang, 'save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * MCP servers ("advanced extensions"). Off by default. Every MCP tool call asks
 * for approval. List layout matches ComputersSettingsPanel / the model list.
 * `readOnly` (gateway clients): MCP starts processes on the host, so only the desktop edits it.
 */
export function McpSettingsPanel({
  lang,
  value,
  onChange,
  readOnly = false,
}: {
  lang: UiLang;
  value: McpSettings;
  onChange: (next: McpSettings) => void;
  readOnly?: boolean;
}) {
  const [editor, setEditor] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null);
  const [status, setStatus] = useState<ProbeState>({ kind: 'idle', message: '' });
  const editing = editor?.mode === 'edit' ? value.servers.find((s) => s.id === editor.id) : undefined;
  const listDisabled = readOnly || !value.enabled;

  const setServers = (servers: McpServerEntry[]) => onChange({ ...value, servers });
  // Live connection state of the saved servers (from the running hub). A failed
  // connection shows on its row without a manual test.
  type LiveStatus = Awaited<ReturnType<typeof window.okbot.mcpStatus>>[number];
  const [live, setLive] = useState<Record<string, LiveStatus>>({});
  const [liveTick, setLiveTick] = useState(0);
  // Fetch again when a saved server changes (the hub reconnects after a save).
  const serversKey = JSON.stringify(
    value.servers.map((s) => [s.id, s.enabled, s.transport, s.command, s.args, s.url]),
  );
  useEffect(() => {
    if (readOnly || !value.enabled) return;
    let cancelled = false;
    const load = () =>
      void window.okbot
        .mcpStatus?.()
        .then((list) => {
          if (cancelled || !Array.isArray(list)) return;
          setLive(Object.fromEntries(list.map((s) => [s.id, s])));
        })
        .catch(() => {});
    load();
    const again = window.setTimeout(load, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(again);
    };
  }, [readOnly, value.enabled, serversKey, liveTick]);

  async function test(entry: McpServerEntry) {
    setStatus({ kind: 'loading', message: t(lang, 'mcpTesting'), id: entry.id });
    const res = await probe(lang, entry);
    setStatus({ kind: res.ok ? 'ok' : 'error', message: res.message, id: entry.id });
    setLiveTick((n) => n + 1);
  }

  function saveDraft(draft: Draft) {
    if (editor?.mode === 'edit' && editing) {
      setServers(value.servers.map((s) => (s.id === editing.id ? fromDraft(s.id, s.enabled, draft) : s)));
    } else {
      setServers([...value.servers, fromDraft(createId('mcp'), true, draft)]);
    }
    setEditor(null);
  }

  return (
    <div>
      <div className="settings-section-label settings-section-label-with-help" data-settings-id="mcp">
        <span>{t(lang, 'mcpSection')}</span>
        <SettingsHelpTip text={t(lang, 'mcpSectionHint')} />
      </div>
      <div className="settings-card" aria-disabled={readOnly || undefined}>
        <div className="settings-row" data-settings-id="mcpEnabled">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'mcpEnable')}</span>
            <SettingsHelpTip text={t(lang, 'mcpEnableHint')} />
          </span>
          <SettingsToggle
            checked={value.enabled}
            disabled={readOnly}
            onChange={() => onChange({ ...value, enabled: !value.enabled })}
          />
        </div>
      </div>

      <div
        className="settings-card settings-card-model model-list-card"
        style={{ marginTop: 12 }}
        aria-disabled={listDisabled || undefined}
        data-settings-id="mcpServers"
      >
        <div className="model-list-head">
          <span className="model-list-head-title">{t(lang, 'mcpServers')}</span>
          <div className="model-list-actions">
            <button
              type="button"
              className="model-list-btn"
              disabled={listDisabled}
              onClick={() => setEditor({ mode: 'add' })}
            >
              + {t(lang, 'mcpAdd')}
            </button>
          </div>
        </div>
        {status.kind !== 'idle' ? (
          <div className={`model-list-status${status.kind === 'error' ? ' error' : status.kind === 'ok' ? ' ok' : ''}`}>
            {status.message}
          </div>
        ) : null}
        {value.servers.length === 0 ? <div className="model-list-empty">{t(lang, 'mcpEmpty')}</div> : null}
        {value.servers.map((server) => (
          <div key={server.id} className="model-row">
            <div className="model-row-main">
              <span className="model-row-name">{server.name}</span>
              <span className="model-badge">{server.transport === 'http' ? 'HTTP' : 'stdio'}</span>
              {value.enabled && server.enabled && live[server.id] ? (
                live[server.id]!.ok ? (
                  <span className="model-badge mcp-live ok">
                    {t(lang, 'mcpLiveOk').replace('{n}', String(live[server.id]!.toolCount))}
                  </span>
                ) : live[server.id]!.error ? (
                  <span className="model-badge mcp-live error" title={
                      live[server.id]!.error!.includes('mcp_insecure_url')
                        ? t(lang, 'mcpInsecureUrl')
                        : live[server.id]!.error
                    }>
                    {t(lang, 'mcpLiveFailed')}
                  </span>
                ) : null
              ) : null}
            </div>
            <div className="model-row-trailing">
              <button
                type="button"
                className={`model-icon-btn${status.id === server.id && status.kind === 'ok' ? ' active' : ''}`}
                title={t(lang, 'mcpTest')}
                aria-label={t(lang, 'mcpTest')}
                disabled={listDisabled || (status.id === server.id && status.kind === 'loading')}
                onClick={() => void test(server)}
              >
                {status.id === server.id && status.kind === 'loading' ? (
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
                title={t(lang, 'mcpEdit')}
                aria-label={t(lang, 'mcpEdit')}
                disabled={listDisabled}
                onClick={() => setEditor({ mode: 'edit', id: server.id })}
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
                disabled={listDisabled}
                onClick={() => {
                  void (async () => {
                    const ok = await requestConfirm({
                      message: t(lang, 'mcpDeleteConfirm'),
                      confirmLabel: t(lang, 'delete'),
                      cancelLabel: t(lang, 'cancel'),
                      danger: true,
                    });
                    if (!ok) return;
                    setServers(value.servers.filter((s) => s.id !== server.id));
                    if (status.id === server.id) setStatus({ kind: 'idle', message: '' });
                  })();
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                </svg>
              </button>
              <SettingsToggle
                checked={server.enabled}
                disabled={listDisabled}
                aria-label={t(lang, 'mcpServerEnable')}
                onChange={() =>
                  setServers(value.servers.map((s) => (s.id === server.id ? { ...s, enabled: !s.enabled } : s)))
                }
              />
            </div>
          </div>
        ))}
      </div>
      <div className="settings-restart-hint">{t(lang, readOnly ? 'mcpDesktopOnly' : 'mcpApprovalNote')}</div>

      {editor && (editor.mode === 'add' || editing) ? (
        <McpServerDialog
          lang={lang}
          mode={editor.mode}
          initial={editor.mode === 'edit' && editing ? toDraft(editing) : EMPTY_DRAFT()}
          onCancel={() => setEditor(null)}
          onSave={saveDraft}
        />
      ) : null}
    </div>
  );
}
