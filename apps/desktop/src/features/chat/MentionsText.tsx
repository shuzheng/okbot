import { Fragment, memo, useMemo } from 'react';
import { BotMentionChip } from '../../components/ui/BotMentionChip';
import {
  splitBotMentions,
  type MentionBotRef,
  type MentionResolveOpts,
} from '../../utils/botMentions';

/** Plain-text renderer that turns roster `@助手名` / `@id` into mention chips. */
export const MentionsText = memo(function MentionsText({
  text,
  bots,
  preferBotId,
}: {
  text: string;
  bots: readonly MentionBotRef[];
  /** Open-session owner id — disambiguate duplicate display names. */
  preferBotId?: string;
}) {
  const opts = useMemo<MentionResolveOpts | undefined>(
    () => (preferBotId ? { preferBotId } : undefined),
    [preferBotId],
  );
  const segments = useMemo(
    () => splitBotMentions(text || '', bots, opts),
    [text, bots, opts],
  );
  if (!text) return null;
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          <Fragment key={i}>{seg.text}</Fragment>
        ) : (
          <BotMentionChip key={`${seg.bot.id}:${i}`} bot={seg.bot} />
        ),
      )}
    </>
  );
});
