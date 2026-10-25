import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimeEvent } from '@okbot/shared';
import { FileStorage } from '../../storage';
import { createGatewayHttpApi } from '../../gatewayHttpApi';
import type { IpcContext, PendingToolApproval } from '../../ipc/context';
import {
  acquireServerLock,
  inspectRunningServer,
  probeOkbotHealth,
  publicBase,
  releaseServerLock,
} from '../../serverPresence';
import { ensureGatewayToken, resolveGatewayUiRoot, startSkillWatch } from '../../gatewayRuntime';
import { startScheduleTicker } from '../../scheduleTicker';
import { resumeAllSafeCheckpoints } from '../../ipc/chat/coldRestoreCheckpoint';
import { listBusyOwnerIds } from '../../ipc/ownerRuns';
import { readDesktopAppVersion } from '../../appVersion';
import type { CliMessages } from '../i18n';
import { parseInstanceFlags, reportInstanceFlagError, resolveOkbotRoot } from '../instanceArgs';

const abortControllers = new Map<string, Map<string, AbortController>>();
const pendingToolApprovals = new Map<string, PendingToolApproval>();

/** `src` when running via tsx; `dist` when running the bundled cli.js. */
function gatewayCodeDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (path.basename(here) === 'commands') return path.join(here, '..', '..');
  return here;
}

function rejectPendingApprovalsForBot(storage: FileStorage, botId: string, message = '已取消') {
  for (const [requestId, pending] of [...pendingToolApprovals.entries()]) {
    if (pending.botId !== botId) continue;
    pending.cancelTimeout?.();
    pendingToolApprovals.delete(requestId);
    pending.resolve({ approved: false, message });
  }
  storage.clearPendingHitl(botId);
  try {
    storage.clearRunCheckpoint(botId);
  } catch (err) {
    console.error('[okbot] clear run checkpoint on reject failed', err);
  }
}

/** Start the gateway in the foreground. Returns exit code (0 keeps process alive). */
export async function serve(t: CliMessages, args: string[] = []): Promise<number> {
  const flags = parseInstanceFlags(args);
  if (!flags.ok) return reportInstanceFlagError(t, flags.error);
  if (flags.rest.length > 0) {
    console.error(t.instanceUnknownArgs(flags.rest.join(' ')));
    return 1;
  }

  const root = resolveOkbotRoot(flags.dataDir);
  const storage = new FileStorage(root);

  // Custom pair: persist CLI port into this data dir's server.json for this instance.
  if (flags.port != null) {
    const cur = storage.getSettings();
    if (cur.gatewayHttpApi.port !== flags.port) {
      storage.saveSettings({
        ...cur,
        gatewayHttpApi: { ...cur.gatewayHttpApi, port: flags.port },
      });
    }
  }

  const configuredPort = storage.getSettings().gatewayHttpApi.port;
  const configuredToken = storage.getSettings().gatewayHttpApi.token;
  const existing = await inspectRunningServer(storage.root, configuredPort, configuredToken);
  if (existing.state === 'running') {
    const where = publicBase(existing.port);
    const pidLabel = existing.pid ? ` (pid ${existing.pid})` : '';
    console.error(t.serveAlreadyRunning(pidLabel, where));
    return 1;
  }

  const configured = storage.getSettings().gatewayHttpApi;
  const lock = acquireServerLock(storage.root, { pid: process.pid, port: configured.port, owner: 'serve' });
  if (!lock.ok) {
    const heldPort = lock.existing.port || configured.port;
    const verified = await probeOkbotHealth(heldPort, 400, configured.token);
    if (verified) {
      console.error(t.serveAlreadyRunning(` (pid ${lock.existing.pid})`, publicBase(heldPort)));
      return 1;
    }
    console.error(t.serveLockHeldNotOkbot(lock.existing.pid, heldPort));
    return 1;
  }
  const settings = ensureGatewayToken(storage);
  const api = settings.gatewayHttpApi;

  let bridge: ((event: RuntimeEvent) => void) | null = null;
  const sendRuntimeEvent = (event: RuntimeEvent) => {
    bridge?.(event);
  };
  const ctx: IpcContext = {
    storage,
    abortControllers,
    pendingToolApprovals,
    hardwareAccelerationActive: true,
    sendRuntimeEvent,
    snapshotActiveRuns: () => {
      const memoryPending = [...pendingToolApprovals.entries()].map(([requestId, p]) => ({
        requestId,
        botId: p.botId,
        messageId: p.messageId,
        toolName: p.toolName,
        arguments: p.arguments,
      }));
      const memoryIds = new Set(memoryPending.map((p) => p.requestId));
      const diskPending = storage
        .listAllPendingHitl()
        .filter((p) => !memoryIds.has(p.requestId))
        .map((p) => ({
          requestId: p.requestId,
          botId: p.botId,
          messageId: p.messageId,
          toolName: p.toolName,
          arguments: p.arguments,
        }));
      const busyBotIds = new Set<string>([
        ...listBusyOwnerIds(abortControllers),
        ...memoryPending.map((p) => p.botId),
        ...diskPending.map((p) => p.botId),
      ]);
      return {
        busyBotIds: [...busyBotIds],
        pendingToolRequests: [...memoryPending, ...diskPending],
      };
    },
    rejectPendingApprovalsForBot: (botId, message) => rejectPendingApprovalsForBot(storage, botId, message),
    applyTheme: () => {},
    applyWindowTranslucent: () => {},
    onGatewayHttpApiSettingsChanged: () => {
      try {
        http.sync(storage.getSettings().gatewayHttpApi);
      } catch (err) {
        console.error('[okbot] gatewayHttpApi sync failed', err);
      }
    },
  };
  storage.setSessionsChangedListener((ownerId, reason) => {
    sendRuntimeEvent({ type: 'sessions_changed', botId: ownerId, reason });
  });
  storage.setSettingsChangedListener(() => {
    sendRuntimeEvent({ type: 'settings_changed', at: new Date().toISOString() });
  });
  let stopSkills = () => {};
  let stopScheduleTicker = () => {};
  let shutdown: () => void = () => {
    releaseServerLock(storage.root);
    process.exit(0);
  };

  const http = createGatewayHttpApi({
    ctx,
    uiRoot: resolveGatewayUiRoot(gatewayCodeDir()),
    appVersion: readDesktopAppVersion(),
    onHostDataRestored: () => shutdown(),
  });
  bridge = (event) => http.bridgeRuntimeEvent(event);

  shutdown = () => {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    try {
      stopSkills();
    } catch (err) {
      console.error('[okbot] skill watch stop failed', err);
    }
    try {
      stopScheduleTicker();
    } catch (err) {
      console.error('[okbot] schedule ticker stop failed', err);
    }
    try {
      http.stop();
    } catch (err) {
      console.error('[okbot] gatewayHttpApi stop failed', err);
    }
    releaseServerLock(storage.root);
    process.exit(0);
  };

  try {
    await http.listen(api);
  } catch (err) {
    http.stop();
    releaseServerLock(storage.root);
    const again = await inspectRunningServer(storage.root, api.port, api.token);
    if (again.state === 'running') {
      console.error(t.serveAlreadyRunning('', publicBase(again.port)));
      return 1;
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      console.error(t.servePortInUse(api.port));
      return 1;
    }
    console.error(t.serveFailed, err);
    return 1;
  }

  stopSkills = startSkillWatch(storage, sendRuntimeEvent);
  stopScheduleTicker = startScheduleTicker({ storage, ctx });
  void resumeAllSafeCheckpoints(ctx).catch((err) => {
    console.error('[okbot] resume checkpoints on start failed', err);
  });

  const base = publicBase(api.port);
  const bind = api.bindLan ? '0.0.0.0' : '127.0.0.1';
  const ui = api.serveUi ? t.serveUiOn : t.serveUiOff;
  console.log(t.serveStarted);
  console.log(t.serveDataRoot(storage.root));
  console.log(t.serveAddress(base));
  console.log(t.serveBind(bind, ui));
  console.log(t.serveToken(api.token));
  if (api.adminToken) console.log(t.serveAdminToken(api.adminToken));
  console.log(t.serveCtrlC);

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return 0;
}
