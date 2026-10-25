import type { IpcContext } from '@okbot/gateway';
import { registerEntityIpc, registerChatIpc } from '@okbot/gateway';
import { registerSystemIpc, registerWindowControlIpc, registerUpdaterIpc } from './registerSystem';
import { registerExtensionsIpc } from './registerExtensions';
import { registerClientGatewayIpc } from './registerClientGateway';

export type { IpcContext, PendingToolApproval, ActiveRunsSnapshot } from '@okbot/gateway';

export function registerAllIpc(ctx: IpcContext): void {
  registerEntityIpc(ctx);
  registerSystemIpc(ctx);
  registerChatIpc(ctx);
  registerExtensionsIpc(ctx);
}

export { registerWindowControlIpc, registerUpdaterIpc };
export { registerClientGatewayIpc };
