import type { IpcContext } from './context';
import { registerEntityIpc } from './registerEntity';
import { registerSystemIpc } from './registerSystem';
import { registerChatIpc } from './registerChat';

export type { IpcContext, PendingToolApproval, ActiveRunsSnapshot } from './context';

export function registerAllIpc(ctx: IpcContext): void {
  registerEntityIpc(ctx);
  registerSystemIpc(ctx);
  registerChatIpc(ctx);
}
