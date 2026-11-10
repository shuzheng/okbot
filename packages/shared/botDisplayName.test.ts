import assert from 'node:assert/strict';
import {
  allocateUniqueBotDisplayName,
  isBotDisplayNameTaken,
  normalizeBotDisplayName,
  DEFAULT_BOT_DISPLAY_NAME,
} from './dist/botDisplayName.js';

assert.equal(normalizeBotDisplayName('  Alice  '), 'Alice');
assert.equal(normalizeBotDisplayName(''), DEFAULT_BOT_DISPLAY_NAME);
assert.equal(normalizeBotDisplayName(null), DEFAULT_BOT_DISPLAY_NAME);

assert.equal(isBotDisplayNameTaken(['Alice', 'Bob'], ' Alice '), true);
assert.equal(isBotDisplayNameTaken(['Alice'], 'alice'), false); // case-sensitive
assert.equal(isBotDisplayNameTaken(['Alice'], 'Bob'), false);

assert.equal(allocateUniqueBotDisplayName([], 'Coder'), 'Coder');
assert.equal(allocateUniqueBotDisplayName(['Coder'], 'Coder'), 'Coder-2');
assert.equal(allocateUniqueBotDisplayName(['Coder', 'Coder-2'], 'Coder'), 'Coder-3');
assert.equal(allocateUniqueBotDisplayName(['Coder-2'], 'Coder'), 'Coder');
assert.equal(allocateUniqueBotDisplayName(['  Coder  '], 'Coder'), 'Coder-2');
assert.equal(allocateUniqueBotDisplayName(['x'], '  '), `${DEFAULT_BOT_DISPLAY_NAME}`);
assert.equal(
  allocateUniqueBotDisplayName([DEFAULT_BOT_DISPLAY_NAME], ''),
  `${DEFAULT_BOT_DISPLAY_NAME}-2`,
);

console.log('botDisplayName.test.ts: ok');
