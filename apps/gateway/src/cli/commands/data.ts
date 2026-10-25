import { spawn } from 'node:child_process';
import { FileStorage } from '../../storage';
import type { CliMessages } from '../i18n';

function openPath(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'explorer' : 'xdg-open';
    const child = spawn(cmd, [dir], { detached: true, stdio: 'ignore' });
    child.on('error', reject);
    child.unref();
    // Give spawn a tick; open/xdg-open usually exit 0 quickly but we don't wait for the GUI.
    child.on('spawn', () => resolve());
    // If 'spawn' already happened (rare), resolve on next tick
    setTimeout(() => resolve(), 50);
  });
}

export async function dataCommand(args: string[], t: CliMessages): Promise<number> {
  const storage = new FileStorage();
  const root = storage.root;
  const sub = args[0];

  if (!sub || sub === 'path') {
    console.log(t.dataPath(root));
    return 0;
  }

  if (sub === 'open') {
    console.log(t.dataPath(root));
    try {
      await openPath(root);
      console.log(t.dataOpened(root));
      return 0;
    } catch (err) {
      console.error(t.dataOpenFailed(err instanceof Error ? err.message : String(err)));
      return 1;
    }
  }

  console.error(t.dataUnknownSub(sub));
  return 1;
}
