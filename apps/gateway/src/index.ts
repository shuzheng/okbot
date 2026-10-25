/** @okbot/gateway — headless OkBot server modules shared with the Electron desktop shell. */

export { FileStorage } from './storage';
export type { PendingHitlRecord } from './storage';
export type { IpcContext, PendingToolApproval, ActiveRunsSnapshot } from './ipc/context';
export { createGatewayHttpApi } from './gatewayHttpApi';
export { ensureGatewayToken, resolveGatewayUiRoot, startSkillWatch } from './gatewayRuntime';
export { startScheduleTicker } from './scheduleTicker';
export {
  acquireServerLock,
  inspectRunningServer,
  probeOkbotHealth,
  probeOkbotWithGatewayTokens,
  publicBase,
  releaseServerLock,
  readServerLock,
  serverLockPath,
  isPidAlive,
  resolveProbeTarget,
  joinProbePath,
} from './serverPresence';
export type { ProbeTarget } from './serverPresence';
export {
  verifyOkbotChallenge,
  createProbeNonce,
  probeChallengeMac,
  isProbeNonce,
} from './authChallenge';
export { resumeAllSafeCheckpoints } from './ipc/chat/coldRestoreCheckpoint';
export { abortAllOwnerRuns, listBusyOwnerIds } from './ipc/ownerRuns';
export { closeMcp, mcpStatus, mcpTest, mcpToolsForRun } from './mcpRuntime';
export { registerEntityIpc, persistAppSettings } from './ipc/registerEntity';
export {
  registerChatIpc,
  respondToToolApproval,
  startChatTurn,
  compressSessionNow,
} from './ipc/registerChat';
export { abortChatOwner } from './ipc/chatControl';
export { claimNotify, notifyDeviceKey } from './notifyClaim';
export { exportDataBackup, restoreDataBackup } from './backup';
export { readDesktopAppVersion } from './appVersion';
export {
  GATEWAY_BRIDGE_METHOD_NAMES,
  gatewayBootJs,
  gatewayLoginHtml,
  injectGatewayBoot,
  shouldServeGatewayLogin,
} from './gatewayLoginPage';
export { createEntityOps } from './entityOps';
export { runGatewayRpc, GATEWAY_RPC_OPS } from './gatewayRpc';
export { releaseRunApprovals } from './ipc/approvalWaiter';
export { didOwnerNameChange } from './ipc/chatMaintenance';
export { createMeshExchangeHandler } from './ipc/chatTurnHelpers';
