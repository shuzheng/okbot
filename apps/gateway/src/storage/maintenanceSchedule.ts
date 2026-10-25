/**
 * Post-turn maintenance throttle for SOUL.md / skills.
 *
 * Memory policy (LLM-owned): always invoke refreshMemories after a successful
 * turn. The model decides create / skip / merge against existing memories;
 * there is no programmatic "every N turns" or "user chars ≥ X" write gate.
 * `memoryEveryTurns` / `memoryEveryUserChars` in settings remain for compat
 * only and are intentionally unused here.
 *
 * `userAskedToRemember` (记住 / 别忘了 / remember) is kept as a phrase detector
 * for prompts / diagnostics — not as a schedule that forces writes past the model.
 */
import {
  normalizeMaintenanceSettings,
  type MaintenanceSettings,
} from '@okbot/shared';

export type MaintenanceKind = 'memory' | 'soul' | 'skills';

export type MaintenanceCounters = {
  turnsSince: Record<MaintenanceKind, number>;
  charsSince: Record<MaintenanceKind, number>;
};

const KINDS: MaintenanceKind[] = ['memory', 'soul', 'skills'];

/** In-process counters per chat owner (bot or squad). Lost on restart — fail open to a light refresh. */
const counterByOwner = new Map<string, MaintenanceCounters>();

export function createMaintenanceCounters(): MaintenanceCounters {
  return {
    turnsSince: { memory: 0, soul: 0, skills: 0 },
    charsSince: { memory: 0, soul: 0, skills: 0 },
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
 * Not a programmatic write gate — refresh always runs; the LLM still decides content.
 */
export function userAskedToRemember(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/记住|别忘了/.test(t)) return true;
  return /\bremember\b/i.test(t);
}

export type MaintenancePlan = {
  runMemory: boolean;
  runSoul: boolean;
  runSkills: boolean;
};

/**
 * Decide which silent refresh calls to run after a successful turn.
 * Updates and returns the next counters (callers should persist via getMaintenanceCounters).
 *
 * Memory always runs (LLM returns none or upsert). SOUL / skills keep turn/char throttle.
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

  // Memory: no turn/char gate — model owns whether anything is written.
  // (settings.memoryEveryTurns / memoryEveryUserChars are deprecated unused gates.)
  const runMemory = true;
  const runSoul =
    next.turnsSince.soul >= s.soulEveryTurns ||
    next.charsSince.soul >= s.soulEveryUserChars;
  const runSkills =
    next.turnsSince.skills >= s.skillsEveryTurns ||
    next.charsSince.skills >= s.skillsEveryUserChars;

  if (runMemory) {
    next.turnsSince.memory = 0;
    next.charsSince.memory = 0;
  }
  if (runSoul) {
    next.turnsSince.soul = 0;
    next.charsSince.soul = 0;
  }
  if (runSkills) {
    next.turnsSince.skills = 0;
    next.charsSince.skills = 0;
  }

  // Write back into the shared map object when the caller passed the live counters.
  input.counters.turnsSince = next.turnsSince;
  input.counters.charsSince = next.charsSince;

  return { runMemory, runSoul, runSkills, counters: next };
}
