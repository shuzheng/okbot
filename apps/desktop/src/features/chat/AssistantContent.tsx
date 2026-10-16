import { memo, useMemo } from 'react';
import { parseThinkContent } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import type { MentionBotRef } from '../../utils/botMentions';
import { MarkdownContent } from './MarkdownContent';

export type AssistantContentProps = {
  lang: UiLang;
  content: string;
  /** Per-model flag; default false (`=== true` to show). */
  showThinking?: boolean;
  /** Roster for `@助手` mention chips inside markdown. */
  bots?: readonly MentionBotRef[];
};

/**
 * Renders assistant markdown, optionally surfacing `<think>…</think>` as a
 * collapsible block (collapsed by default). When showThinking is false, think
 * spans are stripped from the display path.
 *
 * Always projects through parseThinkContent (including incomplete-tag hold-back)
 * so streaming never paints raw `<think` / think bodies into the main bubble.
 */
export const AssistantContent = memo(function AssistantContent({
  lang,
  content,
  showThinking = false,
  bots = [],
}: AssistantContentProps) {
  const parsed = useMemo(() => parseThinkContent(content || ''), [content]);

  if (!showThinking) {
    if (!parsed.answer) return null;
    return (
      <MarkdownContent lang={lang} bots={bots}>
        {parsed.answer}
      </MarkdownContent>
    );
  }

  if (!parsed.hasThinking) {
    // Use parsed.answer (not raw content) so mid-stream `<think` prefixes stay held.
    if (!parsed.answer) return null;
    return (
      <MarkdownContent lang={lang} bots={bots}>
        {parsed.answer}
      </MarkdownContent>
    );
  }

  return (
    <>
      {parsed.thinking.length > 0 ? (
        <details className="md-thinking">
          <summary className="md-thinking-summary">{t(lang, 'thinkingProcess')}</summary>
          <div className="md-thinking-body">
            {parsed.thinking.map((block, i) => (
              <div key={i} className="md-thinking-block">
                <MarkdownContent lang={lang} bots={bots}>
                  {block}
                </MarkdownContent>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {parsed.answer ? (
        <MarkdownContent lang={lang} bots={bots}>
          {parsed.answer}
        </MarkdownContent>
      ) : null}
    </>
  );
});
