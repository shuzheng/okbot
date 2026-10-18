import { useEffect, useRef, useState } from 'react';
import {
  createId,
  formatContextWindowBadge,
  DEFAULT_PROVIDER_NAME,
  sortCatalogModels,
  type ApiFormat,
  type CatalogModel,
  type ModelProvider,
  type ModelSettings,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { updateScrollFade } from '../../utils/scrollFade';
import { SettingsHelpTip } from './SettingsHelpTip';
import { SettingsToggle } from './SettingsToggle';
import { ModelEditDialog } from './ModelEditDialog';
import { ModelRefSelect } from './ModelRefSelect';
import { requestConfirm, toast } from '../../components/ui';
import { formatSystemError } from '../../utils/formatSystemError';
import { isGatewayClient } from '../../utils/gatewayClient';
import { ChevronDownIcon, EyeIcon, EyeOffIcon, TrashIcon } from '../../components/ui/icons';

export type ModelProvidersPanelProps = {
  lang: UiLang;
  value: ModelSettings;
  onChange: (next: ModelSettings) => void;
};

function patchProvider(
  providers: ModelProvider[],
  id: string,
  patch: Partial<ModelProvider>,
): ModelProvider[] {
  return providers.map((p) => (p.id === id ? { ...p, ...patch } : p));
}


/** Gateway refuses probes of unsaved base URLs (no SSRF); show a readable reason. */
function probeErrorText(lang: UiLang, error: unknown): string {
  const raw = typeof error === 'string' ? error : '';
  if (raw.includes('probe_url_not_saved')) return t(lang, 'modelProbeGatewaySavedOnly');
  return raw;
}

export function ModelProvidersPanel({ lang, value, onChange }: ModelProvidersPanelProps) {
  const providers = value.providers;
  const defaultProviderId = value.defaultProviderId;
  const defaultModelId = value.defaultModelId;

  const [activeProviderId, setActiveProviderId] = useState(
    () => value.defaultProviderId || value.providers[0]?.id || '',
  );
  /** Independent expand flags — not accordion. Add/delete must not open/close peers. */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => {
      const id = value.defaultProviderId || value.providers[0]?.id;
      return id ? new Set([id]) : new Set();
    },
  );
  const [showKey, setShowKey] = useState(false);
  const [discoverStatus, setDiscoverStatus] = useState<{
    kind: 'idle' | 'loading' | 'ok' | 'error';
    message?: string;
  }>({ kind: 'idle' });
  const [connTest, setConnTest] = useState<{
    providerId: string | null;
    modelId: string | null;
    kind: 'idle' | 'loading' | 'ok' | 'error';
    message?: string;
  }>({ providerId: null, modelId: null, kind: 'idle' });
  const [modelEditor, setModelEditor] = useState<
    null | { mode: 'add' } | { mode: 'edit'; model: CatalogModel }
  >(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const discoverTriedRef = useRef('');
  const discoverSeqRef = useRef(0);
  const discoverTimerRef = useRef<number | null>(null);
  const modelListScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!providers.length) {
      if (activeProviderId) setActiveProviderId('');
      setExpandedIds((prev) => (prev.size ? new Set() : prev));
      return;
    }
    // Drop expand flags for deleted providers only — never auto-open another.
    setExpandedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (providers.some((p) => p.id === id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    // Clear active edit target if it was deleted; do not fall back to default
    // (that was forcing the default provider to expand after delete).
    if (activeProviderId && !providers.some((p) => p.id === activeProviderId)) {
      setActiveProviderId('');
    }
  }, [providers, activeProviderId]);

  const active = providers.find((p) => p.id === activeProviderId) || null;

  const displayModels = sortCatalogModels(active?.models ?? []);

  useEffect(() => {
    const el = modelListScrollRef.current;
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
  }, [activeProviderId, displayModels.length]);

  function commit(next: ModelSettings) {
    onChange(next);
  }

  function updateActive(patch: Partial<ModelProvider>) {
    if (!active) return;
    commit({
      ...value,
      providers: patchProvider(providers, active.id, patch),
    });
  }

  function updateProvider(providerId: string, patch: Partial<ModelProvider>) {
    commit({
      ...value,
      providers: patchProvider(providers, providerId, patch),
    });
  }

  function addProvider() {
    const id = createId('prov');
    const n = providers.length + 1;
    const name = lang === 'en' ? `Provider ${n}` : `供应商 ${n}`;
    const next: ModelProvider = {
      id,
      name,
      baseURL: '',
      apiKey: '',
      apiFormat: 'chat_completions',
      models: [],
    };
    commit({
      providers: [...providers, next],
      defaultProviderId: value.defaultProviderId || id,
      defaultModelId: value.defaultModelId,
    });
    setActiveProviderId(id);
    setExpandedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setRenamingId(id);
    discoverTriedRef.current = '';
    setDiscoverStatus({ kind: 'idle' });
  }

  function deleteProvider(id: string) {
    void (async () => {
      const ok = await requestConfirm({
        message: t(lang, 'providerDeleteConfirm'),
        confirmLabel: t(lang, 'delete'),
        cancelLabel: t(lang, 'cancel'),
        danger: true,
      });
      if (!ok) return;
      try {
        const providersNext = providers.filter((p) => p.id !== id);
        let nextDefaultPid = defaultProviderId;
        let nextDefaultMid = defaultModelId;
        if (defaultProviderId === id) {
          const fallback =
            providersNext.find((p) => p.models.some((m) => m.enabled)) ||
            providersNext[0] ||
            null;
          nextDefaultPid = fallback?.id || '';
          nextDefaultMid =
            fallback?.models.find((m) => m.enabled)?.id || fallback?.models[0]?.id || '';
        }
        commit({
          providers: providersNext,
          defaultProviderId: nextDefaultPid,
          defaultModelId: nextDefaultMid,
        });
        setExpandedIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        // Do not open another provider after delete (was: fall back to default).
        if (activeProviderId === id) {
          setActiveProviderId('');
        }
        setConnTest({ providerId: null, modelId: null, kind: 'idle' });
        const res = await window.okbot.clearModelBindingsForProvider({ providerId: id });
        if (res.cleared > 0) {
          toast.success(t(lang, 'providerBindingsCleared', { count: String(res.cleared) }));
        }
      } catch (err) {
        toast.error(formatSystemError(err));
      }
    })();
  }

  function setDefault(providerId: string, modelId: string) {
    commit({
      ...value,
      defaultProviderId: providerId,
      defaultModelId: modelId,
    });
  }

  function upsertModel(nextModel: CatalogModel) {
    if (!active) return;
    const prev = active.models;
    const idx = prev.findIndex((m) => m.id === nextModel.id);
    const models = sortCatalogModels(
      idx >= 0 ? prev.map((m, i) => (i === idx ? nextModel : m)) : [...prev, nextModel],
    );
    const providersNext = patchProvider(providers, active.id, { models });
    let nextDefaultPid = defaultProviderId;
    let nextDefaultMid = defaultModelId;
    if (!nextDefaultPid || !nextDefaultMid) {
      nextDefaultPid = active.id;
      nextDefaultMid = nextModel.id;
    }
    commit({
      providers: providersNext,
      defaultProviderId: nextDefaultPid,
      defaultModelId: nextDefaultMid,
    });
  }

  function removeModel(providerId: string, modelId: string) {
    const prov = providers.find((x) => x.id === providerId);
    if (!prov) return;
    const models = prov.models.filter((m) => m.id !== modelId);
    const providersNext = patchProvider(providers, providerId, { models });
    let nextDefaultPid = defaultProviderId;
    let nextDefaultMid = defaultModelId;
    if (defaultProviderId === providerId && defaultModelId === modelId) {
      nextDefaultMid = models.find((m) => m.enabled)?.id || models[0]?.id || '';
      if (!nextDefaultMid) {
        const fallback =
          providersNext.find((p) => p.id !== providerId && p.models.some((m) => m.enabled)) ||
          providersNext.find((p) => p.id !== providerId) ||
          null;
        nextDefaultPid = fallback?.id || providerId;
        nextDefaultMid =
          fallback?.models.find((m) => m.enabled)?.id || fallback?.models[0]?.id || '';
      }
    }
    commit({
      providers: providersNext,
      defaultProviderId: nextDefaultPid,
      defaultModelId: nextDefaultMid,
    });
    void window.okbot
      .clearModelBindingsForProvider({ providerId, removedModelIds: [modelId] })
      .then((res) => {
        if (res.cleared > 0) {
          toast.success(t(lang, 'modelBindingsCleared', { count: String(res.cleared) }));
        }
      })
      .catch((err) => toast.error(formatSystemError(err)));
  }

  function setModelEnabled(providerId: string, modelId: string, enabled: boolean) {
    const prov = providers.find((x) => x.id === providerId);
    if (!prov) return;
    const models = prov.models.map((m) => (m.id === modelId ? { ...m, enabled } : m));
    const providersNext = patchProvider(providers, providerId, { models });
    let nextDefaultPid = defaultProviderId;
    let nextDefaultMid = defaultModelId;
    if (!enabled && defaultProviderId === providerId && defaultModelId === modelId) {
      nextDefaultMid = models.find((m) => m.id !== modelId && m.enabled)?.id || '';
      if (!nextDefaultMid) {
        nextDefaultPid = '';
        nextDefaultMid = '';
      }
    } else if (enabled && (!defaultProviderId || !defaultModelId)) {
      nextDefaultPid = providerId;
      nextDefaultMid = modelId;
    }
    commit({
      providers: providersNext,
      defaultProviderId: nextDefaultPid,
      defaultModelId: nextDefaultMid,
    });
  }

  async function discover(opts: { soft: boolean; providerId?: string }) {
    const providerId = opts.providerId || activeProviderId;
    const prov = providers.find((x) => x.id === providerId) || null;
    if (!prov) return;
    const b = prov.baseURL.trim();
    const k = prov.apiKey.trim();
    const modelsSnapshot = prov.models;
    // Gateway clients see a blank key; the server uses the saved key for this provider.
    if (!b || (!k && !isGatewayClient())) {
      if (!opts.soft) {
        setDiscoverStatus({ kind: 'error', message: t(lang, 'modelDiscoverFail') });
      }
      return;
    }
    const key = `${providerId}||${b}||${k}`;
    if (opts.soft) {
      if (discoverTriedRef.current === key) return;
      if (modelsSnapshot.length > 0) {
        discoverTriedRef.current = key;
        return;
      }
    }
    discoverTriedRef.current = key;
    const seq = ++discoverSeqRef.current;
    setDiscoverStatus({ kind: 'loading', message: t(lang, 'modelDiscovering') });
    try {
      const res = await window.okbot.discoverModels({ baseURL: b, apiKey: k, providerId });
      // Stale response (newer keystroke/discover started) — do not write back.
      if (seq !== discoverSeqRef.current) return;
      if (!res.ok || !res.models?.length) {
        setDiscoverStatus({
          kind: 'error',
          message: probeErrorText(lang, res.error) || t(lang, 'modelDiscoverFail'),
        });
        return;
      }
      const byId = new Map(modelsSnapshot.map((m) => [m.id, m]));
      for (const m of res.models!) {
        const existing = byId.get(m.id);
        if (existing) {
          byId.set(m.id, { ...existing, name: existing.name || m.name });
        } else if (![...byId.values()].some((x) => x.name.trim() === m.name.trim())) {
          byId.set(m.id, m);
        }
      }
      const models = sortCatalogModels([...byId.values()]);
      const providersNext = patchProvider(providers, providerId, { models });
      let nextDefaultPid = defaultProviderId;
      let nextDefaultMid = defaultModelId;
      if (!nextDefaultPid || !nextDefaultMid) {
        nextDefaultPid = providerId;
        nextDefaultMid = models[0]!.id;
      } else if (
        nextDefaultPid === providerId &&
        !models.some((m) => m.id === nextDefaultMid)
      ) {
        nextDefaultMid = models[0]!.id;
      }
      commit({
        providers: providersNext,
        defaultProviderId: nextDefaultPid,
        defaultModelId: nextDefaultMid,
      });
      setDiscoverStatus({ kind: 'ok', message: t(lang, 'modelDiscoverOk') });
    } catch (err) {
      if (seq !== discoverSeqRef.current) return;
      setDiscoverStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : t(lang, 'modelDiscoverFail'),
      });
    }
  }

  async function testConnection(providerId: string, modelId: string) {
    const prov = providers.find((x) => x.id === providerId) || null;
    if (!prov) return;
    const b = prov.baseURL.trim();
    const k = prov.apiKey.trim();
    if (!b || (!k && !isGatewayClient())) {
      setConnTest({
        providerId,
        modelId,
        kind: 'error',
        message: t(lang, 'modelTestNeedCreds'),
      });
      return;
    }
    setConnTest({ providerId, modelId, kind: 'loading', message: t(lang, 'modelTesting') });
    try {
      const res = await window.okbot.testModelConnection({
        baseURL: b,
        apiKey: k,
        apiFormat: prov.apiFormat,
        modelId,
        providerId,
      });
      // Drop stale results if user switched provider mid-flight.
      if (activeProviderId !== providerId) return;
      if (!res.ok) {
        setConnTest({
          providerId,
          modelId,
          kind: 'error',
          message: probeErrorText(lang, res.error) || t(lang, 'modelTestFail'),
        });
        return;
      }
      setConnTest({ providerId, modelId, kind: 'ok', message: t(lang, 'modelTestOk') });
    } catch (err) {
      if (activeProviderId !== providerId) return;
      setConnTest({
        providerId,
        modelId,
        kind: 'error',
        message: err instanceof Error ? err.message : t(lang, 'modelTestFail'),
      });
    }
  }

  useEffect(() => {
    if (connTest.kind !== 'ok' && connTest.kind !== 'error') return;
    const handle = window.setTimeout(
      () => setConnTest({ providerId: null, modelId: null, kind: 'idle' }),
      3500,
    );
    return () => window.clearTimeout(handle);
  }, [connTest]);

  useEffect(() => {
    if (!active) return;
    if (discoverTimerRef.current != null) window.clearTimeout(discoverTimerRef.current);
    discoverTimerRef.current = window.setTimeout(() => {
      discoverTimerRef.current = null;
      void discover({ soft: true, providerId: active.id });
    }, 500);
    return () => {
      if (discoverTimerRef.current != null) {
        window.clearTimeout(discoverTimerRef.current);
        discoverTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.baseURL, active?.apiKey, lang]);

  useEffect(() => {
    if (discoverStatus.kind !== 'ok') return;
    const handle = window.setTimeout(() => setDiscoverStatus({ kind: 'idle' }), 2500);
    return () => window.clearTimeout(handle);
  }, [discoverStatus]);

  return (
    <div>
      <div className="settings-section-label" data-settings-id="customProviders">
        {t(lang, 'customProviders')}
      </div>
      <div className="settings-card settings-card-model provider-list-card">
        <div className="model-list-head">
          <span className="model-list-head-title">{t(lang, 'providerLabel')}</span>
          <div className="model-list-actions">
            <button type="button" className="model-list-btn" onClick={addProvider}>
              + {t(lang, 'providerAdd')}
            </button>
          </div>
        </div>
        {providers.length === 0 ? (
          <div className="model-list-empty">{t(lang, 'providerEmpty')}</div>
        ) : (
          <div className="provider-list">
            {providers.map((p) => {
              const open = expandedIds.has(p.id);
              const isDefaultProv = p.id === defaultProviderId;
              const toggleOpen = () => {
                setExpandedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(p.id)) next.delete(p.id);
                  else next.add(p.id);
                  return next;
                });
                if (open) {
                  // Collapsing this row only — leave peers alone.
                  if (activeProviderId === p.id) setActiveProviderId('');
                  return;
                }
                setActiveProviderId(p.id);
                setDiscoverStatus({ kind: 'idle' });
                setConnTest({ providerId: null, modelId: null, kind: 'idle' });
                discoverTriedRef.current = '';
                setShowKey(false);
              };
              return (
                <div
                  key={p.id}
                  className={`provider-item${open ? ' open' : ''}`}
                  data-settings-id={open ? 'model' : undefined}
                >
                  <div
                    className="provider-item-head provider-item-head-clickable"
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={toggleOpen}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleOpen();
                      }
                    }}
                  >
                    {renamingId === p.id ? (
                      <input
                        spellCheck={false}
                        className="provider-rename-input"
                        value={p.name}
                        placeholder={t(lang, 'providerNamePlaceholder')}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          commit({
                            ...value,
                            providers: patchProvider(providers, p.id, {
                              name: e.target.value,
                            }),
                          });
                        }}
                        onBlur={() => {
                          const name = p.name.trim() || DEFAULT_PROVIDER_NAME;
                          if (name !== p.name) {
                            commit({
                              ...value,
                              providers: patchProvider(providers, p.id, { name }),
                            });
                          }
                          setRenamingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          e.stopPropagation();
                        }}
                        autoFocus
                      />
                    ) : (
                      <span className="provider-item-name">
                        {p.name.trim() || DEFAULT_PROVIDER_NAME}
                        {isDefaultProv ? (
                          <span className="model-badge default">{t(lang, 'modelDefaultBadge')}</span>
                        ) : null}
                      </span>
                    )}
                    <div className="provider-item-actions">
                      <button
                        type="button"
                        className="model-icon-btn"
                        title={t(lang, 'providerName')}
                        aria-label={t(lang, 'providerName')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveProviderId(p.id);
                          setRenamingId(p.id);
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="model-icon-btn"
                        title={t(lang, 'providerDelete')}
                        aria-label={t(lang, 'providerDelete')}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteProvider(p.id);
                        }}
                      >
                        <TrashIcon />
                      </button>
                      <button
                        type="button"
                        className={`model-icon-btn aar-expand-btn${open ? ' expanded' : ''}`}
                        title={open ? t(lang, 'avatarPickerCollapse') : t(lang, 'avatarPickerExpand')}
                        aria-label={open ? t(lang, 'avatarPickerCollapse') : t(lang, 'avatarPickerExpand')}
                        aria-expanded={open}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleOpen();
                        }}
                      >
                        <ChevronDownIcon />
                      </button>
                    </div>
                  </div>
                  {open ? (
                    <div className="provider-item-body">
                      <div className="settings-section-label" data-settings-id="baseURL">
                        {t(lang, 'api')}
                      </div>
                      <div className="settings-card settings-card-model provider-nested-card">
                        <div className="settings-row">
                          <span className="settings-row-label">BaseURL</span>
                          <input
                            spellCheck={false}
                            className="wide"
                            placeholder="https://api.example.com/v1"
                            value={p.baseURL}
                            onChange={(e) => {
                              discoverTriedRef.current = '';
                              setActiveProviderId(p.id);
                              updateProvider(p.id, { baseURL: e.target.value });
                            }}
                          />
                        </div>
                        <div className="settings-row" data-settings-id="apiFormat">
                          <span className="settings-row-label">
                            <span className="settings-row-label-text">{t(lang, 'apiFormat')}</span>
                          </span>
                          <select
                            className="settings-row-select"
                            value={p.apiFormat}
                            onChange={(e) => {
                              setActiveProviderId(p.id);
                              updateProvider(p.id, { apiFormat: e.target.value as ApiFormat });
                            }}
                          >
                            <option value="chat_completions">{t(lang, 'apiFormatChatCompletions')}</option>
                            <option value="responses">{t(lang, 'apiFormatResponses')}</option>
                          </select>
                        </div>
                        <div className="settings-row" data-settings-id="apiKey">
                          <span className="settings-row-label">API Key</span>
                          <div className="settings-secret">
                            <input
                              spellCheck={false}
                              className="wide"
                              type={showKey ? 'text' : 'password'}
                              placeholder="sk-..."
                              value={p.apiKey}
                              onChange={(e) => {
                                discoverTriedRef.current = '';
                                setActiveProviderId(p.id);
                                updateProvider(p.id, { apiKey: e.target.value });
                              }}
                              autoComplete="off"
                            />
                            <button
                              type="button"
                              className="settings-eye"
                              aria-label={showKey ? 'Hide' : 'Show'}
                              onClick={() => setShowKey((v) => !v)}
                            >
                              {showKey ? <EyeOffIcon /> : <EyeIcon />}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="settings-section-label" data-settings-id="modelList">
                        {t(lang, 'modelList')}
                      </div>
                      <div className="settings-card settings-card-model model-list-card provider-nested-card">
                        <div className="model-list-head">
                          <span className="model-list-head-title">{t(lang, 'nameLabel')}</span>
                          <div className="model-list-actions">
                            <button
                              type="button"
                              className="model-list-btn"
                              disabled={
                                discoverStatus.kind === 'loading' ||
                                !p.baseURL.trim() ||
                                !p.apiKey.trim()
                              }
                              onClick={() => {
                                setActiveProviderId(p.id);
                                void discover({ soft: false, providerId: p.id });
                              }}
                            >
                              {t(lang, 'modelDiscoverRetry')}
                            </button>
                            <button
                              type="button"
                              className="model-list-btn"
                              onClick={() => { setActiveProviderId(p.id); setModelEditor({ mode: 'add' }); }}
                            >
                              + {t(lang, 'modelAdd')}
                            </button>
                          </div>
                        </div>
                        {activeProviderId === p.id && discoverStatus.kind !== 'idle' ? (
                          <div
                            className={`model-list-status${
                              discoverStatus.kind === 'error'
                                ? ' error'
                                : discoverStatus.kind === 'ok'
                                  ? ' ok'
                                  : ''
                            }`}
                          >
                            {discoverStatus.message}
                          </div>
                        ) : null}
                        {connTest.kind !== 'idle' && connTest.modelId && connTest.providerId === p.id ? (
                          <div
                            className={`model-list-status${
                              connTest.kind === 'error' ? ' error' : connTest.kind === 'ok' ? ' ok' : ''
                            }`}
                          >
                            {connTest.message}
                          </div>
                        ) : null}
                        <div ref={modelListScrollRef} className="model-list-scroll scroll-fade">
                          {sortCatalogModels(p.models).length === 0 ? (
                            <div className="model-list-empty">{t(lang, 'modelEmpty')}</div>
                          ) : (
                            sortCatalogModels(p.models).map((m) => {
                              const isDefault =
                                p.id === defaultProviderId && m.id === defaultModelId;
                              return (
                                <div key={m.id} className="model-row">
                                  <div className="model-row-main">
                                    <span className="model-row-name">{m.name || m.id}</span>
                                    <span className="model-badge context">
                                      {formatContextWindowBadge(m.contextWindow)}
                                    </span>
                                    {isDefault ? (
                                      <span className="model-badge default">{t(lang, 'modelDefaultBadge')}</span>
                                    ) : null}
                                  </div>
                                  <div className="model-row-trailing">
                                    <button
                                      type="button"
                                      className={`model-icon-btn${
                                        connTest.providerId === p.id && connTest.modelId === m.id && connTest.kind === 'ok'
                                          ? ' active'
                                          : ''
                                      }`}
                                      title={t(lang, 'modelTestConnection')}
                                      aria-label={t(lang, 'modelTestConnection')}
                                      disabled={
                                        connTest.providerId === p.id && connTest.kind === 'loading' && connTest.modelId === m.id
                                      }
                                      onClick={() => {
                                        setActiveProviderId(p.id);
                                        void testConnection(p.id, m.id);
                                      }}
                                    >
                                      {connTest.providerId === p.id && connTest.modelId === m.id && connTest.kind === 'loading' ? (
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
                                      title={t(lang, 'modelEdit')}
                                      aria-label={t(lang, 'modelEdit')}
                                      onClick={() => { setActiveProviderId(p.id); setModelEditor({ mode: 'edit', model: m }); }}
                                    >
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      className="model-icon-btn"
                                      title={t(lang, 'modelDelete')}
                                      aria-label={t(lang, 'modelDelete')}
                                      onClick={() => {
                                        void (async () => {
                                          const ok = await requestConfirm({
                                            message: t(lang, 'modelDeleteConfirm'),
                                            confirmLabel: t(lang, 'delete'),
                                            cancelLabel: t(lang, 'cancel'),
                                            danger: true,
                                          });
                                          if (ok) {
                                            setActiveProviderId(p.id);
                                            removeModel(p.id, m.id);
                                          }
                                        })();
                                      }}
                                    >
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                                      </svg>
                                    </button>
                                    <SettingsToggle
                                      checked={m.enabled}
                                      onChange={() => {
                                        setActiveProviderId(p.id);
                                        setModelEnabled(p.id, m.id, !m.enabled);
                                      }}
                                    />
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="settings-section-label" style={{ marginTop: 16 }} data-settings-id="defaultModel">
        {t(lang, 'defaultModelLabel')}
      </div>
      <div className="settings-card settings-card-model">
        <div className="settings-row">
          <span className="settings-row-label">
            <span className="settings-row-label-text">{t(lang, 'defaultModelLabel')}</span>
            <SettingsHelpTip text={t(lang, 'defaultModelHint')} />
          </span>
          <ModelRefSelect
            lang={lang}
            providers={providers}
            providerId={defaultProviderId}
            modelId={defaultModelId}
            defaultProviderId={defaultProviderId}
            defaultModelId={defaultModelId}
            onChange={({ providerId, modelId }) => {
              if (!providerId || !modelId) return;
              setDefault(providerId, modelId);
            }}
          />
        </div>
      </div>

      {modelEditor && active ? (
        <ModelEditDialog
          lang={lang}
          mode={modelEditor.mode}
          initial={
            modelEditor.mode === 'edit'
              ? modelEditor.model
              : { id: '', name: '', contextWindow: 128000, maxTokens: null, enabled: true }
          }
          existingIds={active.models.map((m) => m.id)}
          existingNames={active.models
            .filter((m) => modelEditor.mode !== 'edit' || m.id !== modelEditor.model.id)
            .map((m) => m.name || m.id)}
          onCancel={() => setModelEditor(null)}
          onSave={(nextModel) => {
            if (modelEditor.mode === 'edit') {
              const prevId = modelEditor.model.id;
              const models = sortCatalogModels(
                active.models.map((m) => (m.id === prevId ? nextModel : m)),
              );
              const providersNext = patchProvider(providers, active.id, { models });
              let nextDefaultMid = defaultModelId;
              if (defaultProviderId === active.id && defaultModelId === prevId) {
                nextDefaultMid = nextModel.id;
              }
              commit({
                providers: providersNext,
                defaultProviderId,
                defaultModelId: nextDefaultMid,
              });
            } else {
              upsertModel(nextModel);
            }
            setModelEditor(null);
          }}
        />
      ) : null}
    </div>
  );
}
