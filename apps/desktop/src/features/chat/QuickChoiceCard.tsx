import { memo } from 'react';
import type { QuickChoice } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { CloseIcon } from '../../components/ui';

/**
 * Quick-choice card under an assistant reply (payload from the model's
 * `ask_choice`). Clicking an option sends its text as the user's reply;
 * × only hides the card — the user can always type freely instead.
 */
export const QuickChoiceCard = memo(function QuickChoiceCard({
  lang,
  choice,
  disabled,
  onPick,
  onDismiss,
}: {
  lang: UiLang;
  choice: QuickChoice;
  disabled?: boolean;
  onPick: (text: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="quick-choice">
      <div className="quick-choice-card" role="group" aria-label={choice.question}>
        <div className="quick-choice-head">
          <div className="quick-choice-question">{choice.question}</div>
          <button
            type="button"
            className="quick-choice-close"
            onClick={onDismiss}
            aria-label={t(lang, 'quickChoiceDismiss')}
            title={t(lang, 'quickChoiceDismiss')}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="quick-choice-options">
          {choice.options.map((opt, i) => (
            <button
              key={`${i}-${opt}`}
              type="button"
              className="quick-choice-option"
              disabled={disabled}
              onClick={() => onPick(opt)}
            >
              <span className="quick-choice-badge" aria-hidden>
                {String.fromCharCode(65 + i)}
              </span>
              <span className="quick-choice-text">{opt}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="quick-choice-hint">{t(lang, 'quickChoiceHint')}</div>
    </div>
  );
});
