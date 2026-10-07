import type { AppSettings, RuntimeEvent } from '@okbot/shared';
import type { FileStorage } from '../storage';

/** In-memory live HITL approval waiter (hot path while agent run is alive). */
export type PendingToolApproval = {
  botId: string;
  messageId: string;
  toolName: string;
  arguments: unknown;
  /** Computer selected for the chat turn that requested this tool. */
  computerId?: string;
  resolve: (decision: { approved: boolean; message?: string }) => void;
  /** Clears the default-deny timer once the waiter is settled. */
  cancelTimeout?: () => void;
};

export type ActiveRunsSnapshot = {
  busyBotIds: string[];
  pendingToolRequests: Array<{
    requestId: string;
    botId: string;
    messageId: string;
    toolName: string;
    arguments: unknown;
  }>;
};

/**
 * Shared deps for IPC registration modules.
 * Shapes match main.ts pending-approval Map + FileStorage HITL APIs.
 */
export type IpcContext = {
  storage: FileStorage;
  /** ownerId → runId → AbortController (parallel turns). */
  abortControllers: Map<string, Map<string, AbortController>>;
  pendingToolApprovals: Map<string, PendingToolApproval>;
  hardwareAccelerationActive: boolean;
  sendRuntimeEvent: (event: RuntimeEvent) => void;
  snapshotActiveRuns: () => ActiveRunsSnapshot;
  rejectPendingApprovalsForBot: (botId: string, message?: string) => void;
  applyTheme: (theme: AppSettings['theme']) => void;
  onAutoUpdatePreferenceChanged?: (enabled: boolean) => void;
  onLocalHttpApiSettingsChanged?: () => void;
};
