/**
 * Apply post-turn / compress-time memory upserts and decide silent refresh gates.
 * Public entry: `electron/contextMaterials` (single scheduling touchpoint).
 *
 * Memory writes trust the LLM list (no turn/char gate or containment dedupe).
 * Compression-time folded-history extraction still goes through refreshMemories.
 */
import {
  createId,
  resolveModelConfig,
  type ChatMessage,
  type MemoryEntry,
  type ResolvedModelConfig,
} from '@okbot/shared';
import { refreshSoulMd, refreshBotSkills, refreshMemories, refreshOwnerDescription, type OwnerDescriptionRefreshResult } from '@okbot/agent';
import { withOwnerMaintenanceLock } from './ownerRuns';
import type { FileStorage } from '../storage/FileStorage';
import {
  getMaintenanceCounters,
  planPostTurnMaintenance,
} from '../storage/maintenanceSchedule';
import { consolidateMemoriesForBot } from '../storage/memoryConsolidate';
import { desensitizeMemoryText } from '@okbot/shared';
import { userAskedToRemember } from '../storage/maintenanceSchedule';

/**
 * Persist model-chosen memory entries as-is.
 * Dedup / merge / skip / quality belong to the LLM (refreshMemories prompt).
 * Program only skips empty/whitespace (JSONL storage invariant) — no length,
 * UI-label, or tool-name heuristics that second-guess the model.
 */
export function upsertBotMemoriesFromEntries(
  storage: FileStorage,
  botId: string,
  entries: Array<{
    memory: string;
    expires: string | null;
    scope: 'global' | 'bot';
    replaceId?: string;
    /** Phase 1 default candidate; durable when pinned / explicit remember / model says so. */
    tier?: 'candidate' | 'durable';
    pinned?: boolean;
  }>,
  opts?: { preferDurable?: boolean },
): void {
  if (!entries.length) return;
  const preferDurable = opts?.preferDurable === true;
  for (const e of entries) {
    const memory = desensitizeMemoryText(e.memory || '');
    if (!memory) continue;
    const replaceId = (e.replaceId || '').trim();
    const pinned = e.pinned === true;
    let tier: 'candidate' | 'durable' =
      e.tier === 'durable' || e.tier === 'candidate'
        ? e.tier
        : preferDurable || pinned
          ? 'durable'
          : 'candidate';
    if (pinned) tier = 'durable';
    // replaceId → overwrite that row (same id). Otherwise always insert a fresh id.
    const id = replaceId || createId('mem');
    let hits: number | undefined;
    let createdAt: string | undefined;
    if (replaceId) {
      const prev =
        (e.scope === 'global'
          ? storage.listGlobalMemories()
          : storage.listBotMemories(botId)
        ).find((row) => row.id === replaceId);
      if (prev) {
        hits = prev.hits;
        createdAt = prev.createdAt || undefined;
        // Replacing a durable keeps durable unless model demotes via tier=candidate.
        if (e.tier == null && prev.tier !== 'candidate') tier = 'durable';
      }
    }
    storage.upsertMemory(e.scope, {
      id,
      bot_id: botId,
      memory,
      expires: e.expires,
      tier,
      ...(pinned ? { pinned: true } : {}),
      ...(hits != null ? { hits } : { hits: 0 }),
      ...(createdAt ? { createdAt } : { createdAt: new Date().toISOString() }),
    } satisfies MemoryEntry);
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
  // Compress-time: mine the whole folded delta. Do NOT reuse post-turn
  // analysis window `memoryEveryTurns` (default 2) — that would drop most of
  // a large fold. refreshMemories clamps via normalizeMemoryRecentLimit (1–500).
  const memResult = await refreshMemories({
    model: input.model,
    botId: input.botId,
    botName: input.botName,
    existingGlobal: input.storage.listGlobalMemories(),
    existingBot: input.storage.listBotMemories(input.botId),
    recentMessages: delta,
    scopeInstruction: settings.memory.scopeInstruction,
    recentMessageLimit: Math.max(delta.length, 1),
    signal: input.signal,
  });
  if (memResult.action === 'upsert') {
    upsertBotMemoriesFromEntries(input.storage, input.botId, memResult.entries);
  }
  consolidateMemoriesForBot(input.storage, input.botId);
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
   * Bypass the SOUL throttle: refresh SOUL.md + roster description this turn
   * (every step of new-assistant onboarding). Memory always runs; skills keep their cadence.
   */
  forceSoul?: boolean;
}): Promise<void> {
  if (input.signal?.aborted) return;
  const settings = input.storage.getSettings();
  const plan = planPostTurnMaintenance({
    settings: settings.maintenance,
    counters: getMaintenanceCounters(input.botId),
    userText: input.userText,
  });
  const runSoul = plan.runSoul || input.forceSoul === true;
  if (!plan.runMemory && !runSoul && !plan.runSkills) return;

  const agentsLimit = settings.maintenance.soulEveryTurns;
  const skillsLimit = settings.maintenance.skillsEveryTurns;
  const memoryLimit = settings.maintenance.memoryEveryTurns;
  const recent = input.storage.getMessagesPage(input.botId, {
    limit: Math.max(agentsLimit, skillsLimit, memoryLimit),
  }).messages;

  if (runSoul) {
    const nextMd = await refreshSoulMd({
      model: input.model,
      botName: input.botName,
      // Re-read: onboarding may have saved a fresh SOUL.md during this turn.
      currentSoulMd: input.forceSoul ? input.storage.readSoulMd(input.botId) : input.soulMd,
      recentMessages: recent,
      systemPrompt: settings.instructions.soulMdRefreshSystemPrompt,
      recentMessageLimit: agentsLimit,
      signal: input.signal,
    });
    if (nextMd) input.storage.writeSoulMd(input.botId, nextMd);
  }

  // Same cadence as SOUL.md.
  if (runSoul) {
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
      upsertBotMemoriesFromEntries(input.storage, input.botId, memResult.entries, {
        preferDurable: userAskedToRemember(input.userText),
      });
    }
    consolidateMemoriesForBot(input.storage, input.botId);
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

  const agentsLimit = settings.maintenance.soulEveryTurns;
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
      const agentsLimit = settings.maintenance.soulEveryTurns;
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
    const agentsLimit = settings.maintenance.soulEveryTurns;
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
