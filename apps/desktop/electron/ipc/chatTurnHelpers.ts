import type { Squad } from '@okbot/shared';
import type { ComputerRoute, SkillLookup, SquadMemberAgentSpec } from '@okbot/agent';
import type { IpcContext } from './context';

/** Bind `read_skill` to this bot's local + enabled-global skills. */
export function skillLookupFor(storage: IpcContext['storage'], botId: string): SkillLookup {
  return (slug) => {
    const hit = storage.resolveEnabledSkill(botId, slug);
    if (!hit) return null;
    return {
      slug: hit.slug,
      name: hit.name,
      description: hit.description,
      body: hit.body,
      global: hit.source === 'global',
    };
  };
}

export function computerRouteFor(
  settings: { defaultComputerId?: string; computers?: ComputerRoute['computers'] },
  userText?: string,
  turnComputerId?: string,
): ComputerRoute {
  return {
    defaultComputerId: settings.defaultComputerId,
    turnComputerId,
    computers: settings.computers,
    userText,
  };
}

/** Member specs for a squad run (live turn and cold resume share this). Throws on a missing member. */
export function buildSquadMemberSpecs(
  storage: IpcContext['storage'],
  squad: Pick<Squad, 'members'>,
): SquadMemberAgentSpec[] {
  const byId = new Map(storage.listBots().map((b) => [b.id, b]));
  return squad.members.map((m) => {
    const bot = byId.get(m.botId);
    if (!bot) throw new Error(`成员不存在：${m.botId}`);
    return {
      botId: bot.id,
      name: bot.name,
      description: bot.description,
      role: m.role,
      agentsMd: storage.readAgentsMd(bot.id),
      skillsText: storage.formatSkillsForPrompt(bot.id),
      skillLookup: skillLookupFor(storage, bot.id),
      memoriesText: storage.formatMemoriesForPrompt(bot.id),
    };
  });
}
