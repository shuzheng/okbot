/**
 * Context materials module (desktop).
 *
 * Owns the lifecycle boundary for:
 * - SOUL.md / skills / memories / roster description silent refresh (throttled)
 * - post-onboarding roster description seed (immediate, no turn throttle)
 * - post-rename roster description refresh (immediate, no turn throttle)
 * - session summary durable-fact extraction
 * - memory prompt capping
 *
 * Agent package provides refresh/format primitives; this module is the
 * single scheduling + apply touchpoint for desktop call sites.
 */
export type {
  ContextMaterial,
  ContextMaterialCadence,
  ContextMaterialKind,
} from './types';
export { SCHEDULED_CONTEXT_MATERIALS } from './types';

export {
  createMaintenanceCounters,
  getMaintenanceCounters,
  planPostTurnMaintenance,
  resetMaintenanceCountersForTests,
  userAskedToRemember,
  type MaintenanceCounters,
  type MaintenanceKind,
  type MaintenancePlan,
} from './schedule';

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
  dedupeMemoryFacts,
  extractDurableFacts,
  formatCappedMemoriesForPrompt,
  MEMORY_PROMPT_MAX_CHARS,
  MEMORY_PROMPT_MAX_ENTRIES,
  type MemoryPromptRow,
} from './apply';
