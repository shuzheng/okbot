/**
 * Apply post-turn context-material upserts (memories / AGENTS / skills).
 * Behavior-preserving move of chatMaintenance surface under contextMaterials.
 */
export {
  upsertBotMemoriesFromEntries,
  rememberSummaryFacts,
  extractMemoriesFromFoldedHistory,
  runThrottledPostTurnMaintenance,
  runThrottledPostTurnSquadDescriptionRefresh,
  seedBotDescriptionAfterOnboarding,
  didOwnerNameChange,
  refreshOwnerDescriptionAfterRename,
  markPendingDescriptionAfterOnboardingSkip,
  hasPendingDescriptionAfterOnboardingSkip,
  clearPendingDescriptionAfterOnboardingSkip,
  resetPendingDescriptionAfterOnboardingSkipForTests,
} from '../ipc/chatMaintenance';

export {
  dedupeMemoryFacts,
  extractDurableFacts,
} from '../storage/durableFacts';

export {
  formatCappedMemoriesForPrompt,
  MEMORY_PROMPT_MAX_CHARS,
  MEMORY_PROMPT_MAX_ENTRIES,
  type MemoryPromptRow,
} from '../storage/memoryPrompt';
