import { stripThinkContent, type Bot, type ChatMessage, type MeshExchangeMeta } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { FlatAvatar } from '../../components/ui/avatars';
import { CloseIcon } from '../../components/ui/icons';
import type { MentionBotRef } from '../../utils/botMentions';
import { AssistantContent } from './AssistantContent';

function resolveBot(
  bots: readonly Bot[],
  botId: string,
  fallbackName: string,
): { name: string; bot: Bot | null; ref: MentionBotRef } {
  const bot = bots.find((b) => b.id === botId) ?? null;
  const name = (bot?.name || '').trim() || fallbackName || botId;
  return {
    name,
    bot,
    ref: bot ?? {
      id: botId,
      name,
      emoji: '🤖',
      color: '',
    },
  };
}

/** One read-only turn rendered like a normal chat assistant bubble (avatar + label + body). */
function PeerBubble(props: {
  lang: UiLang;
  bots: readonly Bot[];
  botId: string;
  fallbackName: string;
  body: string;
}) {
  const { lang, bots, botId, fallbackName, body } = props;
  const { name, ref } = resolveBot(bots, botId, fallbackName);
  const text = stripThinkContent(body || '').trim() || (body || '').trim();
  return (
    <div className="bubble-row assistant has-speaker mesh-exchange-bubble-row">
      <FlatAvatar
        className="bubble-speaker-avatar"
        emoji={ref.emoji || '🤖'}
        color={ref.color || ''}
        avatarKind={ref.avatarKind}
        botAvatarType={ref.botAvatarType}
        title={name}
        paused
      />
      <div className="bubble-body-row bubble-body-row-assistant">
        <div className="bubble assistant has-speaker-label">
          <div className="bubble-speaker-label">{name}</div>
          {text ? (
            <AssistantContent lang={lang} content={text} showThinking={false} bots={bots} />
          ) : (
            <span className="mesh-exchange-empty">{t(lang, 'meshExchangeEmptyBody')}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Caller + callee: same `.header-identity` / `.header-avatar` / `h1` as private-chat header. */
function HeaderIdentity({
  bot,
  name,
  primary = false,
}: {
  bot: MentionBotRef;
  name: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`header-identity ${
        primary ? 'mesh-exchange-header-primary' : 'mesh-exchange-header-peer'
      }`}
    >
      <FlatAvatar
        className="header-avatar"
        emoji={bot.emoji || '🤖'}
        color={bot.color || ''}
        avatarKind={bot.avatarKind}
        botAvatarType={bot.botAvatarType}
        title={name}
        paused
      />
      <h1>{name}</h1>
    </div>
  );
}

/**
 * Full chat-area peer transcript (not a floating dialog): same bubble chrome as
 * main chat; header = private-chat identity slot + → peer; top-right X close.
 */
export function MeshExchangeModal(props: {
  lang: UiLang;
  bots: readonly Bot[];
  message: ChatMessage;
  onClose: () => void;
}) {
  const { lang, bots, message, onClose } = props;
  const meta = message.meshExchange as MeshExchangeMeta | undefined;
  if (!meta) return null;

  const caller = resolveBot(bots, meta.callerBotId, meta.callerName);
  const peer = resolveBot(bots, meta.peerBotId, meta.peerName);

  return (
    <div
      className="mesh-exchange-panel"
      role="dialog"
      aria-modal="true"
      aria-label={t(lang, 'meshExchangeTitle')}
    >
      <div className="mesh-exchange-panel-header">
        <HeaderIdentity bot={caller.ref} name={caller.name} primary />
        <span className="mesh-exchange-header-arrow" aria-hidden>
          →
        </span>
        <HeaderIdentity bot={peer.ref} name={peer.name} />
        <button
          type="button"
          className="mesh-exchange-header-close"
          onClick={onClose}
          aria-label={t(lang, 'close')}
          title={t(lang, 'close')}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="messages scroll-fade mesh-exchange-panel-thread" role="log" aria-live="polite">
        <PeerBubble
          lang={lang}
          bots={bots}
          botId={meta.callerBotId}
          fallbackName={meta.callerName}
          body={meta.ask}
        />
        {meta.reply != null && meta.reply !== '' ? (
          <PeerBubble
            lang={lang}
            bots={bots}
            botId={meta.peerBotId}
            fallbackName={meta.peerName}
            body={meta.reply}
          />
        ) : (
          <div className="mesh-exchange-pending">{t(lang, 'meshExchangeWaiting')}</div>
        )}
      </div>
    </div>
  );
}
