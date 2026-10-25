import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import {
  createGatewayApiTokenEntry,
  createGatewayApiTokenId,
  generateGatewayHttpApiToken,
  normalizeGatewayApiTokenLimits,
  sanitizeGatewayHttpApiToken,
  totalTokensUsed,
  type Bot,
  type GatewayApiTokenEntry,
  type GatewayApiTokenLimits,
  type GatewayAuthRole,
  type Squad,
  type TokenUsage,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { requestConfirm, toast } from '../../components/ui';
import {
  ChevronDownIcon,
  CopyIcon,
  EditIcon,
  EyeIcon,
  EyeOffIcon,
  TokenUsageBarsIcon,
  TrashIcon,
} from '../../components/ui/icons';
import { SettingsHelpTip } from './SettingsHelpTip';

type ApiTokenOwnerCounters = { messages: number; tokens: TokenUsage };
type ApiTokenUsageBucket = {
  lifetime: ApiTokenOwnerCounters;
  daily: Record<string, ApiTokenOwnerCounters>;
  byOwner: Record<string, ApiTokenOwnerCounters>;
};

type Draft = {
  name: string;
  role: GatewayAuthRole;
  dailyMessages: string;
  totalMessages: string;
  dailyTokens: string;
  totalTokens: string;
};

const emptyDraft = (role: GatewayAuthRole = 'access'): Draft => ({
  name: '',
  role,
  dailyMessages: '',
  totalMessages: '',
  dailyTokens: '',
  totalTokens: '',
});

function limitToField(n: number): string {
  return n > 0 ? String(n) : '';
}

function fieldToLimit(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

function draftFromEntry(e: GatewayApiTokenEntry): Draft {
  return {
    name: e.name,
    role: e.role,
    dailyMessages: limitToField(e.limits.dailyMessages),
    totalMessages: limitToField(e.limits.totalMessages),
    dailyTokens: limitToField(e.limits.dailyTokens),
    totalTokens: limitToField(e.limits.totalTokens),
  };
}

function limitsFromDraft(d: Draft): GatewayApiTokenLimits {
  return normalizeGatewayApiTokenLimits({
    dailyMessages: fieldToLimit(d.dailyMessages),
    totalMessages: fieldToLimit(d.totalMessages),
    dailyTokens: fieldToLimit(d.dailyTokens),
    totalTokens: fieldToLimit(d.totalTokens),
  });
}

function formatLimit(n: number, lang: UiLang): string {
  return n > 0 ? String(n) : t(lang, 'gatewayApiTokenUnlimited');
}

function TokenLimitFields({
  lang,
  draft,
  disabled,
  onChange,
}: {
  lang: UiLang;
  draft: Draft;
  disabled?: boolean;
  onChange: (next: Draft) => void;
}) {
  return (
    <>
      <p className="settings-hint" style={{ margin: '0 12px 8px' }}>
        {t(lang, 'gatewayApiTokenLimitHint')}
      </p>
      <div className="settings-row">
        <span className="settings-row-label">
          <span className="settings-row-label-text">{t(lang, 'gatewayApiTokenDailyMessages')}</span>
        </span>
        <input
          className="wide"
          type="number"
          min={0}
          disabled={disabled}
          placeholder={t(lang, 'gatewayApiTokenUnlimited')}
          value={draft.dailyMessages}
          onChange={(e) => onChange({ ...draft, dailyMessages: e.target.value })}
        />
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          <span className="settings-row-label-text">{t(lang, 'gatewayApiTokenTotalMessages')}</span>
        </span>
        <input
          className="wide"
          type="number"
          min={0}
          disabled={disabled}
          placeholder={t(lang, 'gatewayApiTokenUnlimited')}
          value={draft.totalMessages}
          onChange={(e) => onChange({ ...draft, totalMessages: e.target.value })}
        />
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          <span className="settings-row-label-text">{t(lang, 'gatewayApiTokenDailyTokens')}</span>
        </span>
        <input
          className="wide"
          type="number"
          min={0}
          disabled={disabled}
          placeholder={t(lang, 'gatewayApiTokenUnlimited')}
          value={draft.dailyTokens}
          onChange={(e) => onChange({ ...draft, dailyTokens: e.target.value })}
        />
      </div>
      <div className="settings-row">
        <span className="settings-row-label">
          <span className="settings-row-label-text">{t(lang, 'gatewayApiTokenTotalTokens')}</span>
        </span>
        <input
          className="wide"
          type="number"
          min={0}
          disabled={disabled}
          placeholder={t(lang, 'gatewayApiTokenUnlimited')}
          value={draft.totalTokens}
          onChange={(e) => onChange({ ...draft, totalTokens: e.target.value })}
        />
      </div>
    </>
  );
}

function TokenUsageSection({
  lang,
  entry,
  bots,
  squads,
}: {
  lang: UiLang;
  entry: GatewayApiTokenEntry;
  bots: Bot[];
  squads: Squad[];
}) {
  const [usage, setUsage] = useState<ApiTokenUsageBucket | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const bridge = window.okbot as {
          getApiTokenUsage?: (id: string) => Promise<Record<string, unknown>>;
        };
        if (typeof bridge.getApiTokenUsage !== 'function') {
          if (!cancelled) {
            setError(t(lang, 'gatewayApiTokenUsageUnavailable'));
            setLoading(false);
          }
          return;
        }
        const res = await bridge.getApiTokenUsage(entry.id);
        if (cancelled) return;
        if (!res || res.ok === false) {
          setError(typeof res?.error === 'string' ? res.error : t(lang, 'gatewayApiTokenUsageUnavailable'));
          setUsage(null);
        } else {
          setUsage((res.usage as ApiTokenUsageBucket) || null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.id, lang]);

  const ownerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of bots) map.set(b.id, b.name || b.id);
    for (const s of squads) map.set(s.id, s.name || s.id);
    return (id: string) => map.get(id) || id;
  }, [bots, squads]);

  const rows = useMemo(() => {
    const byOwner = usage?.byOwner || {};
    return Object.entries(byOwner)
      .map(([id, c]) => ({
        id,
        name: ownerName(id),
        kind: bots.some((b) => b.id === id) ? 'bot' : squads.some((s) => s.id === id) ? 'squad' : 'unknown',
        messages: c?.messages || 0,
        tokens: totalTokensUsed(c?.tokens),
      }))
      .sort((a, b) => b.tokens - a.tokens || b.messages - a.messages || a.name.localeCompare(b.name));
  }, [usage, ownerName, bots, squads]);

  const life = usage?.lifetime;

  return (
    <div style={{ marginTop: 8 }}>
      <div className="settings-section-label" style={{ marginTop: 4 }}>
        {t(lang, 'gatewayApiTokenUsageTitle')}
      </div>
      {loading ? <p className="settings-hint" style={{ margin: '0 12px 8px' }}>{t(lang, 'loading')}</p> : null}
      {error ? (
        <p className="settings-hint" style={{ margin: '0 12px 8px', color: 'var(--danger, #c44)' }}>
          {error}
        </p>
      ) : null}
      {!loading && !error ? (
        <>
          <p className="settings-hint" style={{ margin: '0 12px 8px' }}>
            {t(lang, 'gatewayApiTokenUsageLifetime')}: {life?.messages || 0}{' '}
            {t(lang, 'gatewayApiTokenMessagesUnit')} / {formatTokens(totalTokensUsed(life?.tokens))}{' '}
            {t(lang, 'gatewayApiTokenTokensUnit')}
          </p>
          {rows.length === 0 ? (
            <p className="settings-hint" style={{ margin: '0 12px 8px' }}>
              {t(lang, 'gatewayApiTokenUsageEmpty')}
            </p>
          ) : (
            <div className="settings-card settings-card-model model-list-card" style={{ margin: '0 8px 8px' }}>
              <div className="model-list-head">
                <span className="model-list-head-title">{t(lang, 'gatewayApiTokenUsageOwner')}</span>
                <span className="settings-hint" style={{ marginRight: 8 }}>
                  {t(lang, 'gatewayApiTokenUsageChats')} / {t(lang, 'gatewayApiTokenUsageTokens')}
                </span>
              </div>
              {rows.map((row) => (
                <div key={row.id} className="model-row">
                  <div className="model-row-main">
                    <span className="model-row-name">
                      {row.name}
                      <span className="settings-hint" style={{ marginLeft: 6 }}>
                        {row.kind === 'squad'
                          ? t(lang, 'gatewayApiTokenUsageSquad')
                          : row.kind === 'bot'
                            ? t(lang, 'gatewayApiTokenUsageBot')
                            : ''}
                      </span>
                    </span>
                  </div>
                  <div className="model-row-trailing">
                    <span className="settings-hint">
                      {row.messages} / {formatTokens(row.tokens)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function TokenSecretInput({
  lang,
  value,
  show,
  onToggleShow,
  stopHeadClick,
}: {
  lang: UiLang;
  value: string;
  show: boolean;
  onToggleShow: () => void;
  stopHeadClick?: boolean;
}) {
  const stop = stopHeadClick
    ? (e: SyntheticEvent) => {
        e.stopPropagation();
      }
    : undefined;

  return (
    <div
      className="settings-secret settings-secret-multi"
      style={{ flex: 1, minWidth: 0 }}
      onClick={stop}
      onKeyDown={stop}
    >
      <input
        type={show ? 'text' : 'password'}
        className="wide"
        value={value}
        readOnly
        spellCheck={false}
        autoComplete="off"
        onClick={stop}
        onFocus={stop}
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
      />
      <div className="settings-secret-actions">
        <button
          type="button"
          className="settings-eye"
          aria-label={t(lang, show ? 'gatewayHttpApiHideToken' : 'gatewayHttpApiShowToken')}
          title={t(lang, show ? 'gatewayHttpApiHideToken' : 'gatewayHttpApiShowToken')}
          onClick={(e) => {
            e.stopPropagation();
            onToggleShow();
          }}
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
        <button
          type="button"
          className="settings-eye"
          aria-label={t(lang, 'gatewayHttpApiCopyToken')}
          title={t(lang, 'gatewayHttpApiCopyToken')}
          onClick={(e) => {
            e.stopPropagation();
            void (async () => {
              const secret = sanitizeGatewayHttpApiToken(value);
              if (!secret) {
                toast.info(t(lang, 'gatewayApiTokenEmptySecret'));
                return;
              }
              await window.okbot.copyText(secret);
              toast.success(t(lang, 'gatewayHttpApiTokenCopied'));
            })();
          }}
        >
          <CopyIcon />
        </button>
      </div>
    </div>
  );
}

export function GatewayApiTokensPanel({
  lang,
  apiTokens,
  onChange,
  bots,
  squads,
  readOnly,
}: {
  lang: UiLang;
  apiTokens: GatewayApiTokenEntry[];
  onChange: (next: GatewayApiTokenEntry[]) => void;
  bots: Bot[];
  squads: Squad[];
  readOnly?: boolean;
}) {
  /** Independent expand flags — match gateway / provider list (not accordion). */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft());
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(() => emptyDraft('access'));
  const [showIds, setShowIds] = useState<Record<string, boolean>>({});

  function toggleOpen(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (editingId === id) {
          setEditingId(null);
        }
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function beginEdit(entry: GatewayApiTokenEntry) {
    if (readOnly) return;
    setAdding(false);
    setEditingId(entry.id);
    setEditDraft(draftFromEntry(entry));
    setExpandedIds((prev) => {
      const n = new Set(prev);
      n.add(entry.id);
      return n;
    });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function submitEdit() {
    if (!editingId) return;
    if (!editDraft.name.trim()) {
      toast.info(t(lang, 'gatewayApiTokenNameRequired'));
      return;
    }
    const entry = apiTokens.find((e) => e.id === editingId);
    if (!entry) return;
    const limits = limitsFromDraft(editDraft);
    const now = new Date().toISOString();
    onChange(
      apiTokens.map((e) =>
        e.id === editingId
          ? {
              ...e,
              name: editDraft.name.trim().slice(0, 64) || e.name,
              role: editDraft.role,
              limits,
              updatedAt: now,
            }
          : e,
      ),
    );
    toast.success(t(lang, 'gatewayApiTokenUpdated'));
    setEditingId(null);
  }

  function submitAdd() {
    if (!addDraft.name.trim()) {
      toast.info(t(lang, 'gatewayApiTokenNameRequired'));
      return;
    }
    const limits = limitsFromDraft(addDraft);
    const now = new Date().toISOString();
    const avoid = apiTokens.map((e) => e.token);
    let token = generateGatewayHttpApiToken(addDraft.role);
    let guard = 0;
    while (avoid.includes(token) && guard++ < 8) {
      token = generateGatewayHttpApiToken(addDraft.role);
    }
    const entry = createGatewayApiTokenEntry({
      id: createGatewayApiTokenId(),
      name: addDraft.name,
      role: addDraft.role,
      token,
      limits,
      createdAt: now,
      updatedAt: now,
    });
    onChange([...apiTokens, entry]);
    setExpandedIds((prev) => {
      const n = new Set(prev);
      n.add(entry.id);
      return n;
    });
    setAdding(false);
    setAddDraft(emptyDraft('access'));
    toast.success(t(lang, 'gatewayApiTokenCreated'));
  }

  async function regenerateToken(entry: GatewayApiTokenEntry) {
    if (readOnly) return;
    const ok = await requestConfirm({
      message: t(lang, 'gatewayApiTokenRegenerateConfirm'),
      confirmLabel: t(lang, 'gatewayApiTokenRegenerate'),
      cancelLabel: t(lang, 'cancel'),
      danger: true,
    });
    if (!ok) return;
    const avoid = apiTokens.map((e) => e.token);
    let next = generateGatewayHttpApiToken(entry.role);
    let guard = 0;
    while (avoid.includes(next) && guard++ < 8) {
      next = generateGatewayHttpApiToken(entry.role);
    }
    onChange(
      apiTokens.map((e) =>
        e.id === entry.id ? { ...e, token: next, updatedAt: new Date().toISOString() } : e,
      ),
    );
    toast.success(t(lang, 'gatewayApiTokenRegenerated'));
  }

  async function deleteToken(entry: GatewayApiTokenEntry) {
    if (readOnly) return;
    const admins = apiTokens.filter((e) => e.role === 'admin');
    if (entry.role === 'admin' && admins.length <= 1) {
      toast.info(t(lang, 'gatewayApiTokenKeepOneAdmin'));
      return;
    }
    const ok = await requestConfirm({
      message: t(lang, 'gatewayApiTokenDeleteConfirm'),
      confirmLabel: t(lang, 'delete'),
      cancelLabel: t(lang, 'cancel'),
      danger: true,
    });
    if (!ok) return;
    onChange(apiTokens.filter((e) => e.id !== entry.id));
    setExpandedIds((prev) => {
      const n = new Set(prev);
      n.delete(entry.id);
      return n;
    });
    if (editingId === entry.id) setEditingId(null);
  }

  return (
    <div>
      <div
        className="settings-section-label settings-section-label-with-help"
        data-settings-id="gatewayApiTokens"
        style={{ marginTop: 12 }}
      >
        <span>{t(lang, 'gatewayApiTokens')}</span>
        <SettingsHelpTip text={t(lang, 'gatewayApiTokensHint')} />
      </div>

      <div className="settings-card settings-card-model provider-list-card">
        <div className="model-list-head">
          <span className="model-list-head-title">{t(lang, 'gatewayApiTokenName')}</span>
          <div className="model-list-actions">
            <button
              type="button"
              className="model-list-btn"
              disabled={readOnly}
              onClick={() => {
                cancelEdit();
                setAdding((v) => !v);
              }}
            >
              + {t(lang, 'gatewayApiTokenAdd')}
            </button>
          </div>
        </div>

        {apiTokens.length === 0 && !adding ? (
          <p className="settings-hint" style={{ padding: '8px 12px' }}>
            {t(lang, 'gatewayApiTokensEmpty')}
          </p>
        ) : (
          <div className="provider-list">
            {apiTokens.map((entry) => {
              const open = expandedIds.has(entry.id);
              const editing = editingId === entry.id;
              const show = showIds[entry.id] === true;
              const roleLabel =
                entry.role === 'admin'
                  ? t(lang, 'gatewayApiTokenTypeAdmin')
                  : t(lang, 'gatewayApiTokenTypeUser');
              return (
                <div key={entry.id} className={`provider-item${open ? ' open' : ''}`}>
                  <div
                    className="provider-item-head provider-item-head-clickable"
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => toggleOpen(entry.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleOpen(entry.id);
                      }
                    }}
                  >
                    <span
                      className="provider-item-name"
                      style={{ flex: '0 1 auto', maxWidth: '34%' }}
                    >
                      {entry.name}
                      <span className="settings-muted" style={{ fontWeight: 400, fontSize: 12 }}>
                        {roleLabel}
                      </span>
                    </span>
                    <TokenSecretInput
                      lang={lang}
                      value={entry.token}
                      show={show}
                      stopHeadClick
                      onToggleShow={() => setShowIds((m) => ({ ...m, [entry.id]: !show }))}
                    />
                    <div className="provider-item-actions">
                      <button
                        type="button"
                        className="model-icon-btn"
                        title={t(lang, 'gatewayApiTokenUsage')}
                        aria-label={t(lang, 'gatewayApiTokenUsage')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedIds((prev) => {
                            const n = new Set(prev);
                            n.add(entry.id);
                            return n;
                          });
                        }}
                      >
                        <TokenUsageBarsIcon />
                      </button>
                      <button
                        type="button"
                        className="model-icon-btn"
                        title={t(lang, 'gatewayApiTokenRegenerate')}
                        aria-label={t(lang, 'gatewayApiTokenRegenerate')}
                        disabled={readOnly}
                        onClick={(e) => {
                          e.stopPropagation();
                          void regenerateToken(entry);
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                          <path d="M3 3v5h5" />
                          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                          <path d="M16 16h5v5" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="model-icon-btn"
                        title={t(lang, 'gatewayApiTokenEdit')}
                        aria-label={t(lang, 'gatewayApiTokenEdit')}
                        disabled={readOnly}
                        onClick={(e) => {
                          e.stopPropagation();
                          beginEdit(entry);
                        }}
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        className="model-icon-btn"
                        title={t(lang, 'delete')}
                        aria-label={t(lang, 'delete')}
                        disabled={readOnly}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteToken(entry);
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
                          toggleOpen(entry.id);
                        }}
                      >
                        <ChevronDownIcon />
                      </button>
                    </div>
                  </div>
                  {open ? (
                    <div className="provider-item-body">
                      <div className="settings-card settings-card-model provider-nested-card">
                        {editing ? (
                          <>
                            <div className="settings-row">
                              <span className="settings-row-label">
                                <span className="settings-row-label-text">{t(lang, 'gatewayApiTokenName')}</span>
                              </span>
                              <input
                                className="wide"
                                spellCheck={false}
                                value={editDraft.name}
                                onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                              />
                            </div>
                            <div className="settings-row">
                              <span className="settings-row-label">
                                <span className="settings-row-label-text">{t(lang, 'gatewayApiTokenType')}</span>
                              </span>
                              <span className="settings-select-chevron-host">
                                <select
                                  value={editDraft.role}
                                  onChange={(e) =>
                                    setEditDraft((d) => ({
                                      ...d,
                                      role: e.target.value === 'admin' ? 'admin' : 'access',
                                    }))
                                  }
                                >
                                  <option value="access">{t(lang, 'gatewayApiTokenTypeUser')}</option>
                                  <option value="admin">{t(lang, 'gatewayApiTokenTypeAdmin')}</option>
                                </select>
                              </span>
                            </div>
                            <TokenLimitFields
                              lang={lang}
                              draft={editDraft}
                              onChange={setEditDraft}
                            />
                            <div className="model-edit-actions" style={{ padding: '0 12px 10px' }}>
                              <button type="button" className="ghost" onClick={() => cancelEdit()}>
                                {t(lang, 'cancel')}
                              </button>
                              <button type="button" className="primary" onClick={() => submitEdit()}>
                                {t(lang, 'save')}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="settings-row">
                              <span className="settings-row-label">
                                <span className="settings-row-label-text">{t(lang, 'gatewayApiTokenType')}</span>
                              </span>
                              <span className="settings-row-meta">{roleLabel}</span>
                            </div>
                            <div className="settings-row">
                              <span className="settings-row-label">
                                <span className="settings-row-label-text">{t(lang, 'gatewayApiTokenDailyMessages')}</span>
                              </span>
                              <span className="settings-row-meta">
                                {formatLimit(entry.limits.dailyMessages, lang)}
                              </span>
                            </div>
                            <div className="settings-row">
                              <span className="settings-row-label">
                                <span className="settings-row-label-text">{t(lang, 'gatewayApiTokenTotalMessages')}</span>
                              </span>
                              <span className="settings-row-meta">
                                {formatLimit(entry.limits.totalMessages, lang)}
                              </span>
                            </div>
                            <div className="settings-row">
                              <span className="settings-row-label">
                                <span className="settings-row-label-text">{t(lang, 'gatewayApiTokenDailyTokens')}</span>
                              </span>
                              <span className="settings-row-meta">
                                {formatLimit(entry.limits.dailyTokens, lang)}
                              </span>
                            </div>
                            <div className="settings-row">
                              <span className="settings-row-label">
                                <span className="settings-row-label-text">{t(lang, 'gatewayApiTokenTotalTokens')}</span>
                              </span>
                              <span className="settings-row-meta">
                                {formatLimit(entry.limits.totalTokens, lang)}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                      <TokenUsageSection lang={lang} entry={entry} bots={bots} squads={squads} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {adding ? (
          <div style={{ padding: '10px 12px 12px' }}>
            <div className="settings-card settings-card-model">
              <div className="settings-row">
                <span className="settings-row-label">
                  <span className="settings-row-label-text">{t(lang, 'gatewayApiTokenName')}</span>
                </span>
                <input
                  className="wide"
                  spellCheck={false}
                  autoFocus
                  value={addDraft.name}
                  onChange={(e) => setAddDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
              <div className="settings-row">
                <span className="settings-row-label">
                  <span className="settings-row-label-text">{t(lang, 'gatewayApiTokenType')}</span>
                </span>
                <span className="settings-select-chevron-host">
                  <select
                    value={addDraft.role}
                    onChange={(e) =>
                      setAddDraft((d) => ({
                        ...d,
                        role: e.target.value === 'admin' ? 'admin' : 'access',
                      }))
                    }
                  >
                    <option value="access">{t(lang, 'gatewayApiTokenTypeUser')}</option>
                    <option value="admin">{t(lang, 'gatewayApiTokenTypeAdmin')}</option>
                  </select>
                </span>
              </div>
              <TokenLimitFields lang={lang} draft={addDraft} onChange={setAddDraft} />
            </div>
            <div className="model-edit-actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setAdding(false);
                  setAddDraft(emptyDraft('access'));
                }}
              >
                {t(lang, 'cancel')}
              </button>
              <button type="button" className="primary" onClick={() => submitAdd()}>
                {t(lang, 'save')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
