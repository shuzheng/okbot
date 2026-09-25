import { useMemo, useState } from 'react';
import type { Bot, BotOnboardingAnswers } from '@okbot/shared';
import { t, type UiLang } from '../../i18n';

const SCENARIOS = [
  { id: 'coding', zh: '编程调试', en: 'Coding & debugging' },
  { id: 'content', zh: '内容创作', en: 'Content creation' },
  { id: 'data', zh: '数据分析', en: 'Data analysis' },
  { id: 'daily', zh: '日常助理', en: 'Daily assistant' },
  { id: 'learning', zh: '学习答疑', en: 'Learning & tutoring' },
  { id: 'translate', zh: '翻译润色', en: 'Translation & polishing' },
  { id: 'office', zh: '办公文档', en: 'Office docs & email' },
  { id: 'research', zh: '资料检索', en: 'Research & summarization' },
  { id: 'product', zh: '产品需求', en: 'Product & requirements' },
  { id: 'ops', zh: '运维排障', en: 'Ops & troubleshooting' },
  { id: 'other', zh: '其他', en: 'Other' },
] as const;

const HOWS = [
  { id: 'concise', zh: '简洁直接，少废话', en: 'Concise and direct' },
  { id: 'plan_first', zh: '先给方案再动手', en: 'Plan first, then act' },
  { id: 'ask_first', zh: '重要操作先问我', en: 'Ask before important actions' },
  { id: 'teach', zh: '偏讲解，带一点教学', en: 'Explain as you go' },
  { id: 'other', zh: '其他', en: 'Other' },
] as const;

type Props = {
  lang: UiLang;
  bot: Bot;
  onDone: (bot: Bot) => void;
};

export function BotOnboarding({ lang, bot, onDone }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [scenarioId, setScenarioId] = useState<string>('');
  const [howId, setHowId] = useState<string>('');
  const [scenarioCustom, setScenarioCustom] = useState('');
  const [howCustom, setHowCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const scenarioLabel = useMemo(() => {
    if (!scenarioId) return '';
    if (scenarioId === 'other') return scenarioCustom.trim();
    const hit = SCENARIOS.find((s) => s.id === scenarioId);
    return hit ? (lang === 'zh' ? hit.zh : hit.en) : '';
  }, [scenarioId, scenarioCustom, lang]);

  const howLabel = useMemo(() => {
    if (!howId) return '';
    if (howId === 'other') return howCustom.trim();
    const hit = HOWS.find((s) => s.id === howId);
    return hit ? (lang === 'zh' ? hit.zh : hit.en) : '';
  }, [howId, howCustom, lang]);

  async function finish(partial: 'skip' | 'save') {
    setBusy(true);
    setError('');
    try {
      const answers: BotOnboardingAnswers =
        partial === 'skip'
          ? {}
          : {
              ...(scenarioLabel
                ? { scenarioId: scenarioId || 'other', scenarioLabel }
                : {}),
              ...(howLabel ? { howId: howId || 'other', howLabel } : {}),
            };
      const updated = await window.okbot.finishBotOnboarding(bot.id, answers);
      onDone(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="onboard-card">
      {step === 1 ? (
        <>
          <div className="onboard-title">{t(lang, 'onboardQ1', { name: bot.name })}</div>
          <div className="onboard-options">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`onboard-chip${scenarioId === s.id ? ' on' : ''}`}
                onClick={() => setScenarioId(s.id)}
              >
                {lang === 'zh' ? s.zh : s.en}
              </button>
            ))}
          </div>
          {scenarioId === 'other' ? (
            <input
              spellCheck={false}
              className="onboard-input"
              value={scenarioCustom}
              onChange={(e) => setScenarioCustom(e.target.value)}
              placeholder={t(lang, 'onboardOtherPlaceholder')}
              autoFocus
            />
          ) : null}
          {error ? <div className="onboard-error">{error}</div> : null}
          <div className="onboard-actions">
            <button type="button" disabled={busy} onClick={() => void finish('skip')}>
              {busy ? t(lang, 'onboardSaving') : t(lang, 'onboardSkip')}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                if (scenarioLabel) setStep(2);
                else void finish('save');
              }}
            >
              {busy
                ? t(lang, 'onboardSaving')
                : scenarioLabel
                  ? t(lang, 'onboardNext')
                  : t(lang, 'onboardFinish')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="onboard-title">{t(lang, 'onboardQ2')}</div>
          {scenarioLabel ? (
            <div className="onboard-sub">{t(lang, 'onboardPicked', { scenario: scenarioLabel })}</div>
          ) : null}
          <div className="onboard-options">
            {HOWS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`onboard-chip${howId === s.id ? ' on' : ''}`}
                onClick={() => setHowId(s.id)}
              >
                {lang === 'zh' ? s.zh : s.en}
              </button>
            ))}
          </div>
          {howId === 'other' ? (
            <input
              spellCheck={false}
              className="onboard-input"
              value={howCustom}
              onChange={(e) => setHowCustom(e.target.value)}
              placeholder={t(lang, 'onboardHowPlaceholder')}
              autoFocus
            />
          ) : null}
          {error ? <div className="onboard-error">{error}</div> : null}
          <div className="onboard-actions">
            <button type="button" disabled={busy} onClick={() => setStep(1)}>
              {t(lang, 'onboardBack')}
            </button>
            <button type="button" disabled={busy} onClick={() => void finish('skip')}>
              {t(lang, 'onboardSkip')}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void finish('save')}
            >
              {busy ? t(lang, 'onboardSaving') : t(lang, 'onboardFinish')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
