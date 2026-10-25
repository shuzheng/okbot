import {
  normalizeInstructionsSettings,
  normalizeSquadSettings,
  normalizeMemorySettings,
  type AppSettings,
} from '@okbot/shared';
import { SettingsHelpTip } from './SettingsHelpTip';

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
  instructionsSubTab: any;
  scopeInstruction: any;
  setSoulMdRefreshSystemPrompt: React.Dispatch<React.SetStateAction<any>>;
  setAssistantRoleTemplate: React.Dispatch<React.SetStateAction<any>>;
  setCaptainPersona: React.Dispatch<React.SetStateAction<any>>;
  setInstructionsSubTab: React.Dispatch<React.SetStateAction<any>>;
  setScopeInstruction: React.Dispatch<React.SetStateAction<any>>;
  setSkillsCreateUpdateInstruction: React.Dispatch<React.SetStateAction<any>>;
  setSquadPlaybook: React.Dispatch<React.SetStateAction<any>>;
  skillsCreateUpdateInstruction: any;
  squadPlaybook: any;
  tab: any;
}) {
  return (

    <div>
      <div
        className="avatar-kind-toggle instructions-subtab-toggle"
        role="tablist"
        aria-label={t(lang, 'instructions')}
      >
        <button
          type="button"
          role="tab"
          aria-selected={instructionsSubTab === 'assistant'}
          className={instructionsSubTab === 'assistant' ? 'active' : ''}
          onClick={() => setInstructionsSubTab('assistant')}
        >
          {t(lang, 'instructionsAssistant')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={instructionsSubTab === 'squad'}
          className={instructionsSubTab === 'squad' ? 'active' : ''}
          onClick={() => setInstructionsSubTab('squad')}
        >
          {t(lang, 'instructionsSquad')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={instructionsSubTab === 'soul'}
          className={instructionsSubTab === 'soul' ? 'active' : ''}
          onClick={() => setInstructionsSubTab('soul')}
        >
          {t(lang, 'instructionsAgents')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={instructionsSubTab === 'memory'}
          className={instructionsSubTab === 'memory' ? 'active' : ''}
          onClick={() => setInstructionsSubTab('memory')}
        >
          {t(lang, 'instructionsMemory')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={instructionsSubTab === 'skills'}
          className={instructionsSubTab === 'skills' ? 'active' : ''}
          onClick={() => setInstructionsSubTab('skills')}
        >
          {t(lang, 'instructionsSkills')}
        </button>
      </div>

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
      ) : (
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
      )}
    </div>
  );
}
