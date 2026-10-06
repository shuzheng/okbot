import type { Bot } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';
import { CheckIcon } from '../../components/ui/icons';
import { AssistantGalleryList } from '../bots';

/**
 * First-run guide on the empty main pane:
 * 1) add one model provider, 2) pick a starter assistant, 3) send the first message.
 */
export function QuickStartPanel({
  lang,
  modelReady,
  onOpenModelSettings,
  onCreateOwn,
  existingNames,
  onInstalled,
}: {
  lang: UiLang;
  modelReady: boolean;
  onOpenModelSettings: () => void;
  onCreateOwn: () => void;
  /** Names of current assistants (gallery marks them as added). */
  existingNames: readonly string[];
  onInstalled: (bot: Bot) => void;
}) {
  return (
    <div className="quick-start" role="region" aria-label={t(lang, 'quickStartTitle')}>
      <h2 className="quick-start-title">{t(lang, 'quickStartTitle')}</h2>
      <p className="quick-start-sub">{t(lang, 'quickStartSub')}</p>

      <section className={`quick-start-step${modelReady ? ' done' : ' current'}`}>
        <div className="quick-start-step-head">
          <span className="quick-start-step-num" aria-hidden>
            {modelReady ? <CheckIcon /> : '1'}
          </span>
          <span className="quick-start-step-title">{t(lang, 'quickStartStepModel')}</span>
          {modelReady ? null : (
            <button type="button" className="settings-aar-add-btn" onClick={onOpenModelSettings}>
              {t(lang, 'quickStartAddModel')}
            </button>
          )}
        </div>
        {modelReady ? null : <p className="quick-start-step-hint">{t(lang, 'quickStartStepModelHint')}</p>}
      </section>

      <section
        className={`quick-start-step${modelReady ? ' current' : ''}`}
        aria-disabled={modelReady ? undefined : 'true'}
      >
        <div className="quick-start-step-head">
          <span className="quick-start-step-num" aria-hidden>
            2
          </span>
          <span className="quick-start-step-title">{t(lang, 'quickStartStepAssistant')}</span>
          <button
            type="button"
            className="settings-aar-add-btn"
            disabled={!modelReady}
            onClick={onCreateOwn}
          >
            {t(lang, 'quickStartCreateOwn')}
          </button>
        </div>
        <AssistantGalleryList lang={lang} disabled={!modelReady} existingNames={existingNames} onInstalled={onInstalled} />
      </section>

      <section className="quick-start-step" aria-disabled="true">
        <div className="quick-start-step-head">
          <span className="quick-start-step-num" aria-hidden>
            3
          </span>
          <span className="quick-start-step-title">{t(lang, 'quickStartStepChat')}</span>
        </div>
      </section>
    </div>
  );
}
