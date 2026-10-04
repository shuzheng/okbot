import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileStorage } from './storage';
import { createLocalHttpApi } from './localHttpApi';
import type { IpcContext } from './ipc/context';
import type { PendingToolApproval } from './ipc/context';
import type { RuntimeEvent } from '@okbot/shared';
import {
  acquireServerLock,
  inspectRunningServer,
  publicBase,
  releaseServerLock,
} from './serverPresence';
import { ensureGatewayToken, resolveGatewayUiRoot, startSkillWatch } from './gatewayRuntime';

const abortControllers = new Map<string, AbortController>();
const pendingToolApprovals = new Map<string, PendingToolApproval>();

function rejectPendingApprovalsForBot(storage: FileStorage, botId: string, message = '已取消') {
  for (const [requestId, pending] of [...pendingToolApprovals.entries()]) {
    if (pending.botId !== botId) continue;
    pendingToolApprovals.delete(requestId);
    pending.resolve({ approved: false, message });
  }
  storage.clearPendingHitl(botId);
}

async function serve(): Promise<number> {
  const storage = new FileStorage();
  const configuredPort = storage.getSettings().localHttpApi.port;
  const existing = await inspectRunningServer(storage.root, configuredPort);
  if (existing.state === 'running') {
    const where = publicBase(existing.port);
    const pid = existing.pid ? `（pid ${existing.pid}）` : '';
    console.error(`OkBot 已在运行${pid}：${where}。未再启动一份。`);
    return 1;
  }

  const configured = storage.getSettings().localHttpApi;
  const lock = acquireServerLock(storage.root, { pid: process.pid, port: configured.port, owner: 'serve' });
  if (!lock.ok) {
    console.error(
      `OkBot 已在运行（pid ${lock.existing.pid}）：${publicBase(lock.existing.port)}。未再启动一份。`,
    );
    return 1;
  }
  const settings = ensureGatewayToken(storage);
  const api = settings.localHttpApi;

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
        ...abortControllers.keys(),
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
    onLocalHttpApiSettingsChanged: () => {
      try {
        http.sync(storage.getSettings().localHttpApi);
      } catch (err) {
        console.error('[okbot] localHttpApi sync failed', err);
      }
    },
  };
  storage.setSessionsChangedListener((ownerId, reason) => {
    sendRuntimeEvent({ type: 'sessions_changed', botId: ownerId, reason });
  });
  const http = createLocalHttpApi({ ctx, uiRoot: resolveGatewayUiRoot(path.dirname(fileURLToPath(import.meta.url))) });
  bridge = (event) => http.bridgeRuntimeEvent(event);
  let stopSkills = () => {};

  const shutdown = () => {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    try {
      stopSkills();
    } catch (err) {
      console.error('[okbot] skill watch stop failed', err);
    }
    try {
      http.stop();
    } catch (err) {
      console.error('[okbot] localHttpApi stop failed', err);
    }
    releaseServerLock(storage.root);
    process.exit(0);
  };

  try {
    await http.listen(api);
  } catch (err) {
    http.stop();
    releaseServerLock(storage.root);
    const again = await inspectRunningServer(storage.root, api.port);
    if (again.state === 'running') {
      console.error(`OkBot 已在运行：${publicBase(again.port)}。未再启动一份。`);
      return 1;
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      console.error(`端口 ${api.port} 已被占用，且不是 OkBot 服务。`);
      return 1;
    }
    console.error('[okbot] serve failed', err);
    return 1;
  }

  try {
    const n = storage.abandonRunningTracesOnStartup();
    if (n > 0) console.info(`[okbot] marked ${n} abandoned run trace(s) on startup`);
  } catch (err) {
    console.error('[okbot] abandonRunningTracesOnStartup failed', err);
  }
  stopSkills = startSkillWatch(storage, sendRuntimeEvent);

  const base = publicBase(api.port);
  const bind = api.bindLan ? '0.0.0.0' : '127.0.0.1';
  const ui = api.serveUi ? '已提供 Web UI' : '未提供 Web UI';
  console.log('OkBot 服务已启动');
  console.log(`地址 ${base}`);
  console.log(`绑定 ${bind}，${ui}`);
  console.log(`访问令牌 ${api.token}`);
  console.log('按 Ctrl+C 停止');

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return 0;
}

const command = process.argv[2];
if (command !== 'serve') {
  console.error('用法: okbot serve');
  process.exit(1);
}

void serve().then((code) => {
  if (code !== 0) process.exit(code);
});
