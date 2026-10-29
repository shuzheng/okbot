import {
  normalizeInstructionsSettings,
  normalizeSquadSettings,
  normalizeMemorySettings,
  type AppSettings,
} from '@okbot/shared';
import { listHardcodedSystemPrompts } from '@okbot/agent/hardcodedSystemPrompts';
import { SettingsHelpTip } from './SettingsHelpTip';
import { SlidingPillTabs } from '../../components/ui';
import type { InstructionsSubTab } from './types';

import { t, type UiLang } from '../../i18n';

export function InstructionsSettingsPanel({
  lang,
  soulMdRefreshSystemPrompt,
  assistantRoleTemplate,
  captainPersona,
  instructionsSubTab,
  scopeInstruction,
  setSoulMdRefreshSystemPrompt,
  setAssistantRoleTemplate,
  setCaptainPersona,
  setInstructionsSubTab,
  setScopeInstruction,
  setSkillsCreateUpdateInstruction,
  setSquadPlaybook,
  skillsCreateUpdateInstruction,
  squadPlaybook,
  tab: _tab,
  settings: _settings,
}: {
  settings: AppSettings;
  lang: UiLang;
  soulMdRefreshSystemPrompt: any;
  assistantRoleTemplate: any;
  captainPersona: any;
  instructionsSubTab: InstructionsSubTab;
  scopeInstruction: any;
  setSoulMdRefreshSystemPrompt: React.Dispatch<React.SetStateAction<any>>;
  setAssistantRoleTemplate: React.Dispatch<React.SetStateAction<any>>;
  setCaptainPersona: React.Dispatch<React.SetStateAction<any>>;
  setInstructionsSubTab: React.Dispatch<React.SetStateAction<InstructionsSubTab>>;
  setScopeInstruction: React.Dispatch<React.SetStateAction<any>>;
  setSkillsCreateUpdateInstruction: React.Dispatch<React.SetStateAction<any>>;
  setSquadPlaybook: React.Dispatch<React.SetStateAction<any>>;
  skillsCreateUpdateInstruction: any;
  squadPlaybook: any;
  tab: any;
}) {
  const otherPromptCount = listHardcodedSystemPrompts().length;

  return (

    <div>
      <SlidingPillTabs
        ariaLabel={t(lang, 'instructions')}
        value={instructionsSubTab}
        onChange={setInstructionsSubTab}
        options={[
          { id: 'assistant', label: t(lang, 'instructionsAssistant') },
          { id: 'squad', label: t(lang, 'instructionsSquad') },
          { id: 'soul', label: t(lang, 'instructionsAgents') },
          { id: 'memory', label: t(lang, 'instructionsMemory') },
          { id: 'skills', label: t(lang, 'instructionsSkills') },
          {
            id: 'builtin',
            label: (
              <span className="instructions-other-tab-label">
                {t(lang, 'instructionsBuiltin')}
                <span
                  className="model-badge instructions-other-count"
                  aria-label={String(otherPromptCount)}
                >
                  {otherPromptCount}
                </span>
              </span>
            ),
          },
        ]}
      />

      {instructionsSubTab === 'assistant' ? (
        <>
          <div className="settings-card settings-card-squad">
            <div
              className="settings-row settings-row-stack"
              data-settings-id="assistantRoleTemplate"
            >
              <span className="settings-row-label">
                <span className="settings-row-label-text">
                  {t(lang, 'assistantRoleTemplate')}
                </span>
                <SettingsHelpTip text={t(lang, 'assistantRoleTemplateHint')} />
              </span>
              <textarea
                className="settings-paths-textarea"
                spellCheck={false}
                rows={3}
                value={assistantRoleTemplate}
                onChange={(e) => setAssistantRoleTemplate(e.target.value)}
                onBlur={() => {
                  const s = normalizeInstructionsSettings({
                    assistantRoleTemplate,
                    soulMdRefreshSystemPrompt,
                    skillsCreateUpdateInstruction,
                  });
                  setAssistantRoleTemplate(s.assistantRoleTemplate);
                }}
              />
            </div>
          </div>
        </>
      ) : instructionsSubTab === 'squad' ? (
        <>
          <div className="settings-card settings-card-squad">
            <div
              className="settings-row settings-row-stack"
              data-settings-id="squadCaptainPersona"
            >
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'squadCaptainPersona')}</span>
                <SettingsHelpTip text={t(lang, 'squadCaptainPersonaHint')} />
              </span>
              <textarea
                className="settings-paths-textarea"
                spellCheck={false}
                rows={5}
                value={captainPersona}
                onChange={(e) => setCaptainPersona(e.target.value)}
                onBlur={() => {
                  const s = normalizeSquadSettings({
                    captainPersona,
                    playbook: squadPlaybook,
                  });
                  setCaptainPersona(s.captainPersona);
                }}
              />
            </div>
            <div
              className="settings-row settings-row-stack"
              data-settings-id="squadPlaybook"
            >
              <span className="settings-row-label">
                <span className="settings-row-label-text">{t(lang, 'squadPlaybook')}</span>
                <SettingsHelpTip text={t(lang, 'squadPlaybookHint')} />
              </span>
              <textarea
                className="settings-paths-textarea"
                spellCheck={false}
                rows={5}
                value={squadPlaybook}
                onChange={(e) => setSquadPlaybook(e.target.value)}
                onBlur={() => {
                  const s = normalizeSquadSettings({
                    captainPersona,
                    playbook: squadPlaybook,
                  });
                  setSquadPlaybook(s.playbook);
                }}
              />
            </div>
          </div>
        </>
      ) : instructionsSubTab === 'soul' ? (
        <>
          <div className="settings-card settings-card-squad">
            <div
              className="settings-row settings-row-stack"
              data-settings-id="soulMdRefreshSystemPrompt"
            >
              <span className="settings-row-label">
                <span className="settings-row-label-text">
                  {t(lang, 'soulMdRefreshSystemPrompt')}
                </span>
                <SettingsHelpTip text={t(lang, 'soulMdRefreshSystemPromptHint')} />
              </span>
              <textarea
                className="settings-paths-textarea"
                spellCheck={false}
                rows={8}
                value={soulMdRefreshSystemPrompt}
                onChange={(e) => setSoulMdRefreshSystemPrompt(e.target.value)}
                onBlur={() => {
                  const s = normalizeInstructionsSettings({
                    assistantRoleTemplate,
                    soulMdRefreshSystemPrompt,
                    skillsCreateUpdateInstruction,
                  });
                  setSoulMdRefreshSystemPrompt(s.soulMdRefreshSystemPrompt);
                }}
              />
            </div>
          </div>
        </>
      ) : instructionsSubTab === 'memory' ? (
        <>
          <div className="settings-card settings-card-squad">
            <div
              className="settings-row settings-row-stack"
              data-settings-id="scopeInstruction"
            >
              <span className="settings-row-label">
                <span className="settings-row-label-text">
                  {t(lang, 'memoryScopeInstruction')}
                </span>
                <SettingsHelpTip text={t(lang, 'memoryScopeInstructionHint')} />
              </span>
              <textarea
                className="settings-paths-textarea"
                spellCheck={false}
                rows={3}
                value={scopeInstruction}
                onChange={(e) => setScopeInstruction(e.target.value)}
                onBlur={() => {
                  const s = normalizeMemorySettings({
                    scopeInstruction,
                  });
                  setScopeInstruction(s.scopeInstruction);
                }}
              />
            </div>
          </div>
        </>
      ) : instructionsSubTab === 'skills' ? (
        <>
          <div className="settings-card settings-card-squad">
            <div
              className="settings-row settings-row-stack"
              data-settings-id="skillsCreateUpdateInstruction"
            >
              <span className="settings-row-label">
                <span className="settings-row-label-text">
                  {t(lang, 'skillsCreateUpdateInstruction')}
                </span>
                <SettingsHelpTip text={t(lang, 'skillsCreateUpdateInstructionHint')} />
              </span>
              <textarea
                className="settings-paths-textarea"
                spellCheck={false}
                rows={3}
                value={skillsCreateUpdateInstruction}
                onChange={(e) => setSkillsCreateUpdateInstruction(e.target.value)}
                onBlur={() => {
                  const s = normalizeInstructionsSettings({
                    assistantRoleTemplate,
                    soulMdRefreshSystemPrompt,
                    skillsCreateUpdateInstruction,
                  });
                  setSkillsCreateUpdateInstruction(s.skillsCreateUpdateInstruction);
                }}
              />
            </div>
          </div>
        </>
      ) : (
        <BuiltinHardcodedPromptsPanel lang={lang} />
      )}
    </div>
  );
}

function BuiltinHardcodedPromptsPanel({ lang }: { lang: UiLang }) {
  const entries = listHardcodedSystemPrompts();
  if (!entries.length) {
    return (
      <div className="settings-card settings-card-squad">
        <div className="settings-hint">{t(lang, 'instructionsBuiltinEmpty')}</div>
      </div>
    );
  }
  return (
    <div>
      <div className="settings-hint" style={{ marginBottom: 12 }} data-settings-id="instructionsBuiltinHint">
        {t(lang, 'instructionsBuiltinHint')}
      </div>
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="settings-card settings-card-squad"
          style={{ marginBottom: 12 }}
          data-settings-id={entry.id}
        >
          <div className="settings-row settings-row-stack">
            <span className="settings-row-label">
              <span className="settings-row-label-text">
                {lang === 'zh' ? entry.titleZh : entry.titleEn}
              </span>
              <SettingsHelpTip text={lang === 'zh' ? entry.hintZh : entry.hintEn} />
            </span>
            <div className="settings-hint" style={{ marginBottom: 6 }}>
              {t(lang, 'hardcodedPromptSource')}: packages/agent/src/{entry.source}
            </div>
            <textarea
              className="settings-paths-textarea"
              spellCheck={false}
              rows={Math.min(18, Math.max(4, entry.body.split('\n').length + 1))}
              value={entry.body}
              readOnly
            />
          </div>
        </div>
      ))}
    </div>
  );
}
