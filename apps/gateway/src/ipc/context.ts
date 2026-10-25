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
  /** Live vibrancy/bg; may run before settings.translucent is persisted. */
  applyWindowTranslucent: (translucent: boolean) => void;
  onAutoUpdatePreferenceChanged?: (enabled: boolean) => void;
  onGatewayHttpApiSettingsChanged?: () => void;
  /** Pin list / language / etc. — rebuild tray menu. */
  onSettingsPersisted?: () => void;
  /**
   * Merged UI settings (Electron client chrome + gateway). When unset, IPC uses
   * `storage.getSettings()` (gateway placeholders for chrome).
   */
  getUiSettings?: () => AppSettings;
  /**
   * Persist a merged UI settings write (split client → userData, gateway → ~/.okbot).
   * When unset, IPC uses `storage.saveSettings` only.
   */
  saveUiSettings?: (settings: AppSettings) => AppSettings;
};
