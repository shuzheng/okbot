import { memo, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type RefObject } from 'react';
import { BorderBeam } from 'border-beam';
import { stripThinkContent, type Bot, type Squad } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import type { MenuState, RenameTarget, Selection, SessionItem } from '../../types';
import { FlatAvatar, SquadAvatar } from '../../components/ui/avatars';
import { AssistantGalleryIcon, ImportAssistantIcon, PersonIcon, SearchIcon, SettingsIcon, SquadNavIcon } from '../../components/ui/icons';
import { QuickTip } from '../../components/ui/QuickTip';
import { formatSessionUpdatedAt } from '../../utils/formatSessionUpdatedAt';

export type DockTipTarget =
  | { kind: 'bot'; bot: Bot }
  | { kind: 'squad'; squad: Squad; members: Array<{ emoji: string; color: string }> };

export type SessionSidebarProps = {
  sidebarRef?: RefObject<HTMLElement | null>;
  lang: UiLang;
  narrow: boolean;
  createMenu: boolean;
  createMenuPos: { top: number; left: number } | null;
  sessions: SessionItem[];
  selection: Selection;
  bots: Bot[];
  renameTarget: RenameTarget;
  renameValue: string;
  dockScales: Record<string, number>;
  sessionListRef: RefObject<HTMLDivElement | null>;
  createMenuRef: RefObject<HTMLDivElement | null>;
  newBtnRef: RefObject<HTMLButtonElement | null>;
  newBtnFooterRef: RefObject<HTMLButtonElement | null>;
  botIsWorking: (id: string) => boolean;
  sessionHasUnread: (id: string) => boolean;
  onOpenSearch: () => void;
  onOpenCreateMenu: (e: MouseEvent) => void;
  onStartCreateBot: () => void;
  onOpenSquadWizard: () => void;
  onImportAssistant: () => void;
  onOpenAssistantGallery: () => void;
  onSelect: (selection: Selection) => void;
  onOpenSessionMenu: (menu: NonNullable<MenuState>) => void;
  onRenameValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onOpenSettings: () => void;
  onDockMouseMove: (clientY: number) => void;
  onDockScroll: () => void;
  onDockMouseLeave: () => void;
  onPlaceDockTip: (node: HTMLElement, target: DockTipTarget) => void;
};

function resolvedOrbTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export const SessionSidebar = memo(function SessionSidebar({
  sidebarRef,
  lang,
  narrow,
  createMenu,
  createMenuPos,
  sessions,
  selection,
  bots,
  renameTarget,
  renameValue,
  dockScales,
  sessionListRef,
  createMenuRef,
  newBtnRef,
  newBtnFooterRef,
  botIsWorking,
  sessionHasUnread,
  onOpenSearch,
  onOpenCreateMenu,
  onStartCreateBot,
  onOpenSquadWizard,
  onImportAssistant,
  onOpenAssistantGallery,
  onSelect,
  onOpenSessionMenu,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onOpenSettings,
  onDockMouseMove,
  onDockScroll,
  onDockMouseLeave,
  onPlaceDockTip,
}: SessionSidebarProps) {
  const [footerMenuOpen, setFooterMenuOpen] = useState(false);
  const footerFabRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!narrow) setFooterMenuOpen(false);
  }, [narrow]);

  useEffect(() => {
    if (!footerMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as Node | null;
      if (!el) return;
      if (footerFabRef.current?.contains(el)) return;
      // Keep open while the create submenu (创建助手 / 创建小队) is used; those
      // buttons close the fab explicitly.
      if (createMenuRef.current?.contains(el)) return;
      setFooterMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [footerMenuOpen, createMenuRef]);

  const renameInput = (
    <input
      spellCheck={false}
      className="session-rename-input"
      value={renameValue}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => onRenameValueChange(e.target.value)}
      onBlur={() => onCommitRename()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancelRename();
        }
      }}
    />
  );

  return (
    <aside
      ref={(node) => {
        if (sidebarRef) sidebarRef.current = node;
      }}
      className={`sidebar ${createMenu ? 'menu-open' : ''}${footerMenuOpen ? ' fab-open' : ''}`}
    >
      <div className="sidebar-topbar">
        {!narrow && (
          <>
            <QuickTip text={t(lang, 'search')} place="below">
            <button
              type="button"
              className="search-btn"
              aria-label={t(lang, 'search')}
              onClick={onOpenSearch}
            >
              <SearchIcon />
            </button>
            </QuickTip>
            <QuickTip text={t(lang, 'sidebarNew')} place="below">
            <button
              ref={newBtnRef}
              className="new-btn"
              onClick={onOpenCreateMenu}
              aria-label={t(lang, 'sidebarNew')}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
                <path
                  d="M12 5v14M5 12h14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            </QuickTip>
          </>
        )}
      </div>

      {createMenu && (
        <div
          ref={createMenuRef}
          className={`create-menu${createMenuPos ? ' anchored' : ''}`}
          style={
            createMenuPos
              ? { top: createMenuPos.top, left: createMenuPos.left }
              : undefined
          }
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setFooterMenuOpen(false);
              onStartCreateBot();
            }}
          >
            <span className="create-menu-icon" aria-hidden>
              <PersonIcon />
            </span>
            {t(lang, 'newBotSession')}
          </button>
          <button
            type="button"
            onClick={() => {
              setFooterMenuOpen(false);
              onOpenSquadWizard();
            }}
          >
            <span className="create-menu-icon" aria-hidden>
              <SquadNavIcon />
            </span>
            {t(lang, 'newSquadPlaceholder')}
          </button>
          <button
            type="button"
            onClick={() => {
              setFooterMenuOpen(false);
              onOpenAssistantGallery();
            }}
          >
            <span className="create-menu-icon" aria-hidden>
              <AssistantGalleryIcon />
            </span>
            {t(lang, 'galleryTitle')}
          </button>
          <button
            type="button"
            onClick={() => {
              setFooterMenuOpen(false);
              onImportAssistant();
            }}
          >
            <span className="create-menu-icon" aria-hidden>
              <ImportAssistantIcon />
            </span>
            {t(lang, 'botImportPackage')}
          </button>
        </div>
      )}

      <div
        className="session-list scroll-fade"
        ref={sessionListRef}
        onMouseMove={
          narrow
            ? (e) => {
                onDockMouseMove(e.clientY);
              }
            : undefined
        }
        onScroll={narrow ? () => onDockScroll() : undefined}
        onMouseLeave={narrow ? () => onDockMouseLeave() : undefined}
      >
        {sessions.length === 0 ? (
          <div className="empty-side">{t(lang, 'emptySide')}</div>
        ) : (
          sessions.map((item) => {
            if (item.kind === 'bot') {
              const bot = item.bot;
              const active = selection?.kind === 'bot' && selection.id === bot.id;
              const selectBot = () => onSelect({ kind: 'bot', id: bot.id });
              const botContext = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenSessionMenu({ kind: 'bot', x: e.clientX, y: e.clientY, bot });
              };
              const dockScale = narrow ? dockScales[`bot:${bot.id}`] || 1 : 1;
              const avatarStyle: CSSProperties | undefined = narrow
                ? {
                    transform: `scale(${dockScale})`,
                    zIndex: Math.round(dockScale * 10),
                  }
                : undefined;
              const renaming = renameTarget?.kind === 'bot' && renameTarget.id === bot.id;
              const unread = !active && sessionHasUnread(bot.id) && !botIsWorking(bot.id);
              const preview = stripThinkContent(bot.lastReplyPreview || '').trim();
              const row = (
                <div className={`session-item ${active ? 'active' : ''}`} title={narrow ? undefined : bot.name}>
                  <span className={`session-avatar-shell${unread ? ' unread' : ''}`} title={unread ? t(lang, 'unreadReply') : undefined}>
                    <FlatAvatar
                      className="session-avatar"
                      emoji={bot.emoji}
                      color={bot.color}
                      avatarKind={bot.avatarKind}
                      botAvatarType={bot.botAvatarType}
                      busy={botIsWorking(bot.id)}
                      style={avatarStyle}
                    />
                  </span>
                  <span className="session-meta">
                    {renaming ? (
                      renameInput
                    ) : (
                      <span className="session-name-row">
                        <span className="session-name">{bot.name}</span>
                        {!narrow ? (
                          <span className="session-updated">
                            {formatSessionUpdatedAt(item.updatedAt, lang)}
                          </span>
                        ) : null}
                      </span>
                    )}
                    {preview ? (
                      <span className="session-desc">{preview}</span>
                    ) : null}
                  </span>
                </div>
              );
              return (
                <div
                  key={`bot:${bot.id}`}
                  data-session-id={`bot:${bot.id}`}
                  className={`session-item-wrap${active ? ' active' : ''}${narrow ? ' dock-item' : ''}${renaming ? ' renaming' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={renaming ? undefined : selectBot}
                  onContextMenu={botContext}
                  onMouseEnter={
                    narrow
                      ? (e) => {
                          onPlaceDockTip(e.currentTarget, { kind: 'bot', bot });
                        }
                      : undefined
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selectBot();
                    }
                  }}
                >
                  {botIsWorking(bot.id) ? (
                    <BorderBeam
                      size="sm"
                      theme={resolvedOrbTheme()}
                      colorVariant="ocean"
                      strength={0.9}
                      borderRadius={12}
                      duration={2.2}
                    >
                      {row}
                    </BorderBeam>
                  ) : (
                    row
                  )}
                </div>
              );
            }
            const g = item.squad;
            const active = selection?.kind === 'squad' && selection.id === g.id;
            const memberAvatars = g.members
              .map((m) => bots.find((b) => b.id === m.botId))
              .filter((b): b is Bot => !!b)
              .map((b) => ({ emoji: b.emoji, color: b.color }));
            const tipMembers = memberAvatars.length
              ? memberAvatars
              : [{ emoji: '👥', color: '#6366F1' }];
            const dockScale = narrow ? dockScales[`squad:${g.id}`] || 1 : 1;
            const renaming = renameTarget?.kind === 'squad' && renameTarget.id === g.id;
            const unread = !active && sessionHasUnread(g.id) && !botIsWorking(g.id);
            const selectSquad = () => onSelect({ kind: 'squad', id: g.id });
            const squadContext = (e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenSessionMenu({ kind: 'squad', x: e.clientX, y: e.clientY, squad: g });
            };
            const preview = stripThinkContent(g.lastReplyPreview || '').trim();
            const squadPreview = preview || g.description || t(lang, 'squadDesc');
            const squadRow = (
              <div className={`session-item ${active ? 'active' : ''}`} title={narrow ? undefined : g.name}>
                <span
                  className={`session-avatar-shell${unread ? ' unread' : ''}`}
                  title={unread ? t(lang, 'unreadReply') : undefined}
                >
                  <span
                    className="session-avatar"
                    style={
                      narrow
                        ? {
                            transform: `scale(${dockScale})`,
                            zIndex: Math.round(dockScale * 10),
                          }
                        : undefined
                    }
                  >
                    <SquadAvatar members={tipMembers} />
                  </span>
                </span>
                <span className="session-meta">
                  {renaming ? (
                    renameInput
                  ) : (
                    <span className="session-name-row">
                      <span className="session-name">{g.name}</span>
                      {!narrow ? (
                        <span className="session-updated">
                          {formatSessionUpdatedAt(item.updatedAt, lang)}
                        </span>
                      ) : null}
                    </span>
                  )}
                  <span className="session-desc">{squadPreview}</span>
                </span>
              </div>
            );
            return (
              <div
                key={`squad:${g.id}`}
                data-session-id={`squad:${g.id}`}
                className={`session-item-wrap${active ? ' active' : ''}${narrow ? ' dock-item' : ''}${renaming ? ' renaming' : ''}`}
                role="button"
                tabIndex={0}
                title={narrow ? undefined : g.name}
                onClick={renaming ? undefined : selectSquad}
                onContextMenu={squadContext}
                onMouseEnter={
                  narrow
                    ? (e) => {
                        onPlaceDockTip(e.currentTarget, {
                          kind: 'squad',
                          squad: g,
                          members: tipMembers,
                        });
                      }
                    : undefined
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectSquad();
                  }
                }}
              >
                {botIsWorking(g.id) ? (
                  <BorderBeam
                    size="sm"
                    theme={resolvedOrbTheme()}
                    colorVariant="ocean"
                    strength={0.9}
                    borderRadius={12}
                    duration={2.2}
                  >
                    {squadRow}
                  </BorderBeam>
                ) : (
                  squadRow
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="sidebar-footer">
        {narrow ? (
          <div ref={footerFabRef} className={`footer-fab${footerMenuOpen ? ' open' : ''}`}>
            <div className="footer-fab-actions" role="menu">
              <QuickTip text={t(lang, 'sidebarNew')}>
              <button
                ref={newBtnFooterRef}
                type="button"
                className="new-btn-footer"
                role="menuitem"
                aria-label={t(lang, 'sidebarNew')}
                onClick={(e) => {
                  onOpenCreateMenu(e);
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
                  <path
                    d="M12 5v14M5 12h14"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              </QuickTip>
              <QuickTip text={t(lang, 'search')}>
              <button
                type="button"
                className="search-btn-footer"
                role="menuitem"
                aria-label={t(lang, 'search')}
                onClick={() => {
                  setFooterMenuOpen(false);
                  onOpenSearch();
                }}
              >
                <SearchIcon />
              </button>
              </QuickTip>
              <QuickTip text={t(lang, 'galleryTitle')}>
              <button
                type="button"
                className="footer-btn"
                role="menuitem"
                aria-label={t(lang, 'galleryTitle')}
                onClick={() => {
                  setFooterMenuOpen(false);
                  onOpenAssistantGallery();
                }}
              >
                <span className="ico">
                  <AssistantGalleryIcon />
                </span>
                <span className="label">{t(lang, 'galleryTitle')}</span>
              </button>
              </QuickTip>
              <QuickTip text={t(lang, 'settings')}>
              <button
                type="button"
                className="footer-btn"
                role="menuitem"
                aria-label={t(lang, 'settings')}
                onClick={() => {
                  setFooterMenuOpen(false);
                  onOpenSettings();
                }}
              >
                <span className="ico">
                  <SettingsIcon />
                </span>
                <span className="label">{t(lang, 'settings')}</span>
              </button>
              </QuickTip>
            </div>
            <button
              type="button"
              className="footer-fab-toggle"
              title={footerMenuOpen ? t(lang, 'sidebarFabClose') : t(lang, 'sidebarFabOpen')}
              aria-label={footerMenuOpen ? t(lang, 'sidebarFabClose') : t(lang, 'sidebarFabOpen')}
              aria-expanded={footerMenuOpen}
              onClick={() => setFooterMenuOpen((v) => !v)}
            >
              <span
                className={`footer-fab-icon${footerMenuOpen ? ' open' : ''}`}
                aria-hidden
              >
                <span className="footer-fab-icon-bar" />
                <span className="footer-fab-icon-bar" />
                <span className="footer-fab-icon-bar" />
              </span>
            </button>
          </div>
        ) : (
          <div className="sidebar-footer-row">
            <button className="footer-btn" onClick={onOpenSettings} title={t(lang, 'settings')}>
              <span className="ico">
                <SettingsIcon />
              </span>
              <span className="label">{t(lang, 'settings')}</span>
            </button>
            <button
              className="footer-btn"
              onClick={onOpenAssistantGallery}
              title={t(lang, 'galleryTitle')}
            >
              <span className="ico">
                <AssistantGalleryIcon />
              </span>
              <span className="label">{t(lang, 'galleryTitle')}</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
});
