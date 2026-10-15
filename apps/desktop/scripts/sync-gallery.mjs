#!/usr/bin/env node
/**
 * Copy packages/agent/gallery → apps/desktop/resources/assistant-gallery
 * so electron-vite dev and packaged apps resolve the same offline packs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const src = path.resolve(desktopRoot, '../../packages/agent/gallery');
const dest = path.join(desktopRoot, 'resources/assistant-gallery');

if (!fs.existsSync(path.join(src, 'order.json'))) {
  console.error('gallery missing:', src);
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('synced gallery →', dest);
