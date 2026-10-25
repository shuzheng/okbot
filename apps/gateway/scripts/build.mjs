import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await esbuild.build({
  entryPoints: [path.join(root, 'src/cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(root, 'dist/cli.js'),
  banner: { js: '#!/usr/bin/env node\n' },
  // Workspace packages + optional electron stay external; Node resolves them at runtime.
  packages: 'external',
  logOverride: { 'empty-import-meta': 'silent' },
});

console.log('built apps/gateway/dist/cli.js');
