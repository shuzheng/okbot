import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  buildDevRelaunchWaiterSource,
  isElectronViteDevProcess,
  planDevRelaunch,
} from './relaunchAppPlan';

test('isElectronViteDevProcess: ELECTRON_RENDERER_URL or NODE_ENV_ELECTRON_VITE', () => {
  assert.equal(isElectronViteDevProcess({}), false);
  assert.equal(isElectronViteDevProcess({ ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173' }), true);
  assert.equal(isElectronViteDevProcess({ NODE_ENV_ELECTRON_VITE: 'development' }), true);
  assert.equal(isElectronViteDevProcess({ ELECTRON_RENDERER_URL: '   ' }), false);
});

test('planDevRelaunch: null when not electron-vite dev', () => {
  assert.equal(planDevRelaunch({ env: {}, mainDir: '/app/out/main' }), null);
});

test('planDevRelaunch: prefers pnpm run dev via npm_execpath', () => {
  const plan = planDevRelaunch({
    mainDir: '/repo/apps/desktop/out/main',
    env: {
      NODE_ENV_ELECTRON_VITE: 'development',
      PNPM_SCRIPT_SRC_DIR: '/repo/apps/desktop',
      npm_execpath: '/opt/pnpm/bin/pnpm.mjs',
      npm_node_execpath: '/opt/node/bin/node',
    },
  });
  assert.ok(plan);
  assert.equal(plan!.nodeExec, '/opt/node/bin/node');
  assert.deepEqual(plan!.args, ['/opt/pnpm/bin/pnpm.mjs', 'run', 'dev']);
  assert.equal(plan!.cwd, '/repo/apps/desktop');
});

test('planDevRelaunch: falls back to desktop root from mainDir', () => {
  const mainDir = path.join('/repo', 'apps', 'desktop', 'out', 'main');
  const plan = planDevRelaunch({
    mainDir,
    env: {
      ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173',
      npm_execpath: '/pnpm.mjs',
      npm_node_execpath: '/node',
    },
  });
  assert.ok(plan);
  assert.equal(plan!.cwd, path.join('/repo', 'apps', 'desktop'));
});

test('buildDevRelaunchWaiterSource embeds pid and spawn plan', () => {
  const src = buildDevRelaunchWaiterSource(
    { nodeExec: '/node', args: ['/pnpm.mjs', 'run', 'dev'], cwd: '/desk' },
    4242,
  );
  assert.match(src, /4242/);
  assert.match(src, /\/pnpm\.mjs/);
  assert.match(src, /\/desk/);
  assert.match(src, /detached:\s*true/);
});
