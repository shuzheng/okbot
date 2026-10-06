import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '@okbot/shared';

function readArg(flag: string): string {
  const prefix = `${flag}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

const base = readArg('--okbot-api-base');

// UI-only window: no IPC backend. The renderer talks to the already-running gateway.
// The token is a one-shot IPC read so it never appears in the process command line.
if (base) {
  let token = '';
  try {
    const value = ipcRenderer.sendSync(IpcChannels.attachGatewayToken);
    token = typeof value === 'string' ? value : '';
  } catch {
    token = '';
  }
  const onWindowMaximizedChanged = (handler: (maximized: boolean) => void) => {
    const listener = (_event: unknown, maximized: boolean) => handler(Boolean(maximized));
    ipcRenderer.on(IpcChannels.windowMaximizedChanged, listener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.windowMaximizedChanged, listener);
    };
  };
  contextBridge.exposeInMainWorld('__okbotAttach', {
    base,
    token,
    platform: process.platform,
    windowMinimize: () => ipcRenderer.invoke(IpcChannels.windowMinimize),
    windowMaximizeToggle: () => ipcRenderer.invoke(IpcChannels.windowMaximizeToggle),
    windowClose: () => ipcRenderer.invoke(IpcChannels.windowClose),
    windowIsMaximized: () => ipcRenderer.invoke(IpcChannels.windowIsMaximized),
    windowFocus: () => ipcRenderer.invoke(IpcChannels.windowFocus),
    onWindowMaximizedChanged,
  });
}
