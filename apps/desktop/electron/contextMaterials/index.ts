/**
 * Context materials module (desktop).
 *
 * Owns the lifecycle boundary for:
 * - AGENTS.md / skills / memories / roster description silent refresh (throttled)
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
  dedupeMemoryFacts,
  extractDurableFacts,
  formatCappedMemoriesForPrompt,
  MEMORY_PROMPT_MAX_CHARS,
  MEMORY_PROMPT_MAX_ENTRIES,
  type MemoryPromptRow,
} from './apply';
