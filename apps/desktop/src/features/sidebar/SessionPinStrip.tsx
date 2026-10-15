import type { CSSProperties, MouseEvent } from 'react';
import type { Bot, Squad } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import type { MenuState, Selection, SessionItem } from '../../types';
import { FlatAvatar, SquadAvatar, type SquadAvatarMember } from '../../components/ui/avatars';
import { usePinStripFlip } from './usePinStripFlip';

type DockTipTarget =
  | { kind: 'bot'; bot: Bot }
  | { kind: 'squad'; squad: Squad; members: SquadAvatarMember[] };

export type SessionPinStripProps = {
  lang: UiLang;
  narrow: boolean;
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
  onSelect: (selection: Selection) => void;
  onOpenSessionMenu: (menu: NonNullable<MenuState>) => void;
  onPlaceDockTip: (node: HTMLElement, target: DockTipTarget) => void;
  onScheduleHideDockTip: () => void;
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

/** Expanded: large centered avatars + name. Collapsed: rail-sized avatars only. */
export function SessionPinStrip({
  lang,
  narrow,
  pinnedSessions,
  listHasRows,
  showPinDivider,
  selection,
  bots,
  dockScales,
  defaultAssistantId,
  botIsWorking,
  sessionHasUnread,
  onSelect,
  onOpenSessionMenu,
  onPlaceDockTip,
  onScheduleHideDockTip,
}: SessionPinStripProps) {
  const { stripRef, displayItems, stripStyle } = usePinStripFlip(pinnedSessions);

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
                className={`${itemClass}${active ? ' active' : ''}`}
                style={leaveStyle}
                role="listitem"
                tabIndex={leaving ? -1 : 0}
                aria-hidden={leaving || undefined}
                onClick={leaving ? undefined : selectBot}
                onContextMenu={leaving ? undefined : botContext}
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
                <span
                  className={`session-avatar-shell session-pin-avatar-shell${unread ? ' unread' : ''}`}
                  title={unread ? t(lang, 'unreadReply') : undefined}
                >
                  <FlatAvatar
                    className={narrow ? 'session-avatar' : 'session-pin-avatar'}
                    emoji={bot.emoji}
                    color={bot.color}
                    avatarKind={bot.avatarKind}
                    botAvatarType={bot.botAvatarType}
                    busy={botIsWorking(bot.id)}
                    style={avatarStyle}
                    size={narrow ? undefined : 56}
                    showDefaultMark={defaultAssistantId === bot.id}
                    defaultMarkTitle={t(lang, 'defaultAssistant')}
                  />
                </span>
                {!narrow ? <span className="session-pin-name">{bot.name}</span> : null}
              </div>
            );
          }

          const g = item.squad;
          const active = !leaving && selection?.kind === 'squad' && selection.id === g.id;
          const tipMembers = squadMembers(g, bots);
          const dockScale = narrow ? dockScales[`squad:${g.id}`] || 1 : 1;
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
              className={`${itemClass}${active ? ' active' : ''}`}
              style={leaveStyle}
              role="listitem"
              tabIndex={leaving ? -1 : 0}
              aria-hidden={leaving || undefined}
              onClick={leaving ? undefined : selectSquad}
              onContextMenu={leaving ? undefined : squadContext}
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
              <span
                className={`session-avatar-shell session-pin-avatar-shell${unread ? ' unread' : ''}`}
                title={unread ? t(lang, 'unreadReply') : undefined}
              >
                <span
                  className={narrow ? 'session-avatar' : 'session-pin-avatar'}
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
                    className={narrow ? 'session-avatar' : 'session-pin-avatar'}
                  />
                </span>
              </span>
              {!narrow ? <span className="session-pin-name">{g.name}</span> : null}
            </div>
          );
        })}
      </div>
      {/* Narrow only; show when there are no custom groups (only 未分组). */}
      {narrow && listHasRows && showPinDivider && pinnedSessions.length > 0 ? (
        <div className="session-pin-divider" aria-hidden />
      ) : null}
    </>
  );
}
