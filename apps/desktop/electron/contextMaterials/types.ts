import type { ContextMaterialKind } from '@okbot/agent';

export type { ContextMaterial, ContextMaterialCadence, ContextMaterialKind } from '@okbot/agent';

/** Desktop-owned materials that share planPostTurnMaintenance cadence. */
export const SCHEDULED_CONTEXT_MATERIALS: ContextMaterialKind[] = [
  'agentsMd',
  'skills',
  'memories',
];
