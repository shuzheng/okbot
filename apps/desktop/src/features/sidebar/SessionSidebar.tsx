import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import { BorderBeam } from 'border-beam';
import {
  stripThinkContent,
  UNGROUPED_OWNER_GROUP_ID,
  type Bot,
  type OwnerGroup,
  type Squad,
} from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import type { MenuState, RenameTarget, Selection, SessionItem } from '../../types';
import { FlatAvatar, SquadAvatar, type SquadAvatarMember } from '../../components/ui/avatars';
import { resolveSessionAvatarMotion } from '../../utils/sessionAvatarMotion';
import { AboutIcon, AssistantGalleryIcon, ChevronDownIcon, DownloadUpdateIcon, ImportAssistantIcon, InstallUpdateIcon, PersonIcon, SearchIcon, SettingsIcon, SquadNavIcon } from '../../components/ui/icons';
import { QuickTip } from '../../components/ui/QuickTip';
import { SessionPinStrip } from './SessionPinStrip';
import { formatSessionDraftPreview } from '../../utils/formatSessionDraftPreview';
import { formatSessionUpdatedAt } from '../../utils/formatSessionUpdatedAt';

export type DockTipTarget =
  | { kind: 'bot'; bot: Bot }
  | { kind: 'squad'; squad: Squad; members: SquadAvatarMember[] };

/** Sidebar footer update chip; null when no update UI should show. */
export type SidebarUpdateControl = {
  phase: 'available' | 'downloading' | 'downloaded';
  title: string;
  aria: string;
  showBadge: boolean;
  disabled: boolean;
  onClick: () => void;
};

export type SessionSidebarProps = {
  sidebarRef?: RefObject<HTMLElement | null>;
  lang: UiLang;
  narrow: boolean;
  createMenu: boolean;
  createMenuPos: { top: number; left: number } | null;
  sessions: SessionItem[];
  selection: Selection;
  /** Composer drafts by owner id; inactive rows may show 「草稿：」 preview. */
  draftPreviewsByOwner: Record<string, string>;
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
  /** ownerId → last open/interact ms; drives 闲动画 vs 静止. */
  sessionInteractedAt?: Record<string, number>;
  /** Coarse clock for 1-minute idle → 静止. */
  avatarMotionNow?: number;
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
  /** Open About modal (collapsed fab menu). */
  onOpenAbout: () => void;
  onDockMouseMove: (clientY: number) => void;
  onDockScroll: () => void;
  onDockMouseLeave: () => void;
  onPlaceDockTip: (node: HTMLElement, target: DockTipTarget) => void;
  onScheduleHideDockTip: () => void;
  /** Immediately dismiss the session dock tip (e.g. narrow group-header QuickTip). */
  onHideDockTip: () => void;
  /** settings.defaultAssistantId — badge on that bot's avatar. */
  defaultAssistantId?: string;
  /** settings.pinnedOwnerIds — stable pin order (bot + squad owner ids). */
  pinnedOwnerIds?: string[];
  /** settings.hiddenOwnerIds — assistants/squads in the bottom collapsed group. */
  hiddenOwnerIds?: string[];
  /** settings.ownerGroups — custom groups (metadata; order via ownerGroupOrder). */
  ownerGroups?: OwnerGroup[];
  /** settings.ownerGroupOrder — display order including UNGROUPED_OWNER_GROUP_ID. */
  ownerGroupOrder?: string[];
  /** settings.ownerGroupMembership — ownerId → custom group id. */
  ownerGroupMembership?: Record<string, string>;
  onOpenOwnerGroupMenu?: (menu: {
    kind: 'owner-group';
    x: number;
    y: number;
    groupId: string;
  }) => void;
  /** Move an owner into a group (incl. UNGROUPED). */
  onMoveOwnerToGroup?: (ownerId: string, groupId: string) => void;
  /** Reorder groups: insert fromId before toId in ownerGroupOrder. */
  onReorderOwnerGroup?: (fromId: string, toId: string) => void;
  /** When set, show update control to the right of 市场. */
  updateControl?: SidebarUpdateControl | null;
  /** Long-press modifier hints: ownerId → label (⌘1 / Win+1). */
  shortcutHintByOwnerId?: Record<string, string>;
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
  draftPreviewsByOwner,
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
  sessionInteractedAt = {},
  avatarMotionNow = 0,
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
  onOpenAbout,
  onDockMouseMove,
  onDockScroll,
  onDockMouseLeave,
  onPlaceDockTip,
  onScheduleHideDockTip,
  onHideDockTip,
  defaultAssistantId = '',
  pinnedOwnerIds = [],
  hiddenOwnerIds = [],
  ownerGroups = [],
  ownerGroupOrder = [],
  ownerGroupMembership = {},
  onOpenOwnerGroupMenu,
  onMoveOwnerToGroup,
  onReorderOwnerGroup,
  updateControl = null,
  shortcutHintByOwnerId,
}: SessionSidebarProps) {
  const [footerMenuOpen, setFooterMenuOpen] = useState(false);
  const [hiddenExpanded, setHiddenExpanded] = useState(false);
  /** Per-group expand; missing id → expanded (default open). Local UI like 已隐藏. */
  const [ownerGroupExpanded, setOwnerGroupExpanded] = useState<Record<string, boolean>>({});
  /** Blocks header toggle for one click after rename blur (blur→click race). */
  const suppressGroupToggleRef = useRef(false);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [draggingOwnerId, setDraggingOwnerId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const footerFabRef = useRef<HTMLDivElement>(null);

  const OWNER_MIME = 'application/x-okbot-owner';
  const GROUP_MIME = 'application/x-okbot-group';

  function allowGroupDrop(e: DragEvent) {
    const types = Array.from(e.dataTransfer?.types ?? []);
    return types.includes(OWNER_MIME) || types.includes(GROUP_MIME);
  }

  function onGroupDragOver(e: DragEvent, groupId: string) {
    if (!allowGroupDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverGroupId !== groupId) setDragOverGroupId(groupId);
  }

  function onGroupDragLeave(e: DragEvent, groupId: string) {
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as HTMLElement).contains(related)) return;
    if (dragOverGroupId === groupId) setDragOverGroupId(null);
  }

  function onGroupDrop(e: DragEvent, groupId: string) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverGroupId(null);
    const ownerId = e.dataTransfer.getData(OWNER_MIME);
    if (ownerId) {
      onMoveOwnerToGroup?.(ownerId, groupId);
      setDraggingOwnerId(null);
      return;
    }
    const fromGroup = e.dataTransfer.getData(GROUP_MIME);
    if (fromGroup && fromGroup !== groupId) {
      onReorderOwnerGroup?.(fromGroup, groupId);
      setDraggingGroupId(null);
    }
  }

  function isOwnerGroupExpanded(groupId: string): boolean {
    return ownerGroupExpanded[groupId] !== false;
  }

  function toggleOwnerGroupExpanded(groupId: string) {
    setOwnerGroupExpanded((prev) => {
      const open = prev[groupId] !== false;
      return { ...prev, [groupId]: !open };
    });
  }

  function renderUpdateButton(role?: string) {
    if (!updateControl) return null;
    const { phase, title, aria, showBadge, disabled, onClick } = updateControl;
    const isDownloading = phase === 'downloading';
    const isReady = phase === 'downloaded';
    return (
      <QuickTip text={title} place="right">
        <button
          type="button"
          className={`footer-update-btn${
            isDownloading ? ' downloading' : isReady ? ' ready' : ' available'
          }${showBadge ? ' has-badge' : ''}`}
          role={role}
          aria-label={aria}
          disabled={disabled}
          onClick={() => {
            if (role === 'menuitem') setFooterMenuOpen(false);
            onClick();
          }}
        >
          {isReady ? <InstallUpdateIcon /> : <DownloadUpdateIcon />}
        </button>
      </QuickTip>
    );
  }



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

  const hiddenIdSet = useMemo(() => new Set(hiddenOwnerIds), [hiddenOwnerIds]);
  const pinnedIdSet = useMemo(() => new Set(pinnedOwnerIds), [pinnedOwnerIds]);
  const sessionsByOwner = useMemo(() => {
    const byOwner = new Map<string, SessionItem>();
    for (const item of sessions) {
      const id = item.kind === 'bot' ? item.bot.id : item.squad.id;
      byOwner.set(id, item);
    }
    return byOwner;
  }, [sessions]);
  const pinnedSessions = useMemo(() => {
    const out: SessionItem[] = [];
    for (const id of pinnedOwnerIds) {
      if (hiddenIdSet.has(id)) continue;
      const hit = sessionsByOwner.get(id);
      if (hit) out.push(hit);
    }
    return out;
  }, [pinnedOwnerIds, sessionsByOwner, hiddenIdSet]);
  const listSessions = useMemo(
    () =>
      sessions.filter((item) => {
        const id = item.kind === 'bot' ? item.bot.id : item.squad.id;
        return !pinnedIdSet.has(id) && !hiddenIdSet.has(id);
      }),
    [sessions, pinnedIdSet, hiddenIdSet],
  );
  const hiddenSessions = useMemo(() => {
    const out: SessionItem[] = [];
    for (const id of hiddenOwnerIds) {
      const hit = sessionsByOwner.get(id);
      if (hit) out.push(hit);
    }
    return out;
  }, [hiddenOwnerIds, sessionsByOwner]);

  /** Show headers only when at least one custom group exists. */
  const showOwnerGroupHeaders = ownerGroups.length > 0;

  type OwnerGroupSection = {
    groupId: string;
    name: string;
    items: SessionItem[];
  };

  const ownerGroupSections = useMemo((): OwnerGroupSection[] => {
    if (!showOwnerGroupHeaders) {
      return [{ groupId: UNGROUPED_OWNER_GROUP_ID, name: '', items: listSessions }];
    }
    const byId = new Map(ownerGroups.map((g) => [g.id, g]));
    const byGroup = new Map<string, SessionItem[]>();
    for (const g of ownerGroups) byGroup.set(g.id, []);
    const ungrouped: SessionItem[] = [];
    for (const item of listSessions) {
      const id = item.kind === 'bot' ? item.bot.id : item.squad.id;
      const gid = ownerGroupMembership[id];
      if (gid && byGroup.has(gid)) {
        byGroup.get(gid)!.push(item);
      } else {
        ungrouped.push(item);
      }
    }
    // Prefer persisted order (includes 未分组); fall back to customs then 未分组.
    const order =
      ownerGroupOrder.length > 0
        ? ownerGroupOrder
        : [...ownerGroups.map((g) => g.id), UNGROUPED_OWNER_GROUP_ID];
    const sections: OwnerGroupSection[] = [];
    const seen = new Set<string>();
    for (const gid of order) {
      if (seen.has(gid)) continue;
      seen.add(gid);
      if (gid === UNGROUPED_OWNER_GROUP_ID) {
        sections.push({
          groupId: UNGROUPED_OWNER_GROUP_ID,
          name: t(lang, 'ungroupedGroup'),
          items: ungrouped,
        });
        continue;
      }
      const g = byId.get(gid);
      if (!g) continue;
      sections.push({
        groupId: g.id,
        name: g.name,
        items: byGroup.get(g.id) || [],
      });
    }
    for (const g of ownerGroups) {
      if (seen.has(g.id)) continue;
      sections.push({
        groupId: g.id,
        name: g.name,
        items: byGroup.get(g.id) || [],
      });
    }
    if (!seen.has(UNGROUPED_OWNER_GROUP_ID)) {
      sections.push({
        groupId: UNGROUPED_OWNER_GROUP_ID,
        name: t(lang, 'ungroupedGroup'),
        items: ungrouped,
      });
    }
    return sections;
  }, [
    showOwnerGroupHeaders,
    ownerGroups,
    ownerGroupOrder,
    ownerGroupMembership,
    listSessions,
    lang,
  ]);

  const renameInput = (
    <input
      spellCheck={false}
      className="session-rename-input"
      size={1}
      value={renameValue}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
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

  function renderOwnerGroupHeader(section: OwnerGroupSection) {
    if (!showOwnerGroupHeaders) return null;
    const renaming =
      renameTarget?.kind === 'owner-group' && renameTarget.id === section.groupId;
    const expanded = isOwnerGroupExpanded(section.groupId);
    const label =
      section.groupId === UNGROUPED_OWNER_GROUP_ID
        ? t(lang, 'ungroupedGroup')
        : section.name;
    const openMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onOpenOwnerGroupMenu?.({
        kind: 'owner-group',
        x: e.clientX,
        y: e.clientY,
        groupId: section.groupId,
      });
    };
    const header = (
      <button
        type="button"
        className={`session-owner-group-header${expanded ? ' expanded' : ''}${renaming ? ' renaming' : ''}`}
        aria-expanded={expanded}
        aria-label={label}
        title={narrow || renaming ? undefined : label}
        draggable={!renaming && !narrow}
        onDragStart={(e) => {
          if (renaming || narrow) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData(GROUP_MIME, section.groupId);
          e.dataTransfer.effectAllowed = 'move';
          setDraggingGroupId(section.groupId);
        }}
        onDragEnd={() => setDraggingGroupId(null)}
        onDragOver={(e) => onGroupDragOver(e, section.groupId)}
        onDrop={(e) => onGroupDrop(e, section.groupId)}
        onClick={(e) => {
          // Rename interactions must never toggle fold (blur→click races included).
          if (renaming || suppressGroupToggleRef.current) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          toggleOwnerGroupExpanded(section.groupId);
        }}
        onContextMenu={openMenu}
        onMouseEnter={
          narrow
            ? () => {
                onHideDockTip();
              }
            : undefined
        }
      >
        {!narrow || renaming ? (
          <span
            className={`session-owner-group-label-edit${renaming ? ' is-renaming' : ''}`}
            onClick={renaming ? (e) => e.stopPropagation() : undefined}
            onDoubleClick={renaming ? (e) => e.stopPropagation() : undefined}
            onMouseDown={renaming ? (e) => e.stopPropagation() : undefined}
            onPointerDown={renaming ? (e) => e.stopPropagation() : undefined}
          >
            {!narrow ? (
              <span className="session-owner-group-label">{label}</span>
            ) : (
              <span className="session-owner-group-label" aria-hidden>
                {renameValue || label}
              </span>
            )}
            {renaming ? (
              <input
                spellCheck={false}
                className="session-owner-group-rename"
                size={1}
                value={renameValue}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => onRenameValueChange(e.target.value)}
                onBlur={() => {
                  // Suppress the click that often follows blur on the same header.
                  suppressGroupToggleRef.current = true;
                  onCommitRename();
                  window.setTimeout(() => {
                    suppressGroupToggleRef.current = false;
                  }, 0);
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    suppressGroupToggleRef.current = true;
                    onCancelRename();
                    window.setTimeout(() => {
                      suppressGroupToggleRef.current = false;
                    }, 0);
                  }
                }}
              />
            ) : null}
          </span>
        ) : null}
        {/* Right slot: count/chevron stacked so hover never changes header height. */}
        {!renaming ? (
          <span className="session-owner-group-trailing">
            {!narrow ? (
              <span className="session-owner-group-count">{section.items.length}</span>
            ) : null}
            <span className="session-owner-group-chevron" aria-hidden>
              <ChevronDownIcon />
            </span>
          </span>
        ) : null}
      </button>
    );
    const tipped =
      narrow && !renaming ? (
        <QuickTip text={label} place="right">
          {header}
        </QuickTip>
      ) : (
        header
      );
    return (
      <div
        className={`session-group-sticky${draggingGroupId === section.groupId ? ' is-dragging' : ''}`}
        data-flip-id={`group:${section.groupId}`}
      >
        {tipped}
      </div>
    );
  }

  function renderSessionItem(item: SessionItem) {
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
              const lastPreview = stripThinkContent(bot.lastReplyPreview || '').trim();
              const draftText =
                !active ? formatSessionDraftPreview(draftPreviewsByOwner[bot.id] ?? '') : null;
              const preview = draftText
                ? `${t(lang, 'draftPrefix')}${draftText}`
                : lastPreview;
              const row = (
                <div className={`session-item ${active ? 'active' : ''}`} title={narrow ? undefined : bot.name}>
                  <span className={`session-avatar-shell${unread ? ' unread' : ''}`} title={unread ? t(lang, 'unreadReply') : undefined}>
                    <FlatAvatar
                      className="session-avatar"
                      emoji={bot.emoji}
                      color={bot.color}
                      avatarKind={bot.avatarKind}
                      botAvatarType={bot.botAvatarType}
                      {...resolveSessionAvatarMotion({
                        active,
                        busy: botIsWorking(bot.id),
                        lastInteractedAt: sessionInteractedAt[bot.id],
                        now: avatarMotionNow || Date.now(),
                      })}
                      style={avatarStyle}
                      showDefaultMark={defaultAssistantId === bot.id}
                      defaultMarkTitle={t(lang, 'defaultAssistant')}
                    />
                  </span>
                  <span className="session-meta">
                    <span className="session-name-row">
                      <span className={`session-name-edit${renaming ? ' is-renaming' : ''}`}>
                        <span className="session-name">{bot.name}</span>
                        {renaming ? renameInput : null}
                      </span>
                      {!narrow && !renaming ? (
                        <span className="session-updated">
                          {formatSessionUpdatedAt(item.updatedAt, lang)}
                        </span>
                      ) : null}
                    </span>
                    {preview ? (
                      <span className="session-desc">{preview}</span>
                    ) : null}
                  </span>
                  {shortcutHintByOwnerId?.[bot.id] ? (
                    <span className="session-shortcut-hint session-shortcut-hint-row" aria-hidden>
                      {shortcutHintByOwnerId[bot.id]}
                    </span>
                  ) : null}
                </div>
              );
              return (
                <div
                  key={`bot:${bot.id}`}
                  data-session-id={`bot:${bot.id}`}
                  className={`session-item-wrap${active ? ' active' : ''}${narrow ? ' dock-item' : ''}${renaming ? ' renaming' : ''}${draggingOwnerId === bot.id ? ' is-dragging' : ''}`}
                  role="button"
                  tabIndex={0}
                  draggable={!renaming && showOwnerGroupHeaders && !narrow}
                  onDragStart={(e) => {
                    if (renaming || !showOwnerGroupHeaders || narrow) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData(OWNER_MIME, bot.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingOwnerId(bot.id);
                  }}
                  onDragEnd={() => setDraggingOwnerId(null)}
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
                      className="session-beam"
                      size="sm"
                      theme={resolvedOrbTheme()}
                      colorVariant="ocean"
                      strength={0.9}
                      borderRadius={7}
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
            const memberAvatars: SquadAvatarMember[] = g.members
              .map((m) => bots.find((b) => b.id === m.botId))
              .filter((b): b is Bot => !!b)
              .map((b) => ({
                emoji: b.emoji,
                color: b.color,
                avatarKind: b.avatarKind,
                botAvatarType: b.botAvatarType,
              }));
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
            const lastPreview = stripThinkContent(g.lastReplyPreview || '').trim();
            const draftText =
              !active ? formatSessionDraftPreview(draftPreviewsByOwner[g.id] ?? '') : null;
            const squadPreview = draftText
              ? `${t(lang, 'draftPrefix')}${draftText}`
              : lastPreview || g.description || t(lang, 'squadDesc');
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
                  <span className="session-name-row">
                    <span className={`session-name-edit${renaming ? ' is-renaming' : ''}`}>
                      <span className="session-name">{g.name}</span>
                      {renaming ? renameInput : null}
                    </span>
                    {!narrow && !renaming ? (
                      <span className="session-updated">
                        {formatSessionUpdatedAt(item.updatedAt, lang)}
                      </span>
                    ) : null}
                  </span>
                  <span className="session-desc">{squadPreview}</span>
                </span>
                  {shortcutHintByOwnerId?.[g.id] ? (
                    <span className="session-shortcut-hint session-shortcut-hint-row" aria-hidden>
                      {shortcutHintByOwnerId[g.id]}
                    </span>
                  ) : null}
              </div>
            );
            return (
              <div
                key={`squad:${g.id}`}
                data-session-id={`squad:${g.id}`}
                className={`session-item-wrap${active ? ' active' : ''}${narrow ? ' dock-item' : ''}${renaming ? ' renaming' : ''}${draggingOwnerId === g.id ? ' is-dragging' : ''}`}
                role="button"
                tabIndex={0}
                title={narrow ? undefined : g.name}
                draggable={!renaming && showOwnerGroupHeaders && !narrow}
                onDragStart={(e) => {
                  if (renaming || !showOwnerGroupHeaders || narrow) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer.setData(OWNER_MIME, g.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggingOwnerId(g.id);
                }}
                onDragEnd={() => setDraggingOwnerId(null)}
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
                    className="session-beam"
                    size="sm"
                    theme={resolvedOrbTheme()}
                    colorVariant="ocean"
                    strength={0.9}
                    borderRadius={7}
                    duration={2.2}
                  >
                    {squadRow}
                  </BorderBeam>
                ) : (
                  squadRow
                )}
              </div>
            );
  }

  return (
    <aside
      ref={(node) => {
        if (sidebarRef) sidebarRef.current = node;
      }}
      className={`sidebar ${createMenu ? 'menu-open' : ''}${footerMenuOpen ? ' fab-open' : ''}`}
    >
      <div className="sidebar-topbar">
        {/* Always mounted: `.app.narrow` / @container hides these with --sidebar-w
            so collapse does not paint a shrunken strip still showing search/+. */}
        <QuickTip text={t(lang, 'search')} place="below">
        <button
          type="button"
          className="search-btn"
          aria-label={t(lang, 'search')}
          aria-hidden={narrow || undefined}
          tabIndex={narrow ? -1 : 0}
          onClick={onOpenSearch}
        >
          <SearchIcon />
        </button>
        </QuickTip>
        <QuickTip text={t(lang, 'sidebarNew')} place="below">
        <button
          ref={newBtnRef}
          className="new-btn"
          aria-label={t(lang, 'sidebarNew')}
          aria-hidden={narrow || undefined}
          tabIndex={narrow ? -1 : 0}
          onClick={onOpenCreateMenu}
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
        className="session-pane"
        onMouseMove={
          narrow
            ? (e) => {
                onDockMouseMove(e.clientY);
              }
            : undefined
        }
        onMouseLeave={() => onDockMouseLeave()}
      >
        <SessionPinStrip
          lang={lang}
          narrow={narrow}
          pinnedSessions={pinnedSessions}
          listHasRows={listSessions.length > 0}
          showPinDivider={!showOwnerGroupHeaders}
          selection={selection}
          bots={bots}
          dockScales={dockScales}
          defaultAssistantId={defaultAssistantId}
          botIsWorking={botIsWorking}
          sessionHasUnread={sessionHasUnread}
          sessionInteractedAt={sessionInteractedAt}
          avatarMotionNow={avatarMotionNow}
          onSelect={onSelect}
          onOpenSessionMenu={onOpenSessionMenu}
          renameTarget={renameTarget}
          renameValue={renameValue}
          onRenameValueChange={onRenameValueChange}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
          onPlaceDockTip={onPlaceDockTip}
          onScheduleHideDockTip={onScheduleHideDockTip}
          shortcutHintByOwnerId={shortcutHintByOwnerId}
        />
        <div
          className="session-list scroll-fade"
          ref={sessionListRef}
          onScroll={narrow ? () => onDockScroll() : undefined}
        >
        {sessions.length === 0 ? (
          <div className="empty-side">{t(lang, 'emptySide')}</div>
        ) : showOwnerGroupHeaders ? (
          ownerGroupSections.map((section) => {
            const expanded = isOwnerGroupExpanded(section.groupId);
            return (
              <div
                key={section.groupId}
                className={`session-owner-group${dragOverGroupId === section.groupId ? ' is-drag-over' : ''}`}
                data-owner-group={section.groupId}
                onDragOver={(e) => onGroupDragOver(e, section.groupId)}
                onDragLeave={(e) => onGroupDragLeave(e, section.groupId)}
                onDrop={(e) => onGroupDrop(e, section.groupId)}
              >
                {renderOwnerGroupHeader(section)}
                <div
                  className={`session-group-fold${expanded ? ' is-open' : ''}`}
                  aria-hidden={!expanded}
                >
                  <div className="session-group-fold-inner">
                    {section.items.map((item) => renderSessionItem(item))}
                    {section.items.length === 0 ? (
                      <div
                        className={`session-group-drop-hint${dragOverGroupId === section.groupId ? ' is-drag-over' : ''}`}
                        onDragOver={(e) => onGroupDragOver(e, section.groupId)}
                        onDragLeave={(e) => onGroupDragLeave(e, section.groupId)}
                        onDrop={(e) => onGroupDrop(e, section.groupId)}
                      >
                        {t(lang, 'groupDropHere')}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          listSessions.map((item) => renderSessionItem(item))
        )}
        {hiddenSessions.length > 0 ? (
          <div className="session-hidden-group">
            {(() => {
              const hiddenLabel = t(lang, 'hiddenGroup');
              const btn = (
                <button
                  type="button"
                  className={`session-hidden-header${hiddenExpanded ? ' expanded' : ''}`}
                  aria-expanded={hiddenExpanded}
                  aria-label={hiddenLabel}
                  title={narrow ? undefined : hiddenLabel}
                  onClick={() => setHiddenExpanded((v) => !v)}
                  onMouseEnter={
                    narrow
                      ? () => {
                          onHideDockTip();
                        }
                      : undefined
                  }
                >
                  {!narrow ? (
                    <span className="session-hidden-label">{hiddenLabel}</span>
                  ) : null}
                  <span className="session-hidden-trailing">
                    {!narrow ? (
                      <span className="session-hidden-count">{hiddenSessions.length}</span>
                    ) : null}
                    <span className="session-hidden-chevron" aria-hidden>
                      <ChevronDownIcon />
                    </span>
                  </span>
                </button>
              );
              const tipped = narrow ? (
                <QuickTip text={hiddenLabel} place="right">
                  {btn}
                </QuickTip>
              ) : (
                btn
              );
              return (
                <div className="session-group-sticky" data-flip-id="group:__hidden__">
                  {tipped}
                </div>
              );
            })()}
            <div
              className={`session-group-fold${hiddenExpanded ? ' is-open' : ''}`}
              aria-hidden={!hiddenExpanded}
            >
              <div className="session-group-fold-inner">
                {hiddenSessions.map((item) => renderSessionItem(item))}
              </div>
            </div>
          </div>
        ) : null}
        </div>
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
              </button>
              </QuickTip>
              {renderUpdateButton('menuitem')}
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
              </button>
              </QuickTip>
              <QuickTip text={t(lang, 'aboutOpen')}>
              <button
                type="button"
                className="footer-btn"
                role="menuitem"
                aria-label={t(lang, 'aboutOpen')}
                onClick={() => {
                  setFooterMenuOpen(false);
                  onOpenAbout();
                }}
              >
                <span className="ico">
                  <AboutIcon />
                </span>
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
            <button
              type="button"
              className="footer-btn"
              onClick={onOpenSettings}
              aria-label={t(lang, 'settings')}
            >
              <span className="ico">
                <SettingsIcon />
              </span>
              <span className="label">{t(lang, 'settings')}</span>
            </button>
            <button
              type="button"
              className="footer-btn"
              onClick={onOpenAssistantGallery}
              aria-label={t(lang, 'galleryTitle')}
            >
              <span className="ico">
                <AssistantGalleryIcon />
              </span>
              <span className="label">{t(lang, 'galleryTitle')}</span>
            </button>
            {renderUpdateButton()}
          </div>
        )}
      </div>
    </aside>
  );
});
