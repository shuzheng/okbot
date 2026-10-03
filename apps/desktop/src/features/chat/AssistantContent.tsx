import { memo, useMemo } from 'react';
import { parseThinkContent } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { MarkdownContent } from './MarkdownContent';

export type AssistantContentProps = {
  lang: UiLang;
  content: string;
  /** Per-model flag; default true (`!== false`). */
  showThinking?: boolean;
};

/**
 * Renders assistant markdown, optionally surfacing `<think>…</think>` as a
 * collapsible block (collapsed by default). When showThinking is false, think
 * spans are stripped from the display path.
 */
export const AssistantContent = memo(function AssistantContent({
  lang,
  content,
  showThinking = true,
}: AssistantContentProps) {
  const parsed = useMemo(() => parseThinkContent(content || ''), [content]);

  if (!showThinking) {
    if (!parsed.answer) return null;
    return <MarkdownContent lang={lang}>{parsed.answer}</MarkdownContent>;
  }

  if (!parsed.hasThinking) {
    if (!content) return null;
    return <MarkdownContent lang={lang}>{content}</MarkdownContent>;
  }

  return (
    <>
      {parsed.thinking.length > 0 ? (
        <details className="md-thinking">
          <summary className="md-thinking-summary">{t(lang, 'thinkingProcess')}</summary>
          <div className="md-thinking-body">
            {parsed.thinking.map((block, i) => (
              <div key={i} className="md-thinking-block">
                <MarkdownContent lang={lang}>{block}</MarkdownContent>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {parsed.answer ? <MarkdownContent lang={lang}>{parsed.answer}</MarkdownContent> : null}
    </>
  );
});
