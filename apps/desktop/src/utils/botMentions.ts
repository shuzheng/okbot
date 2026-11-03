/**
 * Bot-mention helpers. New multi-kind mentions live in `entityMentions.ts`;
 * this module re-exports the bot-facing API so existing imports keep working.
 */
export {
  type MentionBotRef,
  type MentionResolveOpts,
  isBotMentionHref,
  botIdFromMentionHref,
  mentionHrefForBotId,
  splitBotMentions,
  linkifyBotMentions,
} from './entityMentions';

import type { MentionBotRef } from './entityMentions';

export type MentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; bot: MentionBotRef; raw: string };
