import assert from 'node:assert/strict';
import { isAbortLikeError, isTransientRunError } from './dist/text.js';

assert.equal(isTransientRunError(null), false);
assert.equal(isTransientRunError(new Error('请先在设置里填写 API Key')), false);
assert.equal(isTransientRunError(new Error('模型返回为空')), false);

assert.equal(isTransientRunError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })), true);
assert.equal(isTransientRunError(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), true);
assert.equal(isTransientRunError(Object.assign(new Error('rate limit'), { status: 429 })), true);
assert.equal(isTransientRunError(Object.assign(new Error('bad gateway'), { status: 502 })), true);
assert.equal(isTransientRunError(Object.assign(new Error('unauthorized'), { status: 401 })), false);

const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
assert.equal(isAbortLikeError(abort), true);
assert.equal(isTransientRunError(abort), false);

assert.equal(isTransientRunError(new Error('fetch failed')), true);
assert.equal(isTransientRunError(new Error('APIConnectionError: connection refused')), true);

console.log('transientRunError.test.mjs: ok');
