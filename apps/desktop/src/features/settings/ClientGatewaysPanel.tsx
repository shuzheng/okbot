import { useCallback, useEffect, useState } from 'react';
import { normalizeGatewayHttpApiSettings } from '@okbot/shared';
import { ChevronDownIcon, CloseIcon, CopyIcon, EditIcon, EyeIcon, EyeOffIcon, TrashIcon } from '../../components/ui/icons';
import { requestConfirm, toast } from '../../components/ui';
import { t, type UiLang } from '../../i18n';
import { SettingsHelpTip } from './SettingsHelpTip';

const LOCAL_GATEWAY_ID = 'local';

type ClientGatewayEntry = {
  id: string;
  label: string;
  kind: 'local' | 'remote';
  baseUrl?: string;
  token?: string;
};

type ClientGatewayPrefs = {
  activeId: string;
  gateways: ClientGatewayEntry[];
};

function newRemoteId(): string {
  return `remote_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function hasClientGatewayApi(): boolean {
  return typeof window.okbot?.getClientGatewayPrefs === 'function';
}

function localGatewayDisplayUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function ClientGatewaysPanel({ lang }: { lang: UiLang }) {
  const [prefs, setPrefs] = useState<ClientGatewayPrefs | null>(null);
  const [adding, setAdding] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addToken, setAddToken] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  /** Independent expand flags — match provider list (not accordion). */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  /** Remote gateway currently being edited (inline in expanded body). */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editToken, setEditToken] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [showEditToken, setShowEditToken] = useState(false);
  const [showAddToken, setShowAddToken] = useState(false);
  /** Local gateway host URL for read-only expand (from gateway settings). */
  const [localUrl, setLocalUrl] = useState('');

  const reloadPrefs = useCallback(async () => {
    if (!hasClientGatewayApi()) {
      setPrefs(null);
      return;
    }
    try {
      const next = await window.okbot.getClientGatewayPrefs();
      setPrefs(next);
    } catch {
      setPrefs(null);
    }
  }, []);

  useEffect(() => {
    void reloadPrefs();
  }, [reloadPrefs]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await window.okbot.getSettings();
        if (cancelled || !settings) return;
        const api = normalizeGatewayHttpApiSettings(settings.gatewayHttpApi);
        setLocalUrl(localGatewayDisplayUrl(api.port));
      } catch {
        if (!cancelled) setLocalUrl('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const active = prefs?.gateways.find((g) => g.id === prefs.activeId) ?? prefs?.gateways[0];
  const isRemoteActive = active?.kind === 'remote';

  async function promptRelaunch() {
    const ok = await requestConfirm({
      title: t(lang, 'clientGatewayRestartTitle'),
      message: t(lang, 'clientGatewayRestartMessage'),
      confirmLabel: t(lang, 'clientGatewayRestartConfirm'),
      cancelLabel: t(lang, 'cancel'),
      danger: false,
    });
    if (ok) {
      toast.info(t(lang, 'clientGatewayRelaunching'));
      await window.okbot.relaunchApp();
    }
  }

  async function switchActive(id: string) {
    if (!prefs || id === prefs.activeId) return;
    const target = prefs.gateways.find((g) => g.id === id);
    const displayName =
      target?.kind === 'local'
        ? t(lang, 'clientGatewayLocalLabel')
        : target?.label || id;
    const switchApi = window.okbot.switchClientGateway;

    // Single confirm whenever the Electron switch API exists:
    // - attach ↔ remote / attach → reachable local / owner → remote: mode hot
    //   (owner→remote recreates as attach, keeps local gateway warm; no relaunch)
    // - attach → local that must own/start: mode relaunch → relaunch without a
    //   second dialog (user already confirmed the switch)
    if (typeof switchApi === 'function') {
      const ok = await requestConfirm({
        title: t(lang, 'clientGatewaySwitchTitle'),
        message: t(lang, 'clientGatewaySwitchMessage').replace('{name}', displayName),
        confirmLabel: t(lang, 'clientGatewaySwitchConfirm'),
        cancelLabel: t(lang, 'cancel'),
        danger: false,
      });
      if (!ok) return;
      try {
        toast.info(t(lang, 'clientGatewaySwitching'));
        const result = await switchApi(id);
        setPrefs(result.prefs);
        if (result.mode === 'hot') {
          toast.success(t(lang, 'clientGatewaySwitched'));
          return;
        }
        toast.info(t(lang, 'clientGatewayRelaunching'));
        await window.okbot.relaunchApp();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    // No switch API: one restart confirm, then setActive + relaunch.
    const ok = await requestConfirm({
      title: t(lang, 'clientGatewayRestartTitle'),
      message: t(lang, 'clientGatewayRestartMessage'),
      confirmLabel: t(lang, 'clientGatewayRestartConfirm'),
      cancelLabel: t(lang, 'cancel'),
      danger: false,
    });
    if (!ok) return;
    try {
      const next = await window.okbot.setActiveClientGateway(id);
      setPrefs(next);
      toast.info(t(lang, 'clientGatewayRelaunching'));
      await window.okbot.relaunchApp();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeRemote(id: string) {
    if (id === LOCAL_GATEWAY_ID) return;
    const ok = await requestConfirm({
      title: t(lang, 'clientGatewayRemoveTitle'),
      message: t(lang, 'clientGatewayRemoveMessage'),
      confirmLabel: t(lang, 'clientGatewayRemoveConfirm'),
      cancelLabel: t(lang, 'cancel'),
      danger: true,
    });
    if (!ok) return;
    const wasActive = prefs?.activeId === id;
    try {
      const next = await window.okbot.removeClientGateway(id);
      setPrefs(next);
      setExpandedIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      if (editingId === id) {
        setEditingId(null);
        setEditError('');
      }
      if (wasActive) await promptRelaunch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function beginEdit(gw: ClientGatewayEntry) {
    if (gw.kind !== 'remote') return;
    setAdding(false);
    setAddError('');
    setEditingId(gw.id);
    setEditLabel(gw.label);
    setEditUrl(gw.baseUrl || '');
    setEditToken(gw.token || '');
    setEditError('');
    setExpandedIds((prev) => {
      const n = new Set(prev);
      n.add(gw.id);
      return n;
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError('');
    setEditBusy(false);
  }

  async function submitEditRemote() {
    if (!editingId) return;
    const url = editUrl.trim();
    const tok = editToken.trim();
    if (!url || !tok) {
      setEditError(t(lang, 'clientGatewayNeedUrlToken'));
      return;
    }
    const existing = prefs?.gateways.find((g) => g.id === editingId);
    if (!existing || existing.kind !== 'remote') return;
    setEditBusy(true);
    setEditError('');
    try {
      const probe = await window.okbot.probeClientGateway({ baseUrl: url, token: tok });
      if (!probe.ok) {
        setEditError(t(lang, 'clientGatewayProbeFail'));
        setEditBusy(false);
        return;
      }
      const entry: ClientGatewayEntry = {
        id: editingId,
        label: editLabel.trim() || t(lang, 'clientGatewayRemoteDefaultLabel'),
        kind: 'remote',
        baseUrl: url,
        token: tok,
      };
      const next = await window.okbot.upsertClientGateway(entry);
      setPrefs(next);
      setEditingId(null);
      toast.success(t(lang, 'clientGatewaySaved'));
      const wasActive = next.activeId === editingId;
      const changed =
        (existing.baseUrl || '') !== url || (existing.token || '') !== tok;
      if (wasActive && changed) {
        const switchApi = window.okbot.switchClientGateway;
        if (typeof switchApi === 'function') {
          try {
            toast.info(t(lang, 'clientGatewaySwitching'));
            const result = await switchApi(editingId);
            setPrefs(result.prefs);
            if (result.mode === 'hot') {
              toast.success(t(lang, 'clientGatewaySwitched'));
            } else {
              await promptRelaunch();
            }
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
          }
        } else {
          await promptRelaunch();
        }
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditBusy(false);
    }
  }

  async function submitAddRemote() {
    const name = addLabel.trim();
    const url = addUrl.trim();
    const tok = addToken.trim();
    if (!name) {
      setAddError(t(lang, 'clientGatewayNeedName'));
      return;
    }
    if (!url || !tok) {
      setAddError(t(lang, 'clientGatewayNeedUrlToken'));
      return;
    }
    setAddBusy(true);
    setAddError('');
    try {
      const probe = await window.okbot.probeClientGateway({ baseUrl: url, token: tok });
      if (!probe.ok) {
        setAddError(t(lang, 'clientGatewayProbeFail'));
        setAddBusy(false);
        return;
      }
      const entry: ClientGatewayEntry = {
        id: newRemoteId(),
        label: name,
        kind: 'remote',
        baseUrl: url,
        token: tok,
      };
      const next = await window.okbot.upsertClientGateway(entry);
      setPrefs(next);
      setExpandedIds((prev) => {
        const n = new Set(prev);
        n.add(entry.id);
        return n;
      });
      setAdding(false);
      setAddLabel('');
      setAddUrl('');
      setAddToken('');
      toast.success(t(lang, 'clientGatewayAdded'));
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddBusy(false);
    }
  }

  function toggleOpen(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (editingId === id) {
          setEditingId(null);
          setEditError('');
        }
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (!prefs) {
    return (
      <div>
        <div className="settings-section-label" data-settings-id="clientGateways">
          {t(lang, 'clientGateways')}
        </div>
        <p className="settings-hint">{t(lang, 'clientGatewaysUnavailable')}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="settings-section-label" data-settings-id="clientGateways">
        {t(lang, 'clientGateways')}
      </div>
      {isRemoteActive ? (
        <p className="settings-hint" style={{ marginBottom: 8 }}>
          {t(lang, 'clientGatewayRemoteToolsHint')}
        </p>
      ) : null}

      <div className="settings-card settings-card-model provider-list-card">
        <div className="model-list-head">
          <span className="model-list-head-title">{t(lang, 'clientGatewayListTitle')}</span>
          <div className="model-list-actions">
            <button
              type="button"
              className="model-list-btn"
              onClick={() => {
                cancelEdit();
                setAdding((v) => !v);
                setAddError('');
              }}
            >
              + {t(lang, 'clientGatewayAddRemote')}
            </button>
          </div>
        </div>

        <div className="provider-list">
          {prefs.gateways.map((gw) => {
            const selected = gw.id === prefs.activeId;
            const open = expandedIds.has(gw.id);
            const editing = editingId === gw.id;
            const displayName =
              gw.kind === 'local' ? t(lang, 'clientGatewayLocalLabel') : gw.label;
            const displayUrl =
              gw.kind === 'local'
                ? localUrl || t(lang, 'clientGatewayLocalUrlFallback')
                : gw.baseUrl || '';
            return (
              <div key={gw.id} className={`provider-item${open ? ' open' : ''}`}>
                <div
                  className="provider-item-head provider-item-head-clickable"
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => toggleOpen(gw.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleOpen(gw.id);
                    }
                  }}
                >
                  <span className="provider-item-name">
                    {displayName}
                    <span className="settings-muted" style={{ fontWeight: 400, fontSize: 12 }}>
                      {gw.kind === 'local'
                        ? t(lang, 'clientGatewayKindLocal')
                        : t(lang, 'clientGatewayKindRemote')}
                    </span>
                  </span>
                  <div className="provider-item-actions">
                    {!selected ? (
                      <button
                        type="button"
                        className="model-list-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          void switchActive(gw.id);
                        }}
                      >
                        {t(lang, 'clientGatewayUse')}
                      </button>
                    ) : null}
                    {gw.kind === 'remote' ? (
                      <>
                        <button
                          type="button"
                          className="model-icon-btn"
                          title={t(lang, 'clientGatewayEdit')}
                          aria-label={t(lang, 'clientGatewayEdit')}
                          onClick={(e) => {
                            e.stopPropagation();
                            beginEdit(gw);
                          }}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          className="model-icon-btn"
                          title={t(lang, 'clientGatewayRemove')}
                          aria-label={t(lang, 'clientGatewayRemove')}
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeRemote(gw.id);
                          }}
                        >
                          <TrashIcon />
                        </button>
                      </>
                    ) : null}
                    {selected ? (
                      <span className="model-badge default">{t(lang, 'clientGatewayActive')}</span>
                    ) : null}
                    <button
                      type="button"
                      className={`model-icon-btn aar-expand-btn${open ? ' expanded' : ''}`}
                      title={open ? t(lang, 'avatarPickerCollapse') : t(lang, 'avatarPickerExpand')}
                      aria-label={open ? t(lang, 'avatarPickerCollapse') : t(lang, 'avatarPickerExpand')}
                      aria-expanded={open}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleOpen(gw.id);
                      }}
                    >
                      <ChevronDownIcon />
                    </button>
                  </div>
                </div>
                {open ? (
                  <div className="provider-item-body">
                    <div className="settings-card settings-card-model provider-nested-card">
                      {editing && gw.kind === 'remote' ? (
                        <>
                          <div className="settings-row">
                            <span className="settings-row-label">
                              <span className="settings-row-label-text">{t(lang, 'clientGatewayLabel')}</span>
                            </span>
                            <input
                              className="wide"
                              spellCheck={false}
                              value={editLabel}
                              disabled={editBusy}
                              placeholder={t(lang, 'clientGatewayLabelOptional')}
                              onChange={(e) => setEditLabel(e.target.value)}
                            />
                          </div>
                          <div className="settings-row">
                            <span className="settings-row-label">
                              <span className="settings-row-label-text">{t(lang, 'clientGatewayBaseUrl')}</span>
                            </span>
                            <input
                              className="wide"
                              spellCheck={false}
                              autoComplete="off"
                              value={editUrl}
                              disabled={editBusy}
                              placeholder="https://host:port"
                              onChange={(e) => setEditUrl(e.target.value)}
                            />
                          </div>
                          <div className="settings-row">
                            <span className="settings-row-label">
                              <span className="settings-row-label-text">{t(lang, 'clientGatewayToken')}</span>
                              <SettingsHelpTip text={t(lang, 'clientGatewayTokenAdminHint')} />
                            </span>
                            <div className="settings-secret settings-secret-multi">
                              <input
                                type={showEditToken ? 'text' : 'password'}
                                className="wide"
                                spellCheck={false}
                                autoComplete="off"
                                value={editToken}
                                disabled={editBusy}
                                onChange={(e) => setEditToken(e.target.value)}
                                style={{
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                  fontSize: 12,
                                }}
                              />
                              <div className="settings-secret-actions">
                                <button
                                  type="button"
                                  className="settings-eye"
                                  disabled={editBusy}
                                  aria-label={t(lang, showEditToken ? 'clientGatewayTokenHide' : 'clientGatewayTokenShow')}
                                  title={t(lang, showEditToken ? 'clientGatewayTokenHide' : 'clientGatewayTokenShow')}
                                  onClick={() => setShowEditToken((v) => !v)}
                                >
                                  {showEditToken ? <EyeOffIcon /> : <EyeIcon />}
                                </button>
                                <button
                                  type="button"
                                  className="settings-eye"
                                  disabled={editBusy || !editToken}
                                  aria-label={t(lang, 'clientGatewayTokenCopy')}
                                  title={t(lang, 'clientGatewayTokenCopy')}
                                  onClick={() => {
                                    void (async () => {
                                      const token = editToken.trim();
                                      if (!token) return;
                                      try {
                                        if (typeof window.okbot?.copyText === 'function') {
                                          await window.okbot.copyText(token);
                                        } else {
                                          await navigator.clipboard.writeText(token);
                                        }
                                        toast.success(t(lang, 'clientGatewayTokenCopied'));
                                      } catch (err) {
                                        toast.error(err instanceof Error ? err.message : String(err));
                                      }
                                    })();
                                  }}
                                >
                                  <CopyIcon />
                                </button>
                                <button
                                  type="button"
                                  className="settings-eye"
                                  disabled={editBusy || !editToken}
                                  aria-label={t(lang, 'clientGatewayTokenClear')}
                                  title={t(lang, 'clientGatewayTokenClear')}
                                  onClick={() => setEditToken('')}
                                >
                                  <CloseIcon />
                                </button>
                              </div>
                            </div>
                          </div>
                          {editError ? (
                            <div className="model-list-status error" style={{ margin: '0 12px 8px' }}>
                              {editError}
                            </div>
                          ) : null}
                          <div className="model-edit-actions" style={{ padding: '0 12px 10px' }}>
                            <button
                              type="button"
                              className="ghost"
                              disabled={editBusy}
                              onClick={() => cancelEdit()}
                            >
                              {t(lang, 'cancel')}
                            </button>
                            <button
                              type="button"
                              className="primary"
                              disabled={editBusy}
                              onClick={() => void submitEditRemote()}
                            >
                              {t(lang, 'save')}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="settings-row">
                            <span className="settings-row-label">
                              <span className="settings-row-label-text">{t(lang, 'clientGatewayBaseUrl')}</span>
                            </span>
                            <input
                              className="wide"
                              spellCheck={false}
                              readOnly
                              value={displayUrl}
                            />
                          </div>
                          <div className="settings-row">
                            <span className="settings-row-label">
                              <span className="settings-row-label-text">{t(lang, 'clientGatewayToken')}</span>
                              <SettingsHelpTip text={t(lang, 'clientGatewayTokenAdminHint')} />
                            </span>
                            <span className="settings-row-meta">••••••••</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {adding ? (
          <div style={{ padding: '10px 12px 12px' }}>
            <div className="settings-card settings-card-model">
              <div className="settings-row">
                <span className="settings-row-label">
                  <span className="settings-row-label-text">{t(lang, 'clientGatewayLabel')}</span>
                </span>
                <input
                  className="wide"
                  spellCheck={false}
                  value={addLabel}
                  disabled={addBusy}
                  placeholder={t(lang, 'clientGatewayLabelRequired')}
                  onChange={(e) => setAddLabel(e.target.value)}
                />
              </div>
              <div className="settings-row">
                <span className="settings-row-label">
                  <span className="settings-row-label-text">{t(lang, 'clientGatewayBaseUrl')}</span>
                </span>
                <input
                  className="wide"
                  spellCheck={false}
                  autoComplete="off"
                  value={addUrl}
                  disabled={addBusy}
                  placeholder="https://host:port"
                  onChange={(e) => setAddUrl(e.target.value)}
                />
              </div>
              <div className="settings-row">
                <span className="settings-row-label">
                  <span className="settings-row-label-text">{t(lang, 'clientGatewayToken')}</span>
                  <SettingsHelpTip text={t(lang, 'clientGatewayTokenAdminHint')} />
                </span>
                <div className="settings-secret settings-secret-multi">
                  <input
                    type={showAddToken ? 'text' : 'password'}
                    className="wide"
                    spellCheck={false}
                    autoComplete="off"
                    value={addToken}
                    disabled={addBusy}
                    onChange={(e) => setAddToken(e.target.value)}
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 12,
                    }}
                  />
                  <div className="settings-secret-actions">
                    <button
                      type="button"
                      className="settings-eye"
                      disabled={addBusy}
                      aria-label={t(lang, showAddToken ? 'clientGatewayTokenHide' : 'clientGatewayTokenShow')}
                      title={t(lang, showAddToken ? 'clientGatewayTokenHide' : 'clientGatewayTokenShow')}
                      onClick={() => setShowAddToken((v) => !v)}
                    >
                      {showAddToken ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                    <button
                      type="button"
                      className="settings-eye"
                      disabled={addBusy || !addToken}
                      aria-label={t(lang, 'clientGatewayTokenCopy')}
                      title={t(lang, 'clientGatewayTokenCopy')}
                      onClick={() => {
                        void (async () => {
                          const token = addToken.trim();
                          if (!token) return;
                          try {
                            if (typeof window.okbot?.copyText === 'function') {
                              await window.okbot.copyText(token);
                            } else {
                              await navigator.clipboard.writeText(token);
                            }
                            toast.success(t(lang, 'clientGatewayTokenCopied'));
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : String(err));
                          }
                        })();
                      }}
                    >
                      <CopyIcon />
                    </button>
                    <button
                      type="button"
                      className="settings-eye"
                      disabled={addBusy || !addToken}
                      aria-label={t(lang, 'clientGatewayTokenClear')}
                      title={t(lang, 'clientGatewayTokenClear')}
                      onClick={() => setAddToken('')}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            {addError ? (
              <div className="model-list-status error" style={{ marginTop: 8 }}>
                {addError}
              </div>
            ) : null}
            <div className="model-edit-actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="ghost"
                disabled={addBusy}
                onClick={() => {
                  setAdding(false);
                  setAddError('');
                }}
              >
                {t(lang, 'cancel')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={addBusy}
                onClick={() => void submitAddRemote()}
              >
                {t(lang, 'save')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
