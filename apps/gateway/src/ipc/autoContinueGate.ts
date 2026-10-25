/**
 * Cancel token for host task-progress auto-continue chains.
 * Stop (chatAbort) sets the flag so orchestrateBotTurn does not start another
 * synthetic turn after the in-flight run settles.
 */
const cancelled = new Set<string>();

export function cancelAutoContinues(ownerId: string): void {
  const id = (ownerId || '').trim();
  if (!id) return;
  cancelled.add(id);
}

export function clearAutoContinueCancel(ownerId: string): void {
  const id = (ownerId || '').trim();
  if (!id) return;
  cancelled.delete(id);
}

export function isAutoContinueCancelled(ownerId: string): boolean {
  const id = (ownerId || '').trim();
  if (!id) return false;
  return cancelled.has(id);
}

export function resetAutoContinueStateForTests(): void {
  cancelled.clear();
}
