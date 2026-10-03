import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const patch = fs.readFileSync(path.join(root, 'patches/bot-avatars.patch'), 'utf8');
assert.match(patch, /Lt\.state === "default"/);
assert.match(patch, /lastDraw >= 80/);
assert.match(patch, /Kt\.observe\(host\)/);
assert.doesNotMatch(patch, /always run while mounted/);

const menu = fs.readFileSync(
  path.join(root, 'apps/desktop/src/features/chat/ComposerAttachMenu.tsx'),
  'utf8',
);
assert.match(menu, /\{gooey \? \(/);
assert.match(menu, /setGooey\(false\)/);

const css = fs.readFileSync(path.join(root, 'apps/desktop/src/styles/app.css'), 'utf8');
assert.doesNotMatch(css, /animation:\s*okbot-metal-flow/);
assert.doesNotMatch(css, /will-change:\s*background-position/);

console.log('idleGpu.test.ts: ok');
