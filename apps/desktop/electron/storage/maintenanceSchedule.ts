/**
 * Post-turn maintenance throttle: do not refresh AGENTS / skills / memory every turn.
 * Memory runs more often than AGENTS/skills. Explicit "remember" phrases force memory.
 *
 * Heuristic (documented): user text matching 记住 / 别忘了 / remember (word) → run memory now.
 */
import {
  normalizeMaintenanceSettings,
  type MaintenanceSettings,
} from '@okbot/shared';

export type MaintenanceKind = 'memory' | 'agents' | 'skills';

export type MaintenanceCounters = {
  turnsSince: Record<MaintenanceKind, number>;
  charsSince: Record<MaintenanceKind, number>;
};

const KINDS: MaintenanceKind[] = ['memory', 'agents', 'skills'];

/** In-process counters per chat owner (bot or squad). Lost on restart — fail open to a light refresh. */
const counterByOwner = new Map<string, MaintenanceCounters>();

export function createMaintenanceCounters(): MaintenanceCounters {
  return {
    turnsSince: { memory: 0, agents: 0, skills: 0 },
    charsSince: { memory: 0, agents: 0, skills: 0 },
  };
}

export function getMaintenanceCounters(ownerId: string): MaintenanceCounters {
  let c = counterByOwner.get(ownerId);
  if (!c) {
    c = createMaintenanceCounters();
    counterByOwner.set(ownerId, c);
  }
  return c;
}

/** Test seam: clear all owner counters. */
export function resetMaintenanceCountersForTests(): void {
  counterByOwner.clear();
}

/**
 * True when the user clearly asks to persist a fact.
 * Keep this narrow: 记住 / 别忘了 / English "remember" as a word.
 */
export function userAskedToRemember(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/记住|别忘了/.test(t)) return true;
  return /\bremember\b/i.test(t);
}

export type MaintenancePlan = {
  runMemory: boolean;
  runAgents: boolean;
  runSkills: boolean;
};

/**
 * Decide which silent refresh calls to run after a successful turn.
 * Updates and returns the next counters (callers should persist via getMaintenanceCounters).
 */
export function planPostTurnMaintenance(input: {
  settings: MaintenanceSettings | unknown;
  counters: MaintenanceCounters;
  userText: string;
}): MaintenancePlan & { counters: MaintenanceCounters } {
  const s = normalizeMaintenanceSettings(input.settings);
  const userChars = Math.max(0, (input.userText || '').trim().length);
  const next: MaintenanceCounters = {
    turnsSince: { ...input.counters.turnsSince },
    charsSince: { ...input.counters.charsSince },
  };
  for (const k of KINDS) {
    next.turnsSince[k] += 1;
    next.charsSince[k] += userChars;
  }

  const forceMemory = userAskedToRemember(input.userText);
  const runMemory =
    forceMemory ||
    next.turnsSince.memory >= s.memoryEveryTurns ||
    next.charsSince.memory >= s.memoryEveryUserChars;
  const runAgents =
    next.turnsSince.agents >= s.agentsEveryTurns ||
    next.charsSince.agents >= s.agentsEveryUserChars;
  const runSkills =
    next.turnsSince.skills >= s.skillsEveryTurns ||
    next.charsSince.skills >= s.skillsEveryUserChars;

  if (runMemory) {
    next.turnsSince.memory = 0;
    next.charsSince.memory = 0;
  }
  if (runAgents) {
    next.turnsSince.agents = 0;
    next.charsSince.agents = 0;
  }
  if (runSkills) {
    next.turnsSince.skills = 0;
    next.charsSince.skills = 0;
  }

  // Write back into the shared map object when the caller passed the live counters.
  input.counters.turnsSince = next.turnsSince;
  input.counters.charsSince = next.charsSince;

  return { runMemory, runAgents, runSkills, counters: next };
}
