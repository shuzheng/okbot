import { isPidAlive } from '../serverPresence';

export type SignalSender = (pid: number, signal: NodeJS.Signals) => void;

/**
 * SIGTERM a pid, poll until dead or timeout, then SIGKILL if still alive.
 * Returns 'stopped' | 'killed' | 'still_alive' | 'gone'.
 */
export async function terminatePid(
  pid: number,
  opts: {
    waitMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
    kill?: SignalSender;
    alive?: (pid: number) => boolean;
  } = {},
): Promise<'stopped' | 'killed' | 'still_alive' | 'gone'> {
  const waitMs = opts.waitMs ?? 8_000;
  const pollMs = opts.pollMs ?? 200;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const kill =
    opts.kill ??
    ((p, signal) => {
      process.kill(p, signal);
    });
  const alive = opts.alive ?? isPidAlive;

  try {
    kill(pid, 'SIGTERM');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return 'gone';
    throw err;
  }

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return 'stopped';
    await sleep(pollMs);
  }

  if (!alive(pid)) return 'stopped';

  try {
    kill(pid, 'SIGKILL');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return 'gone';
    throw err;
  }
  await sleep(Math.min(pollMs, 300));
  return alive(pid) ? 'still_alive' : 'killed';
}
