import { useEffect, useMemo, useRef, useState } from 'react';
import {
  plainTextFromMarkdown,
  type Bot,
  type Squad,
  type MessageSearchHit,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import type { SettingsTab } from '../settings/types';
import { SETTINGS_SEARCH_ITEMS } from '../settings/settingsSearch';
import { FlatAvatar } from '../../components/ui/avatars';

export type GlobalSearchSelect =
  | { kind: 'bot'; id: string }
  | { kind: 'squad'; id: string }
  | { kind: 'settings'; tab: SettingsTab; sectionId: string }
  | { kind: 'message'; botId: string; messageId: string };

type Props = {
  lang: UiLang;
  bots: Bot[];
  squads: Squad[];
  /** System-instruction rows are hidden unless developer mode is on. */
  developerMode?: boolean;
  onClose: () => void;
  onSelect: (target: GlobalSearchSelect) => void;
};

function SearchIconSmall() {
  return (
    <svg className="global-search-icon" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
      <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function matchText(hay: string, q: string): boolean {
  return hay.toLowerCase().includes(q);
}

export function GlobalSearchModal({ lang, bots, squads, developerMode = false, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [messageHits, setMessageHits] = useState<MessageSearchHit[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const q = query.trim().toLowerCase();

  const chatHits = useMemo(() => {
    type Hit =
      | { kind: 'bot'; bot: Bot }
      | { kind: 'squad'; squad: Squad };
    const items: Hit[] = [
      ...bots.map((bot) => ({ kind: 'bot' as const, bot })),
      ...squads.map((squad) => ({ kind: 'squad' as const, squad })),
    ];
    if (!q) {
      // Recent: bots by updatedAt; squads by updatedAt.
      return items.slice(0, 8);
    }
    return items.filter((item) => {
      if (item.kind === 'bot') {
        const b = item.bot;
        return (
          matchText(b.name, q) ||
          matchText(b.description || '', q) ||
          matchText(b.lastReplyPreview || '', q)
        );
      }
      return (
        matchText(item.squad.name, q) || matchText(item.squad.description || '', q)
      );
    });
  }, [bots, squads, q]);

  const settingsHits = useMemo(() => {
    if (!q) return [];
    return SETTINGS_SEARCH_ITEMS.filter((item) => {
      if (item.tab === 'instructions' && !developerMode) return false;
      const label = t(lang, item.labelKey);
      if (matchText(label, q)) return true;
      if (item.keywords?.some((k) => matchText(k, q))) return true;
      // Also match the i18n key / tab name lightly
      if (matchText(item.id, q) || matchText(item.tab, q)) return true;
      return false;
    }).slice(0, 12);
  }, [developerMode, lang, q]);

  useEffect(() => {
    if (!q) {
      setMessageHits([]);
      setMessagesLoading(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    setMessagesLoading(true);
    const handle = window.setTimeout(() => {
      void window.okbot
        .searchMessages(q, { limit: 30 })
        .then((hits) => {
          if (reqId !== reqIdRef.current) return;
          setMessageHits(Array.isArray(hits) ? hits : []);
          setMessagesLoading(false);
        })
        .catch(() => {
          if (reqId !== reqIdRef.current) return;
          setMessageHits([]);
          setMessagesLoading(false);
        });
    }, 280);
    return () => window.clearTimeout(handle);
  }, [q]);

  const pick = (target: GlobalSearchSelect) => {
    onSelect(target);
    onClose();
  };

  return (
    <div className="modal-backdrop global-search-backdrop" onClick={onClose}>
      <div
        className="global-search-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, 'search')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="global-search-input-row">
          <SearchIconSmall />
          <input
            ref={inputRef}
            spellCheck={false}
            className="global-search-input"
            placeholder={t(lang, 'searchModalPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t(lang, 'search')}
          />
          <kbd className="global-search-esc">esc</kbd>
        </div>

        <div className="global-search-results scroll-fade" ref={listRef}>
          {!q && chatHits.length > 0 ? (
            <div className="global-search-section">
              <div className="global-search-section-title">{t(lang, 'searchRecent')}</div>
              {chatHits.map((item) =>
                item.kind === 'bot' ? (
                  <button
                    key={`bot:${item.bot.id}`}
                    type="button"
                    className="global-search-row"
                    onClick={() => pick({ kind: 'bot', id: item.bot.id })}
                  >
                    <FlatAvatar
                      className="global-search-avatar"
                      emoji={item.bot.emoji}
                      color={item.bot.color}
                      avatarKind={item.bot.avatarKind}
                      botAvatarType={item.bot.botAvatarType}
                    />
                    <span className="global-search-row-main">
                      <span className="global-search-row-title">{item.bot.name}</span>
                      {item.bot.description || item.bot.lastReplyPreview ? (
                        <span className="global-search-row-sub">
                          {plainTextFromMarkdown(
                            item.bot.description || item.bot.lastReplyPreview || '',
                          ).slice(0, 80)}
                        </span>
                      ) : null}
                    </span>
                    <span className="global-search-row-badge">{t(lang, 'botSession')}</span>
                  </button>
                ) : (
                  <button
                    key={`squad:${item.squad.id}`}
                    type="button"
                    className="global-search-row"
                    onClick={() => pick({ kind: 'squad', id: item.squad.id })}
                  >
                    <FlatAvatar className="global-search-avatar" emoji="👥" color="#6366F1" />
                    <span className="global-search-row-main">
                      <span className="global-search-row-title">{item.squad.name}</span>
                      <span className="global-search-row-sub">{t(lang, 'squadDesc')}</span>
                    </span>
                    <span className="global-search-row-badge">{t(lang, 'newSquadPlaceholder')}</span>
                  </button>
                ),
              )}
            </div>
          ) : null}

          {!q && chatHits.length === 0 ? (
            <div className="global-search-empty">{t(lang, 'searchEmptyHint')}</div>
          ) : null}

          {q && chatHits.length > 0 ? (
            <div className="global-search-section">
              <div className="global-search-section-title">{t(lang, 'searchSectionChats')}</div>
              {chatHits.map((item) =>
                item.kind === 'bot' ? (
                  <button
                    key={`bot:${item.bot.id}`}
                    type="button"
                    className="global-search-row"
                    onClick={() => pick({ kind: 'bot', id: item.bot.id })}
                  >
                    <FlatAvatar
                      className="global-search-avatar"
                      emoji={item.bot.emoji}
                      color={item.bot.color}
                      avatarKind={item.bot.avatarKind}
                      botAvatarType={item.bot.botAvatarType}
                    />
                    <span className="global-search-row-main">
                      <span className="global-search-row-title">{item.bot.name}</span>
                      {item.bot.description ? (
                        <span className="global-search-row-sub">
                          {plainTextFromMarkdown(item.bot.description).slice(0, 80)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ) : (
                  <button
                    key={`squad:${item.squad.id}`}
                    type="button"
                    className="global-search-row"
                    onClick={() => pick({ kind: 'squad', id: item.squad.id })}
                  >
                    <FlatAvatar className="global-search-avatar" emoji="👥" color="#6366F1" />
                    <span className="global-search-row-main">
                      <span className="global-search-row-title">{item.squad.name}</span>
                    </span>
                  </button>
                ),
              )}
            </div>
          ) : null}

          {q && settingsHits.length > 0 ? (
            <div className="global-search-section">
              <div className="global-search-section-title">{t(lang, 'searchSectionSettings')}</div>
              {settingsHits.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="global-search-row"
                  onClick={() => pick({ kind: 'settings', tab: item.tab, sectionId: item.id })}
                >
                  <span className="global-search-settings-ico" aria-hidden>
                    ⚙
                  </span>
                  <span className="global-search-row-main">
                    <span className="global-search-row-title">{t(lang, item.labelKey)}</span>
                    <span className="global-search-row-sub">
                      {t(
                        lang,
                        item.tab === 'general'
                          ? 'general'
                          : item.tab === 'tools'
                            ? 'tools'
                            : item.tab === 'security'
                              ? 'security'
                              : item.tab === 'model'
                                ? 'model'
                                : item.tab === 'instructions'
                                  ? 'instructions'
                                  : item.tab === 'memory'
                                    ? 'memoryTab'
                                    : item.tab === 'usage'
                                      ? 'usageTab'
                                      : item.tab === 'updates'
                                        ? 'updatesTab'
                                        : 'model',
                      )}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {q && (messagesLoading || messageHits.length > 0) ? (
            <div className="global-search-section">
              <div className="global-search-section-title">{t(lang, 'searchSectionMessages')}</div>
              {messagesLoading && messageHits.length === 0 ? (
                <div className="global-search-empty">{t(lang, 'promptContextLoading')}</div>
              ) : null}
              {messageHits.map((hit) => (
                <button
                  key={`${hit.botId}:${hit.message.id}`}
                  type="button"
                  className="global-search-row"
                  onClick={() =>
                    pick({ kind: 'message', botId: hit.botId, messageId: hit.message.id })
                  }
                >
                  <FlatAvatar
                    className="global-search-avatar"
                    emoji={hit.botEmoji}
                    color={hit.botColor}
                    avatarKind={hit.botAvatarKind}
                    botAvatarType={hit.botAvatarType}
                  />
                  <span className="global-search-row-main">
                    <span className="global-search-row-title">
                      {hit.botName}
                      <span className="global-search-msg-role">
                        ·{' '}
                        {hit.message.role === 'user'
                          ? t(lang, 'searchRoleUser')
                          : t(lang, 'searchRoleAssistant')}
                      </span>
                    </span>
                    <span className="global-search-row-sub">{hit.snippet}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {q && !messagesLoading && chatHits.length === 0 && settingsHits.length === 0 && messageHits.length === 0 ? (
            <div className="global-search-empty">{t(lang, 'searchNoResults')}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
