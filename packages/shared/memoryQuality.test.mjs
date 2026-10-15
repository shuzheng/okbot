import assert from 'node:assert/strict';
import {
  isAcceptableMemoryFact,
  memorySignificanceLength,
  MEMORY_FACT_MIN_SIGNIFICANCE,
} from './dist/index.js';

assert.equal(MEMORY_FACT_MIN_SIGNIFICANCE, 8);

// Empty / whitespace
assert.equal(isAcceptableMemoryFact(''), false);
assert.equal(isAcceptableMemoryFact('   '), false);
assert.equal(isAcceptableMemoryFact('\n\t'), false);

// Single CJK word / 2–3 char labels must fail
assert.equal(isAcceptableMemoryFact('删除'), false);
assert.equal(isAcceptableMemoryFact('定时任务'), false);
assert.equal(isAcceptableMemoryFact('设置'), false);
assert.equal(isAcceptableMemoryFact('用中文'), false);
assert.equal(isAcceptableMemoryFact('回复用中文'), false); // 5 < 8

// Short but complete fact must pass
assert.equal(isAcceptableMemoryFact('用户偏好中文回复'), true);
assert.ok(memorySignificanceLength('用户偏好中文回复') >= 8);

// Longer durable facts
assert.equal(isAcceptableMemoryFact('新的约定：晚上不打扰'), true);
assert.equal(isAcceptableMemoryFact('用户希望助手默认使用简体中文回复'), true);

// Bare UI / tool nouns (length may pass denylist / slug heuristic)
assert.equal(isAcceptableMemoryFact('全局记忆'), false);
assert.equal(isAcceptableMemoryFact('系统指令'), false);
assert.equal(isAcceptableMemoryFact('上下文压缩'), false);
assert.equal(isAcceptableMemoryFact('web_search'), false);
assert.equal(isAcceptableMemoryFact('manage_schedule'), false);
assert.equal(isAcceptableMemoryFact('read_skill'), false);

// English equivalent: need ~16 non-space Latin chars
assert.equal(isAcceptableMemoryFact('ok'), false);
assert.equal(isAcceptableMemoryFact('remember'), false);
assert.equal(isAcceptableMemoryFact('I prefer Chinese replies'), true);

console.log('memoryQuality.test.mjs: ok');
