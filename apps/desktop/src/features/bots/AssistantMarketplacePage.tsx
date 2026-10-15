import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createId,
  normalizeMcpSettings,
  type AppSettings,
  type Bot,
  type McpServerEntry,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { CloseIcon } from '../../components/ui/icons';
import { toast, requestConfirm } from '../../components/ui';
import { formatSystemError } from '../../utils/formatSystemError';
import { AssistantGalleryList } from './AssistantGallery';
import {
  MARKETPLACE_CONNECTOR_PRESETS,
  type MarketplaceConnectorPreset,
} from './marketplaceConnectors';

const MAX_SAVED = 20;

type MarketTab = 'assistants' | 'connectors';

function normalizeSources(settings: AppSettings | null | undefined): string[] {
  const list = settings?.assistantMarketplace?.savedSources;
  return Array.isArray(list) ? list.filter((u) => typeof u === 'string' && u.trim()) : [];
}

function isNameExistsError(msg: string): { name: string } | null {
  const m = msg.trim();
  if (m.startsWith('assistant_name_exists:')) {
    return { name: m.slice('assistant_name_exists:'.length).trim() || '' };
  }
  if (m === 'assistant_name_exists') return { name: '' };
  return null;
}

function isAbortError(msg: string): boolean {
  return /import_aborted|aborted|AbortError/i.test(msg);
}

function presetAlreadyInstalled(settings: AppSettings | null | undefined, preset: MarketplaceConnectorPreset): boolean {
  const servers = settings?.mcp?.servers ?? [];
  return servers.some((s) => {
    if (s.id === preset.id) return true;
    if (s.transport !== 'stdio') return false;
    const cmd = (s.command || '').trim();
    const args = (s.args || []).join(' ');
    return cmd === preset.command && args === preset.args.join(' ');
  });
}

/**
 * Full-page assistant marketplace in the main chat area (not a modal).
 * Tabs: 助手 (built-in + GitHub) · 连接器 (MCP presets).
 */
export function AssistantMarketplacePage({
  lang,
  modelReady,
  existingNames,
  settings,
  onClose,
  onInstalled,
  onSettingsPatch,
  onOpenMcpSettings,
}: {
  lang: UiLang;
  modelReady: boolean;
  existingNames: readonly string[];
  settings: AppSettings | null;
  onClose: () => void;
  onInstalled: (bot: Bot) => void;
  /** Persist savedSources after a successful remote import (or remove). */
  onSettingsPatch: (next: AppSettings) => void | Promise<void>;
  /** Jump to Settings → MCP extensions. */
  onOpenMcpSettings?: () => void;
}) {
  const [tab, setTab] = useState<MarketTab>('assistants');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [remoteError, setRemoteError] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);
  const saved = normalizeSources(settings);
  const importGen = useRef(0);
  const tabTrackRef = useRef<HTMLDivElement>(null);
  const assistantsTabRef = useRef<HTMLButtonElement>(null);
  const connectorsTabRef = useRef<HTMLButtonElement>(null);
  const [pill, setPill] = useState({ left: 0, width: 0 });

  const syncPill = useCallback(() => {
    const track = tabTrackRef.current;
    const btn = tab === 'assistants' ? assistantsTabRef.current : connectorsTabRef.current;
    if (!track || !btn) return;
    const trackBox = track.getBoundingClientRect();
    const btnBox = btn.getBoundingClientRect();
    setPill({ left: btnBox.left - trackBox.left, width: btnBox.width });
  }, [tab]);

  useLayoutEffect(() => {
    syncPill();
  }, [syncPill, lang]);

  useEffect(() => {
    const onResize = () => syncPill();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [syncPill]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const persistSources = useCallback(
    async (nextSources: string[]) => {
      if (!settings) return;
      const next: AppSettings = {
        ...settings,
        assistantMarketplace: { savedSources: nextSources.slice(0, MAX_SAVED) },
      };
      await onSettingsPatch(next);
    },
    [settings, onSettingsPatch],
  );

  function cancelImport() {
    importGen.current += 1;
    try {
      void window.okbot.cancelImportAssistantFromUrl?.();
    } catch {
      /* ignore */
    }
    setBusy(false);
    setRemoteError('');
  }

  async function runImport(trimmed: string, overwrite: boolean, gen: number): Promise<Bot | null> {
    try {
      const bot = await window.okbot.importAssistantFromUrl(trimmed, { overwrite });
      if (gen !== importGen.current) return null;
      return bot;
    } catch (err) {
      if (gen !== importGen.current) return null;
      const msg = formatSystemError(err);
      if (isAbortError(msg)) return null;
      const clash = isNameExistsError(msg);
      if (clash && !overwrite) {
        const name = clash.name || trimmed;
        const alreadyKnown =
          existingNames.some((n) => n.trim() === name) || Boolean(clash.name);
        if (alreadyKnown) {
          const ok = await requestConfirm({
            title: t(lang, 'galleryRemoteOverwriteTitle'),
            message: t(lang, 'galleryRemoteOverwriteMessage', { name }),
            confirmLabel: t(lang, 'galleryRemoteOverwriteConfirm'),
            cancelLabel: t(lang, 'cancel'),
            danger: false,
          });
          if (gen !== importGen.current) return null;
          if (!ok) return null;
          return runImport(trimmed, true, gen);
        }
      }
      throw err;
    }
  }

  async function importFromUrl(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || busy) return;
    if (!modelReady) {
      toast.error(t(lang, 'galleryNeedsModel'));
      return;
    }
    // Pre-check cannot know package name before fetch; clash handled after fetch.
    const gen = ++importGen.current;
    setBusy(true);
    setRemoteError('');
    try {
      const bot = await runImport(trimmed, false, gen);
      if (gen !== importGen.current || !bot) return;
      const nextSources = [trimmed, ...saved.filter((s) => s.toLowerCase() !== trimmed.toLowerCase())].slice(
        0,
        MAX_SAVED,
      );
      try {
        await persistSources(nextSources);
      } catch {
        /* import succeeded; saving the URL is best-effort */
      }
      setUrl('');
      onInstalled(bot);
    } catch (err) {
      if (gen !== importGen.current) return;
      const msg = formatSystemError(err);
      if (isAbortError(msg)) return;
      setRemoteError(msg);
      toast.error(msg);
    } finally {
      if (gen === importGen.current) setBusy(false);
    }
  }

  async function removeSaved(target: string) {
    const next = saved.filter((s) => s !== target);
    try {
      await persistSources(next);
    } catch (err) {
      toast.error(formatSystemError(err));
    }
  }

  async function addConnector(preset: MarketplaceConnectorPreset) {
    if (!settings || addingId) return;
    if (presetAlreadyInstalled(settings, preset)) {
      toast.success(t(lang, 'galleryConnectorAdded'));
      return;
    }
    setAddingId(preset.id);
    try {
      const mcp = normalizeMcpSettings(settings.mcp);
      const entry: McpServerEntry = {
        id: createId('mcp'),
        name: lang === 'zh' ? preset.nameZh : preset.nameEn,
        // Off until the user reviews in Settings → MCP.
        enabled: false,
        transport: 'stdio',
        command: preset.command,
        args: [...preset.args],
      };
      // Stable id so "已添加" matches re-opens.
      entry.id = preset.id;
      const next: AppSettings = {
        ...settings,
        mcp: {
          ...mcp,
          servers: [...mcp.servers, entry],
        },
      };
      await onSettingsPatch(next);
      toast.success(
        t(lang, 'galleryConnectorInstalled', {
          name: lang === 'zh' ? preset.nameZh : preset.nameEn,
        }),
      );
    } catch (err) {
      toast.error(formatSystemError(err));
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="marketplace-page" role="region" aria-label={t(lang, 'galleryTitle')}>
      <div className="marketplace-page-head">
        <h1 className="marketplace-page-title">{t(lang, 'galleryTitle')}</h1>
        <button type="button" className="settings-close" onClick={onClose} aria-label={t(lang, 'close')}>
          <CloseIcon />
        </button>
      </div>

      <div className="marketplace-tabs" role="tablist" aria-label={t(lang, 'galleryTitle')}>
        <div className="marketplace-tabs-track" ref={tabTrackRef}>
          <span
            className="marketplace-tabs-pill"
            aria-hidden
            style={{
              transform: `translateX(${pill.left}px)`,
              width: pill.width ? `${pill.width}px` : undefined,
              opacity: pill.width ? 1 : 0,
            }}
          />
          <button
            ref={assistantsTabRef}
            type="button"
            role="tab"
            aria-selected={tab === 'assistants'}
            className={tab === 'assistants' ? 'active' : ''}
            onClick={() => setTab('assistants')}
          >
            {t(lang, 'galleryTabAssistants')}
          </button>
          <button
            ref={connectorsTabRef}
            type="button"
            role="tab"
            aria-selected={tab === 'connectors'}
            className={tab === 'connectors' ? 'active' : ''}
            onClick={() => setTab('connectors')}
          >
            {t(lang, 'galleryTabConnectors')}
          </button>
        </div>
      </div>

      <div className="marketplace-page-body scroll-fade">
        {tab === 'assistants' ? (
          <>
            <p className="assistant-gallery-hint">
              {modelReady ? t(lang, 'galleryHint') : t(lang, 'galleryNeedsModel')}
            </p>

            <section className="marketplace-section" aria-labelledby="marketplace-builtin-heading">
              <h2 id="marketplace-builtin-heading" className="marketplace-section-title">
                {t(lang, 'galleryBuiltinSection')}
              </h2>
              <AssistantGalleryList
                lang={lang}
                disabled={!modelReady}
                existingNames={existingNames}
                onInstalled={onInstalled}
              />
            </section>

            <section className="marketplace-section" aria-labelledby="marketplace-remote-heading">
              <h2 id="marketplace-remote-heading" className="marketplace-section-title">
                {t(lang, 'galleryRemoteSection')}
              </h2>
              <p className="marketplace-remote-hint">{t(lang, 'galleryRemoteHint')}</p>
              <form
                className="marketplace-remote-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void importFromUrl(url);
                }}
              >
                <input
                  className="marketplace-remote-input"
                  type="url"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={t(lang, 'galleryRemotePlaceholder')}
                  value={url}
                  disabled={busy || !modelReady}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (remoteError) setRemoteError('');
                  }}
                />
                {busy ? (
                  <button type="button" className="ghost" onClick={cancelImport}>
                    {t(lang, 'cancel')}
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="settings-aar-add-btn"
                    disabled={!modelReady || !url.trim()}
                  >
                    {t(lang, 'galleryRemoteImport')}
                  </button>
                )}
              </form>
              {busy ? (
                <p className="marketplace-remote-hint" role="status">
                  {t(lang, 'galleryRemoteImporting')}
                </p>
              ) : null}
              {remoteError ? (
                <p className="marketplace-remote-error" role="alert">
                  {remoteError}
                </p>
              ) : null}

              {saved.length > 0 ? (
                <ul className="marketplace-saved-list" aria-label={t(lang, 'gallerySavedSources')}>
                  {saved.map((src) => (
                    <li key={src} className="marketplace-saved-item">
                      <button
                        type="button"
                        className="marketplace-saved-url"
                        disabled={busy || !modelReady}
                        title={src}
                        onClick={() => void importFromUrl(src)}
                      >
                        {src}
                      </button>
                      <button
                        type="button"
                        className="marketplace-saved-remove"
                        disabled={busy}
                        aria-label={t(lang, 'galleryRemoveSource')}
                        onClick={() => void removeSaved(src)}
                      >
                        {t(lang, 'galleryRemoveSource')}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </>
        ) : (
          <section className="marketplace-section" aria-labelledby="marketplace-connectors-heading">
            <h2 id="marketplace-connectors-heading" className="marketplace-section-title">
              {t(lang, 'galleryTabConnectors')}
            </h2>
            <p className="marketplace-remote-hint">{t(lang, 'galleryConnectorsHint')}</p>
            {onOpenMcpSettings ? (
              <p className="marketplace-remote-hint">
                <button
                  type="button"
                  className="settings-inline-link"
                  onClick={() => {
                    onClose();
                    onOpenMcpSettings();
                  }}
                >
                  {t(lang, 'galleryConnectorOpenSettings')}
                </button>
              </p>
            ) : null}
            {MARKETPLACE_CONNECTOR_PRESETS.length === 0 ? (
              <p className="marketplace-remote-hint">{t(lang, 'galleryConnectorsEmpty')}</p>
            ) : (
              <ul className="marketplace-connector-list">
                {MARKETPLACE_CONNECTOR_PRESETS.map((preset) => {
                  const installed = presetAlreadyInstalled(settings, preset);
                  const name = lang === 'zh' ? preset.nameZh : preset.nameEn;
                  const desc = lang === 'zh' ? preset.descZh : preset.descEn;
                  return (
                    <li key={preset.id} className="marketplace-connector-card">
                      <div className="marketplace-connector-main">
                        <div className="marketplace-connector-name">{name}</div>
                        <div className="marketplace-connector-desc">{desc}</div>
                        <div className="marketplace-connector-cmd">
                          {preset.command} {preset.args.join(' ')}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="settings-aar-add-btn"
                        disabled={installed || addingId === preset.id || !settings}
                        onClick={() => void addConnector(preset)}
                      >
                        {installed
                          ? t(lang, 'galleryConnectorAdded')
                          : addingId === preset.id
                            ? t(lang, 'galleryConnectorAdding')
                            : t(lang, 'galleryConnectorAdd')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
