import { contextBridge } from 'electron';

function readArg(flag: string): string {
  const prefix = `${flag}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

const base = readArg('--okbot-api-base');
const token = readArg('--okbot-api-token');

// UI-only window: no IPC backend. The renderer talks to the already-running gateway.
if (base) {
  contextBridge.exposeInMainWorld('__okbotAttach', {
    base,
    token,
    platform: process.platform,
  });
}
