import fs from 'node:fs';
import { FileStorage } from '../../storage';
import {
  isPidAlive,
  probeOkbotHealth,
  readServerLock,
  releaseServerLock,
  serverLockPath,
} from '../../serverPresence';
import type { CliMessages } from '../i18n';
import {
  parseInstanceFlags,
  reportInstanceFlagError,
  resolveOkbotRoot,
} from '../instanceArgs';
import { terminatePid } from '../stopProcess';

/**
 * Stop a running OkBot gateway (serve or electron owner).
 * Exit 0 if stopped or already stopped; non-zero on failure.
 * Optional `--port` + `--data-dir` (both required together) target a non-default instance
 * via that data-dir's runtime lock.
 */
export async function stop(
  t: CliMessages,
  opts?: { quietAlreadyStopped?: boolean; args?: string[] },
): Promise<number> {
  const args = opts?.args ?? [];
  const flags = parseInstanceFlags(args);
  if (!flags.ok) return reportInstanceFlagError(t, flags.error);
  if (flags.rest.length > 0) {
    console.error(t.instanceUnknownArgs(flags.rest.join(' ')));
    return 1;
  }

  const root = resolveOkbotRoot(flags.dataDir);
  const storage = new FileStorage(root);
  const api = storage.getSettings().gatewayHttpApi;
  const lock = readServerLock(storage.root);

  if (!lock) {
    if (!opts?.quietAlreadyStopped) console.log(t.stopAlreadyStopped);
    return 0;
  }

  if (lock.owner !== 'serve' && lock.owner !== 'electron') {
    console.error(t.stopNotOkbot);
    return 1;
  }

  if (!isPidAlive(lock.pid)) {
    try {
      fs.unlinkSync(serverLockPath(storage.root));
    } catch {
      /* already gone */
    }
    console.log(t.stopStaleLockReleased);
    return 0;
  }

  // Optional health check — still stop verified owner locks even if probe fails.
  const port =
    lock.port > 0 ? lock.port : flags.port != null ? flags.port : api.port;
  await probeOkbotHealth(port, 400, api.token);

  if (lock.owner === 'electron') {
    console.log(t.stopOwnerElectron);
  }
  console.log(t.stopStopping(lock.pid, lock.owner));

  let outcome: 'stopped' | 'killed' | 'still_alive' | 'gone';
  try {
    outcome = await terminatePid(lock.pid);
  } catch (err) {
    console.error(t.stopFailed(err instanceof Error ? err.message : String(err)));
    return 1;
  }

  if (outcome === 'gone' || outcome === 'stopped' || outcome === 'killed') {
    if (outcome === 'killed') console.log(t.stopKilled);
    if (outcome === 'gone') {
      releaseServerLock(storage.root, lock.pid);
      console.log(t.stopStaleLockReleased);
      return 0;
    }
  } else {
    console.error(t.stopFailed(`pid ${lock.pid} still alive`));
    return 1;
  }

  // Drop lock if the other process did not (crash / kill).
  try {
    const latest = readServerLock(storage.root);
    if (latest && latest.pid === lock.pid) {
      fs.unlinkSync(serverLockPath(storage.root));
    }
  } catch {
    /* ignore */
  }

  console.log(t.stopStopped);
  return 0;
}
