import assert from 'node:assert/strict';
import {
  OWNER_DESCRIPTION_MAX_CHARS,
  clampOwnerDescription,
} from './dist/index.js';

assert.equal(OWNER_DESCRIPTION_MAX_CHARS, 200);
assert.equal(clampOwnerDescription('  hello  '), 'hello');
assert.equal(clampOwnerDescription(null), '');
assert.equal(clampOwnerDescription(undefined), '');
assert.equal(clampOwnerDescription('x'.repeat(200)), 'x'.repeat(200));
assert.equal(clampOwnerDescription('x'.repeat(201)), 'x'.repeat(200));
assert.equal(clampOwnerDescription('  中文简介  '), '中文简介');

console.log('ownerDescription.test.mjs: ok');
