import assert from 'node:assert/strict';
import { createUlid, isUlid } from './dist/index.js';

assert.equal(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV'), true);
assert.equal(isUlid('01arz3ndektsv4rrffq69g5fav'), true);
assert.equal(isUlid('task_abc'), false);
assert.equal(isUlid(''), false);
assert.equal(isUlid(1), false);
assert.equal(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FA'), false); // 25
assert.equal(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAVX'), false); // 27
assert.equal(isUlid('01ARZ3NDEKTSV4RRFFQ69G5FAO'), false); // O invalid

const a = createUlid(1_700_000_000_000);
const b = createUlid(1_700_000_000_001);
assert.equal(a.length, 26);
assert.ok(isUlid(a));
assert.ok(isUlid(b));
assert.ok(a < b, 'ULIDs must sort by time');
assert.notEqual(createUlid(), createUlid());

console.log('ulid.test.mjs: ok');
