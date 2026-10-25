/**
 * Pure planning for desktop relaunch (no Electron import — safe for Node tests).
 * See relaunchApp.ts for the runtime that applies the plan.
 */
import fs from 'node:fs';
import path from 'node:path';

export function isElectronViteDevProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV_ELECTRON_VITE === 'development') return true;
  const url = typeof env.ELECTRON_RENDERER_URL === 'string' ? env.ELECTRON_RENDERER_URL.trim() : '';
  return Boolean(url);
}

export type DevRelaunchPlan = {
  nodeExec: string;
  args: string[];
  cwd: string;
};

export function planDevRelaunch(opts: {
  env?: NodeJS.ProcessEnv;
  /** Directory of the compiled main bundle (`out/main`). */
  mainDir: string;
  /** Override process.execPath (tests). */
  execPath?: string;
}): DevRelaunchPlan | null {
  const env = opts.env ?? process.env;
  if (!isElectronViteDevProcess(env)) return null;

  const desktopRoot =
    (typeof env.PNPM_SCRIPT_SRC_DIR === 'string' && env.PNPM_SCRIPT_SRC_DIR.trim())
    || path.resolve(opts.mainDir, '../..');

  const npmExec = typeof env.npm_execpath === 'string' ? env.npm_execpath.trim() : '';
  const nodeExec =
    (typeof env.npm_node_execpath === 'string' && env.npm_node_execpath.trim())
    || opts.execPath
    || process.execPath;

  if (npmExec) {
    return { nodeExec, args: [npmExec, 'run', 'dev'], cwd: desktopRoot };
  }

  const electronViteJs = path.join(desktopRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');
  if (fs.existsSync(electronViteJs)) {
    return { nodeExec, args: [electronViteJs, 'dev'], cwd: desktopRoot };
  }

  return null;
}

/** Waiter source: block until `pid` exits, then spawn the planned `pnpm run dev`. */
export function buildDevRelaunchWaiterSource(plan: DevRelaunchPlan, pid: number): string {
  return `
const { spawn } = require('node:child_process');
const pid = ${JSON.stringify(pid)};
const deadline = Date.now() + 60000;
function alive() {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
(async () => {
  while (alive() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
  }
  if (alive()) process.exit(1);
  const child = spawn(${JSON.stringify(plan.nodeExec)}, ${JSON.stringify(plan.args)}, {
    cwd: ${JSON.stringify(plan.cwd)},
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
})();
`.trim();
}
