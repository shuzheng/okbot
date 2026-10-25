import assert from 'node:assert/strict';
import { isAllowedSessionPermission } from './sessionPermissions';

assert.equal(isAllowedSessionPermission('notifications'), true);
assert.equal(isAllowedSessionPermission('media'), true);
assert.equal(isAllowedSessionPermission('mediaKeySystem'), true);
assert.equal(isAllowedSessionPermission('speechRecognition'), true);
assert.equal(isAllowedSessionPermission('SpeechSynthesis'), true);
assert.equal(isAllowedSessionPermission('geolocation'), false);
assert.equal(isAllowedSessionPermission('clipboard-read'), false);

console.log('sessionPermissions.test.ts: ok');
