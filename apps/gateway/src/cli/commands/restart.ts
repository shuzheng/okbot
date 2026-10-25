import type { CliMessages } from '../i18n';
import { stop } from './stop';
import { serve } from './serve';

/**
 * Stop cleanly, then run serve() in-process.
 * If nothing was running, just start serve.
 * Forwards `--port` / `--data-dir` (both-or-neither) to stop and serve.
 */
export async function restart(t: CliMessages, args: string[] = []): Promise<number> {
  console.log(t.restartStopping);
  const stopCode = await stop(t, { quietAlreadyStopped: true, args });
  if (stopCode !== 0) {
    console.error(t.restartStopFailed);
    return stopCode;
  }
  console.log(t.restartStarting);
  return serve(t, args);
}
