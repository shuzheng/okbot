import type { IpcContext } from './context';
import { registerEntityIpc } from './registerEntity';
import { registerSystemIpc, registerWindowControlIpc } from './registerSystem';
import { registerChatIpc } from './registerChat';
import { registerExtensionsIpc } from './registerExtensions';

export type { IpcContext, PendingToolApproval, ActiveRunsSnapshot } from './context';

export function registerAllIpc(ctx: IpcContext): void {
  registerEntityIpc(ctx);
  registerSystemIpc(ctx);
  registerChatIpc(ctx);
  registerExtensionsIpc(ctx);
}

export { registerWindowControlIpc };
