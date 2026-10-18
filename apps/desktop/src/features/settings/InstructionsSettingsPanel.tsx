import {
  normalizeInstructionsSettings,
  normalizeSquadSettings,
  normalizeMemorySettings,
  type AppSettings,
} from '@okbot/shared';
import { SettingsHelpTip } from './SettingsHelpTip';
import { keptNumber } from './settingsHelpers';

import { t, type UiLang } from '../../i18n';

export function InstructionsSettingsPanel({
  lang,
  soulMdRecentMessageLimit,
  soulMdRefreshSystemPrompt,
  assistantRoleTemplate,
  captainMaxTurns,
  captainPersona,
  instructionsSubTab,
  memberMaxTurns,
  memoryRecentMessageLimit,
  scopeInstruction,
  setSoulMdRecentMessageLimit,
  setSoulMdRefreshSystemPrompt,
  setAssistantRoleTemplate,
  setCaptainMaxTurns,
  setCaptainPersona,
  setInstructionsSubTab,
  setMemberMaxTurns,
  setMemoryRecentMessageLimit,
  setScopeInstruction,
  setSkillsCreateUpdateInstruction,
  setSkillsRecentMessageLimit,
  setSquadPlaybook,
  skillsCreateUpdateInstruction,
  skillsRecentMessageLimit,
  squadPlaybook,
  tab: _tab,
  settings,
}: {
  settings: AppSettings;
  lang: UiLang;
  soulMdRecentMessageLimit: any;
  soulMdRefreshSystemPrompt: any;
  assistantRoleTemplate: any;
  captainMaxTurns: any;
  captainPersona: any;
  instructionsSubTab: any;
  memberMaxTurns: any;
  memoryRecentMessageLimit: any;
  scopeInstruction: any;
  setSoulMdRecentMessageLimit: React.Dispatch<React.SetStateAction<any>>;
  setSoulMdRefreshSystemPrompt: React.Dispatch<React.SetStateAction<any>>;
  setAssistantRoleTemplate: React.Dispatch<React.SetStateAction<any>>;
  setCaptainMaxTurns: React.Dispatch<React.SetStateAction<any>>;
  setCaptainPersona: React.Dispatch<React.SetStateAction<any>>;
  setInstructionsSubTab: React.Dispatch<React.SetStateAction<any>>;
  setMemberMaxTurns: React.Dispatch<React.SetStateAction<any>>;
  setMemoryRecentMessageLimit: React.Dispatch<React.SetStateAction<any>>;
  setScopeInstruction: React.Dispatch<React.SetStateAction<any>>;
  setSkillsCreateUpdateInstruction: React.Dispatch<React.SetStateAction<any>>;
  setSkillsRecentMessageLimit: React.Dispatch<React.SetStateAction<any>>;
  setSquadPlaybook: React.Dispatch<React.SetStateAction<any>>;
  skillsCreateUpdateInstruction: any;
  skillsRecentMessageLimit: any;
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
          <div className="settings-section-label" data-settings-id="assistantRoleTemplate">
            {t(lang, 'instructionsAssistant')}
          </div>
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
                    soulMdRecentMessageLimit: keptNumber(soulMdRecentMessageLimit, normalizeInstructionsSettings(settings.instructions).soulMdRecentMessageLimit),
                    skillsCreateUpdateInstruction,
                    skillsRecentMessageLimit: keptNumber(skillsRecentMessageLimit, normalizeInstructionsSettings(settings.instructions).skillsRecentMessageLimit),
                  });
                  setAssistantRoleTemplate(s.assistantRoleTemplate);
                }}
              />
            </div>
          </div>
        </>
      ) : instructionsSubTab === 'squad' ? (
        <>
          <div className="settings-section-label" data-settings-id="squadCaptainPersona">
            {t(lang, 'squadSettingsTitle')}
          </div>
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
                    captainMaxTurns: keptNumber(captainMaxTurns, normalizeSquadSettings(settings.squad).captainMaxTurns),
                    memberMaxTurns: keptNumber(memberMaxTurns, normalizeSquadSettings(settings.squad).memberMaxTurns),
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
                    captainMaxTurns: keptNumber(captainMaxTurns, normalizeSquadSettings(settings.squad).captainMaxTurns),
                    memberMaxTurns: keptNumber(memberMaxTurns, normalizeSquadSettings(settings.squad).memberMaxTurns),
                  });
                  setSquadPlaybook(s.playbook);
                }}
              />
            </div>
            <div className="settings-row" data-settings-id="squadCaptainMaxTurns">
              <span className="settings-row-label">
                <span className="settings-row-label-text">
                  {t(lang, 'squadCaptainMaxTurns')}
                </span>
                <SettingsHelpTip text={t(lang, 'squadCaptainMaxTurnsHint')} />
              </span>
              <input
                spellCheck={false}
                className="wide"
                type="number"
                min={1}
                max={100}
                step={1}
                value={captainMaxTurns}
                onChange={(e) => setCaptainMaxTurns(e.target.value)}
                onBlur={() => {
                  const s = normalizeSquadSettings({
                    captainPersona,
                    playbook: squadPlaybook,
                    captainMaxTurns: keptNumber(captainMaxTurns, normalizeSquadSettings(settings.squad).captainMaxTurns),
                    memberMaxTurns: keptNumber(memberMaxTurns, normalizeSquadSettings(settings.squad).memberMaxTurns),
                  });
                  setCaptainMaxTurns(String(s.captainMaxTurns));
                }}
              />
            </div>
            <div className="settings-row" data-settings-id="squadMemberMaxTurns">
              <span className="settings-row-label">
                <span className="settings-row-label-text">
                  {t(lang, 'squadMemberMaxTurns')}
                </span>
                <SettingsHelpTip text={t(lang, 'squadMemberMaxTurnsHint')} />
              </span>
              <input
                spellCheck={false}
                className="wide"
                type="number"
                min={1}
                max={100}
                step={1}
                value={memberMaxTurns}
                onChange={(e) => setMemberMaxTurns(e.target.value)}
                onBlur={() => {
                  const s = normalizeSquadSettings({
                    captainPersona,
                    playbook: squadPlaybook,
                    captainMaxTurns: keptNumber(captainMaxTurns, normalizeSquadSettings(settings.squad).captainMaxTurns),
                    memberMaxTurns: keptNumber(memberMaxTurns, normalizeSquadSettings(settings.squad).memberMaxTurns),
                  });
                  setMemberMaxTurns(String(s.memberMaxTurns));
                }}
              />
            </div>
          </div>
        </>
      ) : instructionsSubTab === 'soul' ? (
        <>
          <div
            className="settings-section-label"
            data-settings-id="soulMdRefreshSystemPrompt"
          >
            {t(lang, 'instructionsAgents')}
          </div>
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
                    soulMdRecentMessageLimit: keptNumber(soulMdRecentMessageLimit, normalizeInstructionsSettings(settings.instructions).soulMdRecentMessageLimit),
                    skillsCreateUpdateInstruction,
                    skillsRecentMessageLimit: keptNumber(skillsRecentMessageLimit, normalizeInstructionsSettings(settings.instructions).skillsRecentMessageLimit),
                  });
                  setSoulMdRefreshSystemPrompt(s.soulMdRefreshSystemPrompt);
                }}
              />
            </div>
            <div className="settings-row" data-settings-id="soulMdRecentMessageLimit">
              <span className="settings-row-label">
                <span className="settings-row-label-text">
                  {t(lang, 'soulMdRecentMessageLimit')}
                </span>
                <SettingsHelpTip text={t(lang, 'soulMdRecentMessageLimitHint')} />
              </span>
              <input
                spellCheck={false}
                className="wide"
                type="number"
                min={1}
                max={100}
                step={1}
                value={soulMdRecentMessageLimit}
                onChange={(e) => setSoulMdRecentMessageLimit(e.target.value)}
                onBlur={() => {
                  const s = normalizeInstructionsSettings({
                    assistantRoleTemplate,
                    soulMdRefreshSystemPrompt,
                    soulMdRecentMessageLimit: keptNumber(soulMdRecentMessageLimit, normalizeInstructionsSettings(settings.instructions).soulMdRecentMessageLimit),
                    skillsCreateUpdateInstruction,
                    skillsRecentMessageLimit: keptNumber(skillsRecentMessageLimit, normalizeInstructionsSettings(settings.instructions).skillsRecentMessageLimit),
                  });
                  setSoulMdRecentMessageLimit(String(s.soulMdRecentMessageLimit));
                }}
              />
            </div>
          </div>
        </>
      ) : instructionsSubTab === 'memory' ? (
        <>
          <div className="settings-section-label" data-settings-id="scopeInstruction">
            {t(lang, 'instructionsMemory')}
          </div>
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
                    recentMessageLimit: keptNumber(memoryRecentMessageLimit, normalizeMemorySettings(settings.memory).recentMessageLimit),
                  });
                  setScopeInstruction(s.scopeInstruction);
                }}
              />
            </div>
            <div className="settings-row" data-settings-id="memoryRecentMessageLimit">
              <span className="settings-row-label">
                <span className="settings-row-label-text">
                  {t(lang, 'memoryRecentMessageLimit')}
                </span>
                <SettingsHelpTip text={t(lang, 'memoryRecentMessageLimitHint')} />
              </span>
              <input
                spellCheck={false}
                className="wide"
                type="number"
                min={1}
                max={100}
                step={1}
                value={memoryRecentMessageLimit}
                onChange={(e) => setMemoryRecentMessageLimit(e.target.value)}
                onBlur={() => {
                  const s = normalizeMemorySettings({
                    scopeInstruction,
                    recentMessageLimit: keptNumber(memoryRecentMessageLimit, normalizeMemorySettings(settings.memory).recentMessageLimit),
                  });
                  setMemoryRecentMessageLimit(String(s.recentMessageLimit));
                }}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <div
            className="settings-section-label"
            data-settings-id="skillsCreateUpdateInstruction"
          >
            {t(lang, 'instructionsSkills')}
          </div>
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
                    soulMdRecentMessageLimit: keptNumber(soulMdRecentMessageLimit, normalizeInstructionsSettings(settings.instructions).soulMdRecentMessageLimit),
                    skillsCreateUpdateInstruction,
                    skillsRecentMessageLimit: keptNumber(skillsRecentMessageLimit, normalizeInstructionsSettings(settings.instructions).skillsRecentMessageLimit),
                  });
                  setSkillsCreateUpdateInstruction(s.skillsCreateUpdateInstruction);
                }}
              />
            </div>
            <div className="settings-row" data-settings-id="skillsRecentMessageLimit">
              <span className="settings-row-label">
                <span className="settings-row-label-text">
                  {t(lang, 'skillsRecentMessageLimit')}
                </span>
                <SettingsHelpTip text={t(lang, 'skillsRecentMessageLimitHint')} />
              </span>
              <input
                spellCheck={false}
                className="wide"
                type="number"
                min={1}
                max={100}
                step={1}
                value={skillsRecentMessageLimit}
                onChange={(e) => setSkillsRecentMessageLimit(e.target.value)}
                onBlur={() => {
                  const s = normalizeInstructionsSettings({
                    assistantRoleTemplate,
                    soulMdRefreshSystemPrompt,
                    soulMdRecentMessageLimit: keptNumber(soulMdRecentMessageLimit, normalizeInstructionsSettings(settings.instructions).soulMdRecentMessageLimit),
                    skillsCreateUpdateInstruction,
                    skillsRecentMessageLimit: keptNumber(skillsRecentMessageLimit, normalizeInstructionsSettings(settings.instructions).skillsRecentMessageLimit),
                  });
                  setSkillsRecentMessageLimit(String(s.skillsRecentMessageLimit));
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
