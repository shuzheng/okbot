import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// bot-avatars 0.2.2+: keep IntersectionObserver host+rootMargin for sidebar
// overscan; idle-frame throttle (Lt.state / lastDraw) was dropped intentionally.
const patch = fs.readFileSync(path.join(root, 'patches/bot-avatars.patch'), 'utf8');
assert.match(patch, /const host = \w+\.parentElement \|\| \w+/);
assert.match(patch, /rootMargin:\s*"64px"/);
assert.match(patch, /\.observe\(host\)/);
assert.doesNotMatch(patch, /always run while mounted/);
assert.doesNotMatch(patch, /lastDraw/);
assert.doesNotMatch(patch, /Lt\.state === "default"/);

const menu = fs.readFileSync(
  path.join(root, 'apps/desktop/src/features/chat/ComposerAttachMenu.tsx'),
  'utf8',
);
assert.match(menu, /\{gooey \? \(/);
assert.match(menu, /setGooey\(false\)/);

const css = fs.readFileSync(path.join(root, 'apps/desktop/src/styles/app.css'), 'utf8');
// Empty-state metal title: static brushed-metal watermark (no flow animation).
assert.match(css, /\.chat-watermark-metal\s*\{[^}]*background-clip:\s*text/s);
assert.match(css, /\.chat-watermark-metal\s*\{[^}]*repeating-linear-gradient/s);
assert.doesNotMatch(css, /@keyframes\s+okbot-metal-flow/);
assert.doesNotMatch(css, /animation:\s*okbot-metal-flow/);
assert.doesNotMatch(css, /will-change:\s*background-position/);

const watermark = fs.readFileSync(
  path.join(root, 'apps/desktop/src/features/chat/ChatWatermark.tsx'),
  'utf8',
);
assert.doesNotMatch(watermark, /restartMetalFlow/);
assert.doesNotMatch(watermark, /visibilitychange/);
assert.doesNotMatch(watermark, /useLayoutEffect|useRef/);
assert.match(watermark, /chat-watermark-metal/);

console.log('idleGpu.test.ts: ok');
