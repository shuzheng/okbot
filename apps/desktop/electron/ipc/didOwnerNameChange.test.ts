import assert from 'node:assert/strict';
import { didOwnerNameChange } from './chatMaintenance';

assert.equal(didOwnerNameChange('旧名', '新名'), true);
assert.equal(didOwnerNameChange('同名', '同名'), false);
assert.equal(didOwnerNameChange(' 同名 ', '同名'), false);
assert.equal(didOwnerNameChange('旧名', '  新名  '), true);
assert.equal(didOwnerNameChange('旧名', '   '), false, 'whitespace-only keeps prev');
assert.equal(didOwnerNameChange('旧名', ''), false, 'empty string keeps prev');
assert.equal(didOwnerNameChange('旧名', undefined), false);
assert.equal(didOwnerNameChange('旧名', 123), false);
assert.equal(didOwnerNameChange('', '新助手'), true);

console.log('didOwnerNameChange.test.ts: ok');
