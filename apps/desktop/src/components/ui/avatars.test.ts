import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVATAR_PREVIEW_SIZE_PX, inferBotAvatarSize } from './avatars';

assert.equal(AVATAR_PREVIEW_SIZE_PX, 56);
assert.equal(inferBotAvatarSize('session-pin-avatar'), AVATAR_PREVIEW_SIZE_PX);
assert.equal(inferBotAvatarSize('session-avatar'), 36);
assert.notEqual(inferBotAvatarSize('session-pin-avatar'), 36);

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../styles/app.css'),
  'utf8',
);
assert.match(css, /--avatar-preview-size:\s*56px/);
assert.match(
  css,
  /\.avatar-preview-stack\s*\{[^}]*--avatar-preview-size:\s*56px/s,
);
assert.match(
  css,
  /\.avatar-preview-stack \.session-pin-avatar\s*\{[^}]*width:\s*var\(--avatar-preview-size\)/s,
);
assert.doesNotMatch(
  css,
  /\.avatar-preview-stack \.session-pin-avatar\s*\{[^}]*width:\s*var\(--pin-avatar\)/s,
);
