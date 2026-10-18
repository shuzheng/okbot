/**
 * Apply post-turn / compress-time memory upserts and decide silent refresh gates.
 * Public entry: `electron/contextMaterials` (single scheduling touchpoint).
 */
import {
  createId,
  resolveModelConfig,
  type BotOnboardingAnswers,
  type ChatMessage,
  type MemoryEntry,
  type ResolvedModelConfig,
} from '@okbot/shared';
import { refreshSoulMd, refreshBotSkills, refreshMemories, refreshOwnerDescription, type OwnerDescriptionRefreshResult } from '@okbot/agent';
import { withOwnerMaintenanceLock } from './ownerRuns';
import type { FileStorage } from '../storage/FileStorage';
import { dedupeMemoryFacts, extractDurableFacts } from '../storage/durableFacts';
import {
  getMaintenanceCounters,
  planPostTurnMaintenance,
} from '../storage/maintenanceSchedule';

export function upsertBotMemoriesFromEntries(
  storage: FileStorage,
  botId: string,
  entries: Array<{ memory: string; expires: string | null; scope: 'global' | 'bot' }>,
): void {
  if (!entries.length) return;
  const summaryFacts = extractDurableFacts(storage.readSessionSummary(botId)?.summary || '');
  const existing = [
    ...storage.listGlobalMemories().map((e) => e.memory),
    ...storage.listBotMemories(botId).map((e) => e.memory),
    ...summaryFacts,
  ];
  const fresh = new Set(dedupeMemoryFacts(entries.map((e) => e.memory), existing));
  for (const e of entries) {
    if (!fresh.has(e.memory.trim())) continue;
    storage.upsertMemory(e.scope, {
      id: createId('mem'),
      bot_id: botId,
      memory: e.memory,
      expires: e.expires,
    } satisfies MemoryEntry);
  }
}

export function rememberSummaryFacts(storage: FileStorage, botId: string, facts: string[]): void {
  if (!facts.length) return;
  const existing = [
    ...storage.listGlobalMemories().map((e) => e.memory),
    ...storage.listBotMemories(botId).map((e) => e.memory),
  ];
  for (const fact of dedupeMemoryFacts(facts, existing)) {
    storage.upsertMemory('bot', {
      id: createId('mem'),
      bot_id: botId,
      memory: fact,
      expires: null,
    });
  }
}

export async function extractMemoriesFromFoldedHistory(input: {
  storage: FileStorage;
  botId: string;
  botName: string;
  model: ResolvedModelConfig;
  deltaMessages: ChatMessage[];
  signal?: AbortSignal;
}): Promise<void> {
  if (input.signal?.aborted) return;
  const settings = input.storage.getSettings();
  const delta = input.deltaMessages.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (!delta.length) return;
  const memResult = await refreshMemories({
    model: input.model,
    botId: input.botId,
    botName: input.botName,
    existingGlobal: input.storage.listGlobalMemories(),
    existingBot: input.storage.listBotMemories(input.botId),
    recentMessages: delta,
    scopeInstruction: settings.memory.scopeInstruction,
    recentMessageLimit: Math.min(
      settings.memory.recentMessageLimit,
      Math.max(delta.length, 1),
    ),
    signal: input.signal,
  });
  if (memResult.action === 'upsert') {
    upsertBotMemoriesFromEntries(input.storage, input.botId, memResult.entries);
  }
}

/**
 * After an onboarding_skip greeting turn, the next real (non-quiet) user reply
 * should evolve roster description from the duty/collab Q&A — do not wait for
 * the normal SOUL throttle (soulEveryTurns default 5).
 */
const pendingDescriptionAfterOnboardingSkip = new Set<string>();

/** Mark bot after a successful onboarding_skip turn. */
export function markPendingDescriptionAfterOnboardingSkip(botId: string): void {
  const id = (botId || '').trim();
  if (id) pendingDescriptionAfterOnboardingSkip.add(id);
}

/** True when a post-skip real reply should force description refresh. */
export function hasPendingDescriptionAfterOnboardingSkip(botId: string): boolean {
  return pendingDescriptionAfterOnboardingSkip.has((botId || '').trim());
}

/** Clear the post-skip pending flag (after forced refresh attempt). */
export function clearPendingDescriptionAfterOnboardingSkip(botId: string): void {
  pendingDescriptionAfterOnboardingSkip.delete((botId || '').trim());
}

/** Test seam. */
export function resetPendingDescriptionAfterOnboardingSkipForTests(): void {
  pendingDescriptionAfterOnboardingSkip.clear();
}

export async function runThrottledPostTurnMaintenance(input: {
  storage: FileStorage;
  botId: string;
  botName: string;
  model: ResolvedModelConfig;
  soulMd: string;
  userText: string;
  signal?: AbortSignal;
  /**
   * Bypass SOUL throttle for roster description only (post onboarding_skip Q&A).
   * Does not force SOUL.md / skills / memory refreshes.
   */
  forceDescription?: boolean;
}): Promise<void> {
  if (input.signal?.aborted) return;
  const settings = input.storage.getSettings();
  const plan = planPostTurnMaintenance({
    settings: settings.maintenance,
    counters: getMaintenanceCounters(input.botId),
    userText: input.userText,
  });
  const forceDescription = input.forceDescription === true;
  if (!plan.runMemory && !plan.runSoul && !plan.runSkills && !forceDescription) return;

  const agentsLimit = settings.instructions.soulMdRecentMessageLimit;
  const skillsLimit = settings.instructions.skillsRecentMessageLimit;
  const memoryLimit = settings.memory.recentMessageLimit;
  const recent = input.storage.getMessagesPage(input.botId, {
    limit: Math.max(agentsLimit, skillsLimit, memoryLimit),
  }).messages;

  if (plan.runSoul) {
    const nextMd = await refreshSoulMd({
      model: input.model,
      botName: input.botName,
      currentSoulMd: input.soulMd,
      recentMessages: recent,
      systemPrompt: settings.instructions.soulMdRefreshSystemPrompt,
      recentMessageLimit: agentsLimit,
      signal: input.signal,
    });
    if (nextMd) input.storage.writeSoulMd(input.botId, nextMd);
  }

  // Same cadence as SOUL.md, or forced after onboarding_skip duty/collab Q&A.
  if (plan.runSoul || forceDescription) {
    const bot = input.storage.listBots().find((b) => b.id === input.botId);
    const descResult = await refreshOwnerDescription({
      model: input.model,
      ownerKind: 'bot',
      ownerName: input.botName,
      currentDescription: bot?.description || '',
      recentMessages: recent,
      recentMessageLimit: agentsLimit,
      signal: input.signal,
    });
    if (descResult.action === 'upsert') {
      input.storage.updateBot(input.botId, { description: descResult.description });
    }
  }

  if (plan.runSkills) {
    const skillResult = await refreshBotSkills({
      model: input.model,
      botName: input.botName,
      existingSkills: input.storage.listSkills(input.botId),
      recentMessages: recent,
      createUpdateInstruction: settings.instructions.skillsCreateUpdateInstruction,
      recentMessageLimit: skillsLimit,
      signal: input.signal,
    });
    if (skillResult.action === 'upsert') {
      input.storage.writeSkill(input.botId, skillResult.skill);
    }
  }

  if (plan.runMemory) {
    const memResult = await refreshMemories({
      model: input.model,
      botId: input.botId,
      botName: input.botName,
      existingGlobal: input.storage.listGlobalMemories(),
      existingBot: input.storage.listBotMemories(input.botId),
      recentMessages: recent,
      scopeInstruction: settings.memory.scopeInstruction,
      recentMessageLimit: memoryLimit,
      signal: input.signal,
    });
    if (memResult.action === 'upsert') {
      upsertBotMemoriesFromEntries(input.storage, input.botId, memResult.entries);
    }
  }
}

/**
 * Squad post-turn: only roster description (SOUL cadence). No SOUL/skills/memory for squad.
 */
export async function runThrottledPostTurnSquadDescriptionRefresh(input: {
  storage: FileStorage;
  squadId: string;
  squadName: string;
  currentDescription: string;
  model: ResolvedModelConfig;
  userText: string;
  signal?: AbortSignal;
}): Promise<void> {
  if (input.signal?.aborted) return;
  const settings = input.storage.getSettings();
  const plan = planPostTurnMaintenance({
    settings: settings.maintenance,
    counters: getMaintenanceCounters(input.squadId),
    userText: input.userText,
  });
  // Reuse SOUL throttle for squad description evolution.
  if (!plan.runSoul) return;

  const agentsLimit = settings.instructions.soulMdRecentMessageLimit;
  const recent = input.storage.getMessagesPage(input.squadId, {
    limit: agentsLimit,
  }).messages;
  const descResult = await refreshOwnerDescription({
    model: input.model,
    ownerKind: 'squad',
    ownerName: input.squadName,
    currentDescription: input.currentDescription,
    recentMessages: recent,
    recentMessageLimit: agentsLimit,
    signal: input.signal,
  });
  if (descResult.action === 'upsert') {
    input.storage.updateSquad(input.squadId, { description: descResult.description });
  }
}

/**
 * Right after finishBotOnboarding: one description seed from name + answers + SOUL,
 * persisted to bots.json. Does not wait for the SOUL turn throttle.
 * Fire-and-forget from IPC; errors are logged, never thrown to UI.
 */
export async function seedBotDescriptionAfterOnboarding(input: {
  storage: FileStorage;
  botId: string;
  answers?: BotOnboardingAnswers;
  signal?: AbortSignal;
}): Promise<void> {
  const botId = (input.botId || '').trim();
  if (!botId) return;
  await withOwnerMaintenanceLock(botId, async () => {
    if (input.signal?.aborted) return;
    const bot = input.storage.listBots().find((b) => b.id === botId);
    if (!bot) return;
    const model = resolveModelConfig(input.storage.getSettings().model, {
      providerId: bot.providerId,
      modelId: bot.modelId,
    });
    const answers = input.answers || {};
    const soulMd = input.storage.readSoulMd(botId);
    let descResult: OwnerDescriptionRefreshResult;
    try {
      descResult = await refreshOwnerDescription({
        model,
        ownerKind: 'bot',
        ownerName: bot.name,
        currentDescription: bot.description || '',
        recentMessages: [],
        seed: {
          scenarioLabel: answers.scenarioLabel,
          howLabel: answers.howLabel,
          soulMd,
        },
        signal: input.signal,
      });
    } catch {
      // Missing model / network — leave description empty until post-turn refresh.
      return;
    }
    if (descResult.action === 'upsert') {
      // Re-check bot still exists (user may have deleted during the LLM call).
      if (!input.storage.listBots().some((b) => b.id === botId)) return;
      input.storage.updateBot(botId, { description: descResult.description });
    }
  });
}


/**
 * True when patch.name is a string whose trimmed value differs from prev
 * (empty/whitespace patch keeps prev — same as RosterStore.updateBot/Squad).
 */
export function didOwnerNameChange(prevName: string, patchName: unknown): boolean {
  if (typeof patchName !== 'string') return false;
  const prev = (prevName || '').trim();
  const next = patchName.trim() || prev;
  return next !== prev;
}

/**
 * After a bot/squad rename: refresh roster description from the new name +
 * current description + recent messages (SOUL seed when desc empty for bots).
 * Not gated by post-turn SOUL throttle — fire-and-forget from update IPC.
 * Errors are logged; deleted owners are ignored mid-flight.
 */
export async function refreshOwnerDescriptionAfterRename(input: {
  storage: FileStorage;
  ownerKind: 'bot' | 'squad';
  ownerId: string;
  signal?: AbortSignal;
}): Promise<void> {
  const ownerId = (input.ownerId || '').trim();
  if (!ownerId) return;
  await withOwnerMaintenanceLock(ownerId, async () => {
    if (input.signal?.aborted) return;

    if (input.ownerKind === 'bot') {
      const bot = input.storage.listBots().find((b) => b.id === ownerId);
      if (!bot) return;
      const model = resolveModelConfig(input.storage.getSettings().model, {
        providerId: bot.providerId,
        modelId: bot.modelId,
      });
      const settings = input.storage.getSettings();
      const agentsLimit = settings.instructions.soulMdRecentMessageLimit;
      const recent = input.storage.getMessagesPage(ownerId, { limit: agentsLimit }).messages;
      const currentDescription = bot.description || '';
      const seed =
        !currentDescription.trim()
          ? { soulMd: input.storage.readSoulMd(ownerId) }
          : { scenarioLabel: '名称已更新' };
      let descResult: OwnerDescriptionRefreshResult;
      try {
        descResult = await refreshOwnerDescription({
          model,
          ownerKind: 'bot',
          ownerName: bot.name,
          currentDescription,
          recentMessages: recent,
          recentMessageLimit: agentsLimit,
          seed,
          signal: input.signal,
        });
      } catch (err) {
        console.error('[okbot] rename description refresh failed', ownerId, err);
        return;
      }
      if (descResult.action !== 'upsert') return;
      if (!input.storage.listBots().some((b) => b.id === ownerId)) return;
      input.storage.updateBot(ownerId, { description: descResult.description });
      return;
    }

    const squad = input.storage.listSquads().find((s) => s.id === ownerId);
    if (!squad) return;
    const model = resolveModelConfig(input.storage.getSettings().model, {
      providerId: squad.providerId,
      modelId: squad.modelId,
    });
    const settings = input.storage.getSettings();
    const agentsLimit = settings.instructions.soulMdRecentMessageLimit;
    const recent = input.storage.getMessagesPage(ownerId, { limit: agentsLimit }).messages;
    const currentDescription = squad.description || '';
    const seed = {
      scenarioLabel: '名称已更新',
    };
    let descResult: OwnerDescriptionRefreshResult;
    try {
      descResult = await refreshOwnerDescription({
        model,
        ownerKind: 'squad',
        ownerName: squad.name,
        currentDescription,
        recentMessages: recent,
        recentMessageLimit: agentsLimit,
        seed,
        signal: input.signal,
      });
    } catch (err) {
      console.error('[okbot] rename description refresh failed', ownerId, err);
      return;
    }
    if (descResult.action !== 'upsert') return;
    if (!input.storage.listSquads().some((s) => s.id === ownerId)) return;
    input.storage.updateSquad(ownerId, { description: descResult.description });
  });
}
