import assert from 'node:assert/strict';
import { normalizeCloseAction, DEFAULT_SETTINGS } from './dist/index.js';

assert.equal(normalizeCloseAction('ask'), 'ask');
assert.equal(normalizeCloseAction('quit'), 'quit');
assert.equal(normalizeCloseAction('tray'), 'tray');
assert.equal(normalizeCloseAction(undefined), 'ask');
assert.equal(normalizeCloseAction('nope'), 'ask');
assert.equal(normalizeCloseAction(1), 'ask');
assert.equal(DEFAULT_SETTINGS.closeAction, 'ask');
console.log('closeAction.test.mjs: ok');
