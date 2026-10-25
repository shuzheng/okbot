/**
 * Decide whether Electron should start an in-process local gateway while the
 * UI attaches to a remote gateway (warm local for later remote→local hot-switch).
 *
 * Does not steal a healthy CLI/`okbot serve` (or other Electron) lock.
 */
export type BackgroundLocalPlan =
  | { action: 'skip_already_running'; port: number; pid?: number }
  | { action: 'skip_lock_held'; pid: number; port: number; verifiedOkbot: boolean }
  | { action: 'start' };

export type RunningServerSnapshot =
  | { state: 'free' }
  | { state: 'running'; port: number; pid?: number };

export type LockAcquireResult = { ok: true } | { ok: false; existing: { pid: number; port: number } };

/**
 * Pure planner for the remote-active boot path.
 * Callers run inspectRunningServer / acquireServerLock / probe, then feed results here.
 */
export function planBackgroundLocalGateway(input: {
  alreadyOwnsInProcess: boolean;
  running: RunningServerSnapshot;
  /** Present when running.state === 'free' and acquire was attempted. */
  lock?: LockAcquireResult;
  /** When lock.ok === false: whether the holder answered OkBot challenge. */
  lockHolderVerified?: boolean;
}): BackgroundLocalPlan {
  if (input.alreadyOwnsInProcess) {
    return { action: 'skip_already_running', port: 0 };
  }
  if (input.running.state === 'running') {
    return {
      action: 'skip_already_running',
      port: input.running.port,
      pid: input.running.pid,
    };
  }
  if (!input.lock) {
    return { action: 'start' };
  }
  if (input.lock.ok) {
    return { action: 'start' };
  }
  return {
    action: 'skip_lock_held',
    pid: input.lock.existing.pid,
    port: input.lock.existing.port,
    verifiedOkbot: input.lockHolderVerified === true,
  };
}
