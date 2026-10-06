import { isMcpToolName } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import type { ToolCard } from '../../types';

export type ToolCardViewProps = {
  lang: UiLang;
  card: ToolCard;
  onApprove: (requestId: string) => void;
  onDeny: (requestId: string) => void;
  onApproveForever: (card: ToolCard) => void;
};

export function ToolCardView({
  lang,
  card,
  onApprove,
  onDeny,
  onApproveForever,
}: ToolCardViewProps) {
  const collapsed = card.status !== 'pending';
  const isMcp = isMcpToolName(card.toolName);
  return (
    <div key={card.requestId} className={`tool-card${collapsed ? ' collapsed' : ''}`}>
      {!collapsed ? <div className="tool-card-title">{t(lang, 'toolRequestTitle')}</div> : null}
      <div className="tool-card-name">
        <code>{card.toolName}</code>
        <span className={`tool-card-status ${card.status}`}>
          {card.status === 'pending'
            ? t(lang, 'toolWaiting')
            : card.status === 'approved'
              ? t(lang, 'toolApproved')
              : t(lang, 'toolDenied')}
        </span>
      </div>
      {!collapsed ? (
        <>
          {isMcp ? <div className="tool-card-note">{t(lang, 'toolMcpAlwaysAsk')}</div> : null}
          <pre className="tool-card-args">{JSON.stringify(card.arguments, null, 2)}</pre>
          {card.output ? <pre className="tool-card-output">{card.output}</pre> : null}
          <div className="tool-card-actions">
            {/* MCP calls always ask; no permanent allow for them. */}
            {isMcp ? null : (
              <button
                type="button"
                className="tool-btn forever"
                onClick={() => onApproveForever(card)}
              >
                {t(lang, 'toolApproveForever')}
              </button>
            )}
            <button
              type="button"
              className="tool-btn approve"
              onClick={() => onApprove(card.requestId)}
            >
              {t(lang, 'toolApprove')}
            </button>
            <button
              type="button"
              className="tool-btn deny"
              onClick={() => onDeny(card.requestId)}
            >
              {t(lang, 'toolDeny')}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
