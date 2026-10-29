import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { BorderBeam } from 'border-beam';
import type { Bot, Squad } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import type { MenuState, RenameTarget, Selection, SessionItem } from '../../types';
import { FlatAvatar, SquadAvatar, type SquadAvatarMember } from '../../components/ui/avatars';
import { resolveSessionAvatarMotion } from '../../utils/sessionAvatarMotion';
import { usePinStripFlip } from './usePinStripFlip';

type DockTipTarget =
  | { kind: 'bot'; bot: Bot }
  | { kind: 'squad'; squad: Squad; members: SquadAvatarMember[] };

export type SessionPinStripProps = {
  lang: UiLang;
  narrow: boolean;
  /** Size 置顶 avatars to rail immediately with width; independent of deferred railLayout. */
  avatarCompact?: boolean;
  pinnedSessions: SessionItem[];
  listHasRows: boolean;
  /** When true (only implicit 未分组 / no custom groups), show the narrow pin divider. */
  showPinDivider: boolean;
  selection: Selection;
  bots: Bot[];
  dockScales: Record<string, number>;
  defaultAssistantId: string;
  botIsWorking: (id: string) => boolean;
  sessionHasUnread: (id: string) => boolean;
  sessionInteractedAt?: Record<string, number>;
  avatarMotionNow?: number;
  onSelect: (selection: Selection) => void;
  onOpenSessionMenu: (menu: NonNullable<MenuState>) => void;
  renameTarget: RenameTarget;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onPlaceDockTip: (node: HTMLElement, target: DockTipTarget) => void;
  onScheduleHideDockTip: () => void;
  /** When set, show ⌘/Win+N badge on pin avatar top-right. */
  shortcutHintByOwnerId?: Record<string, string>;
};

function squadMembers(squad: Squad, bots: Bot[]): SquadAvatarMember[] {
  const memberAvatars: SquadAvatarMember[] = squad.members
    .map((m) => bots.find((b) => b.id === m.botId))
    .filter((b): b is Bot => !!b)
    .map((b) => ({
      emoji: b.emoji,
      color: b.color,
      avatarKind: b.avatarKind,
      botAvatarType: b.botAvatarType,
    }));
  return memberAvatars.length ? memberAvatars : [{ emoji: '👥', color: '#6366F1' }];
}

function resolvedOrbTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/** Match session-list busy BorderBeam: ring the whole pin chrome (avatar + name), not just the avatar. */
function pinBusyBeam(busy: boolean, child: ReactNode) {
  if (!busy) return child;
  return (
    <BorderBeam
      className="session-beam session-pin-beam"
      size="sm"
      theme={resolvedOrbTheme()}
      colorVariant="ocean"
      strength={0.9}
      borderRadius={7}
      duration={2.2}
    >
      {child}
    </BorderBeam>
  );
}

/** Expanded: large centered avatars + name. Collapsed: rail-sized avatars only. */
export function SessionPinStrip({
  lang,
  narrow,
  avatarCompact = false,
  pinnedSessions,
  listHasRows,
  showPinDivider,
  selection,
  bots,
  dockScales,
  defaultAssistantId,
  botIsWorking,
  sessionHasUnread,
  sessionInteractedAt = {},
  avatarMotionNow = 0,
  onSelect,
  onOpenSessionMenu,
  renameTarget,
  renameValue,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onPlaceDockTip,
  onScheduleHideDockTip,
  shortcutHintByOwnerId,
}: SessionPinStripProps) {
  const { stripRef, displayItems, stripStyle } = usePinStripFlip(pinnedSessions);

  const renameInput = (
    <input
      spellCheck={false}
      className="session-rename-input session-pin-rename-input"
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

  if (displayItems.length === 0) return null;

  return (
    <>
      <div className="session-pin-strip" role="list" ref={stripRef} style={stripStyle}>
        {displayItems.map(({ item, id, phase, leaveStyle }) => {
          const leaving = phase === 'leave';
          const itemClass = `session-pin-item${narrow ? ' dock-item' : ''}${
            leaving ? ' is-leaving' : ''
          }`;

          if (item.kind === 'bot') {
            const bot = item.bot;
            const active = !leaving && selection?.kind === 'bot' && selection.id === bot.id;
            const selectBot = () => onSelect({ kind: 'bot', id: bot.id });
            const botContext = (e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenSessionMenu({ kind: 'bot', x: e.clientX, y: e.clientY, bot });
            };
            const dockScale = narrow ? dockScales[`bot:${bot.id}`] || 1 : 1;
            const renaming = renameTarget?.kind === 'bot' && renameTarget.id === bot.id;
            const unread = !active && sessionHasUnread(bot.id) && !botIsWorking(bot.id);
            const avatarStyle: CSSProperties | undefined = narrow
              ? {
                  transform: `scale(${dockScale})`,
                  zIndex: Math.round(dockScale * 10),
                }
              : undefined;
            return (
              <div
                key={`pin:${id}`}
                data-session-id={id}
                data-pin-phase={phase}
                className={`${itemClass}${active ? ' active' : ''}${renaming ? ' renaming' : ''}`}
                style={leaveStyle}
                role="listitem"
                tabIndex={leaving ? -1 : 0}
                aria-hidden={leaving || undefined}
                onClick={leaving || renaming ? undefined : selectBot}
                onContextMenu={leaving || renaming ? undefined : botContext}
                onMouseEnter={
                  leaving
                    ? undefined
                    : (e) => {
                        onPlaceDockTip(e.currentTarget, { kind: 'bot', bot });
                      }
                }
                onMouseLeave={leaving ? undefined : () => onScheduleHideDockTip()}
                onKeyDown={
                  leaving
                    ? undefined
                    : (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          selectBot();
                        }
                      }
                }
              >
                {pinBusyBeam(
                  botIsWorking(bot.id),
                  <>
                    <span
                      className={`session-avatar-shell session-pin-avatar-shell${unread ? ' unread' : ''}`}
                      title={unread ? t(lang, 'unreadReply') : undefined}
                    >
                      <FlatAvatar
                        className={avatarCompact ? 'session-avatar' : 'session-pin-avatar'}
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
                        size={avatarCompact ? 36 : 56}
                        showDefaultMark={defaultAssistantId === bot.id}
                        defaultMarkTitle={t(lang, 'defaultAssistant')}
                      />
                      {shortcutHintByOwnerId?.[bot.id] ? (
                        <span className="session-shortcut-hint session-shortcut-hint-pin" aria-hidden>
                          {shortcutHintByOwnerId[bot.id]}
                        </span>
                      ) : null}
                    </span>
                    {/* Always mounted: `.app.narrow` / @container hides the label in the
                        same frame as --sidebar-w (React unmount lagged one paint). */}
                    <span className={`session-pin-name-edit${renaming ? ' is-renaming' : ''}`}>
                      <span className="session-pin-name">{bot.name}</span>
                      {renaming ? renameInput : null}
                    </span>
                  </>,
                )}
              </div>
            );
          }

          const g = item.squad;
          const active = !leaving && selection?.kind === 'squad' && selection.id === g.id;
          const tipMembers = squadMembers(g, bots);
          const dockScale = narrow ? dockScales[`squad:${g.id}`] || 1 : 1;
          const renaming = renameTarget?.kind === 'squad' && renameTarget.id === g.id;
          const unread = !active && sessionHasUnread(g.id) && !botIsWorking(g.id);
          const selectSquad = () => onSelect({ kind: 'squad', id: g.id });
          const squadContext = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenSessionMenu({ kind: 'squad', x: e.clientX, y: e.clientY, squad: g });
          };
          return (
            <div
              key={`pin:${id}`}
              data-session-id={id}
              data-pin-phase={phase}
              className={`${itemClass}${active ? ' active' : ''}${renaming ? ' renaming' : ''}`}
              style={leaveStyle}
              role="listitem"
              tabIndex={leaving ? -1 : 0}
              aria-hidden={leaving || undefined}
              onClick={leaving || renaming ? undefined : selectSquad}
              onContextMenu={leaving || renaming ? undefined : squadContext}
              onMouseEnter={
                leaving
                  ? undefined
                  : (e) => {
                      onPlaceDockTip(e.currentTarget, {
                        kind: 'squad',
                        squad: g,
                        members: tipMembers,
                      });
                    }
              }
              onMouseLeave={leaving ? undefined : () => onScheduleHideDockTip()}
              onKeyDown={
                leaving
                  ? undefined
                  : (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectSquad();
                      }
                    }
              }
            >
              {pinBusyBeam(
                botIsWorking(g.id),
                <>
                  <span
                    className={`session-avatar-shell session-pin-avatar-shell${unread ? ' unread' : ''}`}
                    title={unread ? t(lang, 'unreadReply') : undefined}
                  >
                    <span
                      className={avatarCompact ? 'session-avatar' : 'session-pin-avatar'}
                      style={
                        narrow
                          ? {
                              transform: `scale(${dockScale})`,
                              zIndex: Math.round(dockScale * 10),
                            }
                          : undefined
                      }
                    >
                      <SquadAvatar
                        members={tipMembers}
                        className={avatarCompact ? 'session-avatar' : 'session-pin-avatar'}
                      />
                    </span>
                    {shortcutHintByOwnerId?.[g.id] ? (
                      <span className="session-shortcut-hint session-shortcut-hint-pin" aria-hidden>
                        {shortcutHintByOwnerId[g.id]}
                      </span>
                    ) : null}
                  </span>
                  <span className={`session-pin-name-edit${renaming ? ' is-renaming' : ''}`}>
                    <span className="session-pin-name">{g.name}</span>
                    {renaming ? renameInput : null}
                  </span>
                </>,
              )}
            </div>
          );
        })}
      </div>
      {/* Mount whenever pins sit above the list (no custom groups). Size/visibility
          follow sidebar @container / .narrow so collapse does not flash the
          divider only after deferred railLayout. */}
      {listHasRows && showPinDivider && pinnedSessions.length > 0 ? (
        <div className="session-pin-divider" aria-hidden />
      ) : null}
    </>
  );
}
