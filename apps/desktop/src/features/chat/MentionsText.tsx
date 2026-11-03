import { Fragment, memo, useMemo } from 'react';
import { EntityMentionChip } from '../../components/ui/EntityMentionChip';
import {
  botRefToEntity,
  splitEntityMentions,
  type MentionBotRef,
  type MentionEntityRef,
  type MentionResolveOpts,
} from '../../utils/entityMentions';
import { splitUrls } from '../../utils/splitUrls';
import { ChatExternalLink } from './ChatExternalLink';

/** Plain-text renderer: roster @mentions → chips; bare http(s) URLs → icon+underline links. */
export const MentionsText = memo(function MentionsText({
  text,
  bots,
  catalog,
  preferBotId,
}: {
  text: string;
  bots: readonly MentionBotRef[];
  /** Multi-kind catalog (bots/squads/schedules/skills). Falls back to bots when omitted. */
  catalog?: readonly MentionEntityRef[];
  /** Open-session owner id — disambiguate duplicate display names. */
  preferBotId?: string;
}) {
  const opts = useMemo<MentionResolveOpts | undefined>(
    () => (preferBotId ? { preferBotId } : undefined),
    [preferBotId],
  );
  const resolvedCatalog = useMemo(() => {
    if (catalog && catalog.length) return catalog;
    return bots.map(botRefToEntity);
  }, [catalog, bots]);
  const segments = useMemo(
    () => splitEntityMentions(text || '', resolvedCatalog, opts),
    [text, resolvedCatalog, opts],
  );
  if (!text) return null;
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind !== 'text') {
          return (
            <EntityMentionChip
              key={`${seg.entity.kind}:${seg.entity.id}:${i}`}
              entity={seg.entity}
            />
          );
        }
        const parts = splitUrls(seg.text);
        return (
          <Fragment key={i}>
            {parts.map((part, j) =>
              part.kind === 'url' ? (
                <ChatExternalLink key={`${i}:${j}`} href={part.href}>
                  {part.text}
                </ChatExternalLink>
              ) : (
                <Fragment key={`${i}:${j}`}>{part.text}</Fragment>
              ),
            )}
          </Fragment>
        );
      })}
    </>
  );
});
