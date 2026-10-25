/**
 * Single scheduling touchpoint for AGENTS / skills / memory refresh cadence.
 * Memory always runs post-turn (LLM decides writes); SOUL/skills stay throttled.
 * Re-exports maintenanceSchedule; call sites should import from here.
 */
export {
  createMaintenanceCounters,
  getMaintenanceCounters,
  planPostTurnMaintenance,
  resetMaintenanceCountersForTests,
  userAskedToRemember,
  type MaintenanceCounters,
  type MaintenanceKind,
  type MaintenancePlan,
} from '../storage/maintenanceSchedule';
