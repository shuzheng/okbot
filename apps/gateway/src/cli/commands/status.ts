import { FileStorage } from '../../storage';
import {
  isPidAlive,
  probeOkbotHealth,
  publicBase,
  readServerLock,
} from '../../serverPresence';
import type { CliMessages } from '../i18n';
import {
  parseInstanceFlags,
  reportInstanceFlagError,
  resolveOkbotRoot,
} from '../instanceArgs';

/**
 * Print gateway status. Exit 0 if running and healthy; 1 otherwise.
 * Optional `--port` + `--data-dir` (both required together) target a non-default instance.
 */
export async function status(t: CliMessages, args: string[] = []): Promise<number> {
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
  // Prefer live lock port, then explicit CLI port, then server.json.
  const port =
    lock?.port && lock.port > 0
      ? lock.port
      : flags.port != null
        ? flags.port
        : api.port;
  const healthy = await probeOkbotHealth(port, 600, api.token);
  const lockAlive = !!(lock && isPidAlive(lock.pid));

  console.log(t.statusDataRoot(storage.root));
  console.log(t.statusPort(port));
  console.log(t.statusBaseUrl(publicBase(port)));
  console.log(t.statusBindLan(api.bindLan));
  console.log(t.statusServeUi(api.serveUi));

  if (lock) {
    console.log(t.statusPid(lock.pid));
    console.log(t.statusOwner(lock.owner));
  }

  if (healthy) {
    console.log(t.statusRunning);
    return 0;
  }
  if (lockAlive) {
    console.log(t.statusUnhealthy);
    return 1;
  }
  console.log(t.statusNotRunning);
  return 1;
}
