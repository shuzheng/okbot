/**
 * Common lifecycle for AGENTS.md / skills / memories / session summary / durable facts.
 * Desktop scheduling + disk write stay in apps/desktop/electron/contextMaterials.
 */
export type ContextMaterialKind =
  | 'agentsMd'
  | 'skills'
  | 'memories'
  | 'sessionSummary'
  | 'durableFacts';

export type ContextMaterialCadence = {
  /** Run after this many successful turns (per owner). */
  everyTurns: number;
  /** Or after this many user chars accumulated (per owner). */
  everyUserChars: number;
};

/**
 * Read / format / refresh / cadence — callers wire storage + model.
 * Implementations may no-op refresh when unchanged.
 */
export type ContextMaterial<TRead = string, TRefresh = unknown> = {
  kind: ContextMaterialKind;
  /** Load current material for an owner (bot or squad where applicable). */
  read: (ownerId: string) => TRead;
  /** Format for system prompt injection (may return empty). */
  format: (ownerId: string) => string;
  /**
   * Optional silent refresh from recent dialogue.
   * Returns null / none when unchanged; caller persists.
   */
  refresh?: (input: TRefresh) => Promise<unknown>;
  /** Optional throttle hints; desktop maintenanceSchedule is the single scheduler. */
  cadence?: ContextMaterialCadence;
};
