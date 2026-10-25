/**
 * Restart the desktop shell.
 *
 * Packaged builds: `app.relaunch()` + quit (same binary/args).
 *
 * electron-vite / `pnpm dev`: bare `app.relaunch()` only restarts the Electron
 * binary. The Vite parent is gone, so `loadRenderer` finds ELECTRON_RENDERER_URL
 * unreachable and falls back to a stale `out/renderer` (often weeks old) — the
 * classic "switch gateway → full restart → old version" pitfall. Schedule a
 * waiter that re-runs `pnpm run dev` (or electron-vite) after this pid exits so
 * the single-instance lock is free and Vite comes back.
 */
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { setIsQuitting } from './quitState';
import { buildDevRelaunchWaiterSource, planDevRelaunch } from './relaunchAppPlan';

function scheduleDevRelaunchAfterExit(
  plan: { nodeExec: string; args: string[]; cwd: string },
  pid: number,
): void {
  const waiter = buildDevRelaunchWaiterSource(plan, pid);
  spawn(plan.nodeExec, ['-e', waiter], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  }).unref();
}

/**
 * Mark quitting and restart. Prefer re-entering electron-vite/`pnpm dev` when
 * this process was started that way; otherwise `app.relaunch()`.
 */
export function relaunchOkBotApp(mainDir: string = __dirname): void {
  setIsQuitting(true);
  const plan = planDevRelaunch({ mainDir });
  if (plan) {
    console.info(
      `[okbot] dev relaunch: after exit, run ${plan.nodeExec} ${plan.args.join(' ')} (cwd=${plan.cwd})`,
    );
    scheduleDevRelaunchAfterExit(plan, process.pid);
    app.quit();
    return;
  }
  app.relaunch();
  app.quit();
}
