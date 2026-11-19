/**
 * One-shot DistortionWave arming for the visible chat-header member pill.
 * Only a live evolution_complete for the currently selected owner should play;
 * session switches and remounts must not replay an already-armed wave.
 */

/** Arm a wave when evolution finishes for the owner whose card is on screen. */
export function armEvolutionWaveIfVisible(
  prev: Record<string, number>,
  eventOwnerId: string,
  selectedOwnerId: string | undefined,
): Record<string, number> {
  const ownerId = (eventOwnerId || '').trim();
  const selected = (selectedOwnerId || '').trim();
  if (!ownerId || !selected || ownerId !== selected) return prev;
  return { ...prev, [ownerId]: (prev[ownerId] ?? 0) + 1 };
}

/** Keep only the visible owner's pending nonce so a switch-back cannot replay. */
export function retainVisibleEvolutionWave(
  prev: Record<string, number>,
  selectedOwnerId: string | undefined,
): Record<string, number> {
  const selected = (selectedOwnerId || '').trim();
  const keys = Object.keys(prev);
  if (!selected) return keys.length === 0 ? prev : {};
  const nonce = prev[selected];
  if (nonce == null) return keys.length === 0 ? prev : {};
  if (keys.length === 1 && keys[0] === selected) return prev;
  return { [selected]: nonce };
}

/** Play options so a center DistortionWave opens from a point at the padding-box center. */
export function evolutionWavePlayOptions(width: number, height: number): {
  source: { x: number; y: number; w: number; h: number };
  focus: { x: number; y: number };
} {
  const x = width / 2;
  const y = height / 2;
  return {
    source: { x, y, w: 0, h: 0 },
    focus: { x, y },
  };
}
