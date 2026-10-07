/**
 * Apply post-turn / compress-time memory upserts and decide silent refresh gates.
 */
import { createId, type ChatMessage, type MemoryEntry, type ResolvedModelConfig } from '@okbot/shared';
import { refreshAgentsMd, refreshBotSkills, refreshMemories } from '@okbot/agent';
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

export async function runThrottledPostTurnMaintenance(input: {
  storage: FileStorage;
  botId: string;
  botName: string;
  model: ResolvedModelConfig;
  agentsMd: string;
  userText: string;
  signal?: AbortSignal;
}): Promise<void> {
  if (input.signal?.aborted) return;
  const settings = input.storage.getSettings();
  const plan = planPostTurnMaintenance({
    settings: settings.maintenance,
    counters: getMaintenanceCounters(input.botId),
    userText: input.userText,
  });
  if (!plan.runMemory && !plan.runAgents && !plan.runSkills) return;

  const agentsLimit = settings.instructions.agentsMdRecentMessageLimit;
  const skillsLimit = settings.instructions.skillsRecentMessageLimit;
  const memoryLimit = settings.memory.recentMessageLimit;
  const recent = input.storage.getMessagesPage(input.botId, {
    limit: Math.max(agentsLimit, skillsLimit, memoryLimit),
  }).messages;

  if (plan.runAgents) {
    const nextMd = await refreshAgentsMd({
      model: input.model,
      botName: input.botName,
      currentAgentsMd: input.agentsMd,
      recentMessages: recent,
      systemPrompt: settings.instructions.agentsMdRefreshSystemPrompt,
      recentMessageLimit: agentsLimit,
      signal: input.signal,
    });
    if (nextMd) input.storage.writeAgentsMd(input.botId, nextMd);
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
