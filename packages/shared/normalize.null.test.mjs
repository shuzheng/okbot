import assert from 'node:assert/strict';
import {
  normalizeMaxTurns,
  normalizeToolRunMaxToolCalls,
  normalizeToolRunMaxDurationSec,
  normalizeSecuritySettings,
  normalizeContextCompression,
  normalizeMaxTokens,
  DEFAULT_MAX_TURNS,
  DEFAULT_TOOL_RUN,
  DEFAULT_DENIED_PATH_PREFIXES,
  DEFAULT_CONTEXT_COMPRESSION,
} from './dist/index.js';

assert.equal(normalizeMaxTokens(null), null);
assert.equal(normalizeMaxTokens(''), null);

assert.equal(normalizeMaxTurns(null), DEFAULT_MAX_TURNS);
assert.equal(normalizeMaxTurns(''), DEFAULT_MAX_TURNS);
assert.equal(normalizeMaxTurns('  '), DEFAULT_MAX_TURNS);
assert.equal(normalizeMaxTurns(undefined), DEFAULT_MAX_TURNS);
assert.equal(normalizeMaxTurns(3), 3);

assert.equal(normalizeToolRunMaxToolCalls(null), DEFAULT_TOOL_RUN.maxToolCalls);
assert.equal(normalizeToolRunMaxToolCalls(''), DEFAULT_TOOL_RUN.maxToolCalls);
assert.equal(normalizeToolRunMaxToolCalls(0), 0);
assert.equal(normalizeToolRunMaxDurationSec(null), DEFAULT_TOOL_RUN.maxDurationSec);
assert.equal(normalizeToolRunMaxDurationSec(''), DEFAULT_TOOL_RUN.maxDurationSec);
assert.equal(normalizeToolRunMaxDurationSec(0), 0);

const sec = normalizeSecuritySettings({ deniedPathPrefixes: null });
assert.deepEqual(sec.deniedPathPrefixes, [...DEFAULT_DENIED_PATH_PREFIXES]);
const sec2 = normalizeSecuritySettings({ deniedPathPrefixes: [] });
assert.deepEqual(sec2.deniedPathPrefixes, []);

const cc = normalizeContextCompression(null);
assert.equal(cc.ratio, DEFAULT_CONTEXT_COMPRESSION.ratio);
assert.equal(cc.keepRecentMax, DEFAULT_CONTEXT_COMPRESSION.keepRecentMax);

console.log('normalize.null.test.mjs: ok');
