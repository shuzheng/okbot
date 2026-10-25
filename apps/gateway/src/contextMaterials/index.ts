/**
 * Context materials module (desktop).
 *
 * Owns the lifecycle boundary for:
 * - SOUL.md / skills / memories / roster description silent refresh (throttled)
 * - post-rename roster description refresh (immediate, no turn throttle)
 * - compress-time folded-history LLM memory extraction
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
  extractMemoriesFromFoldedHistory,
  runThrottledPostTurnMaintenance,
  runThrottledPostTurnSquadDescriptionRefresh,
  didOwnerNameChange,
  refreshOwnerDescriptionAfterRename,
  dedupeMemoryFacts,
  extractDurableFacts,
  formatCappedMemoriesForPrompt,
  MEMORY_PROMPT_MAX_CHARS,
  MEMORY_PROMPT_MAX_ENTRIES,
  type MemoryPromptRow,
} from './apply';
