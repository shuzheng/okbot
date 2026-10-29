import assert from 'node:assert/strict';
import { uploadStillCurrent } from './useAttachments';

assert.equal(
  uploadStillCurrent(
    { ownerId: 'bot_a', generation: 1 },
    { ownerId: 'bot_a', generation: 1 },
  ),
  true,
);

assert.equal(
  uploadStillCurrent(
    { ownerId: 'bot_a', generation: 1 },
    { ownerId: 'bot_b', generation: 1 },
  ),
  false,
  'owner switch must reject late upload',
);

assert.equal(
  uploadStillCurrent(
    { ownerId: 'bot_a', generation: 1 },
    { ownerId: 'bot_a', generation: 2 },
  ),
  false,
  'clearAttachments generation bump must reject late upload',
);

assert.equal(
  uploadStillCurrent(
    { ownerId: 'bot_a', generation: 1 },
    { ownerId: null, generation: 1 },
  ),
  false,
);

assert.equal(
  uploadStillCurrent(
    { ownerId: '', generation: 1 },
    { ownerId: '', generation: 1 },
  ),
  false,
);

console.log('useAttachments.uploadRace.test.ts: ok');
