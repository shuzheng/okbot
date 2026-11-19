/**
 * set_status placeholder reducer: set/update same slot, replace on real reply, clear on abort.
 */
import assert from 'node:assert/strict';
import {
  reduceAssistantStatusPlaceholders,
  type AssistantStatusPlaceholder,
} from './assistantStatusPlaceholder';

function apply(
  prev: Record<string, AssistantStatusPlaceholder>,
  event: Parameters<typeof reduceAssistantStatusPlaceholders>[1],
) {
  return reduceAssistantStatusPlaceholders(prev, event);
}

let state: Record<string, AssistantStatusPlaceholder> = {};

// set
state = apply(state, {
  type: 'assistant_status',
  botId: 'bot-1',
  messageId: 'msg-a',
  status: '正在对比两家餐厅',
  runId: 'run-1',
});
assert.deepEqual(state['bot-1'], {
  messageId: 'msg-a',
  status: '正在对比两家餐厅',
  runId: 'run-1',
});

// update same placeholder (do not stack)
state = apply(state, {
  type: 'assistant_status',
  botId: 'bot-1',
  messageId: 'msg-a',
  status: '正在查询今晚 7 点空位',
  runId: 'run-1',
});
assert.equal(Object.keys(state).length, 1);
assert.equal(state['bot-1']?.status, '正在查询今晚 7 点空位');
assert.equal(state['bot-1']?.messageId, 'msg-a');

// other owner is independent
state = apply(state, {
  type: 'assistant_status',
  botId: 'bot-2',
  messageId: 'msg-b',
  status: '正在搜索',
  runId: 'run-2',
});
assert.equal(state['bot-1']?.status, '正在查询今晚 7 点空位');
assert.equal(state['bot-2']?.status, '正在搜索');

// real assistant_message replaces (clears) placeholder
state = apply(state, {
  type: 'assistant_message',
  botId: 'bot-1',
  messageId: 'msg-a',
  hasVisibleReply: true,
  runId: 'run-1',
});
assert.equal(state['bot-1'], undefined);
assert.equal(state['bot-2']?.status, '正在搜索');

// think-only / empty assistant_message does not clear
state = apply(state, {
  type: 'assistant_status',
  botId: 'bot-1',
  messageId: 'msg-c',
  status: '正在整理结果',
  runId: 'run-3',
});
const before = state['bot-1'];
state = apply(state, {
  type: 'assistant_message',
  botId: 'bot-1',
  messageId: 'msg-c',
  hasVisibleReply: false,
  runId: 'run-3',
});
assert.deepEqual(state['bot-1'], before);

// done with a real reply clears
state = apply(state, {
  type: 'done',
  botId: 'bot-1',
  messageId: 'msg-c',
  hasVisibleReply: true,
  runId: 'run-3',
});
assert.equal(state['bot-1'], undefined);

// abort / empty done clears leftover placeholder
state = apply(state, {
  type: 'assistant_status',
  botId: 'bot-2',
  messageId: 'msg-d',
  status: '正在查询今晚 7 点空位',
  runId: 'run-4',
});
state = apply(state, {
  type: 'done',
  botId: 'bot-2',
  messageId: 'msg-d',
  runId: 'run-4',
});
assert.equal(state['bot-2'], undefined);

state = apply(state, {
  type: 'assistant_status',
  botId: 'bot-2',
  messageId: 'msg-e',
  status: '正在对比两家餐厅',
  runId: 'run-5',
});
state = apply(state, {
  type: 'assistant_status',
  botId: 'bot-2',
  messageId: 'msg-e',
  status: '',
  runId: 'run-5',
});
assert.equal(state['bot-2'], undefined);

// error clears
state = apply(state, {
  type: 'assistant_status',
  botId: 'bot-3',
  messageId: 'msg-f',
  status: '正在搜索',
  runId: 'run-6',
});
state = apply(state, {
  type: 'error',
  botId: 'bot-3',
  messageId: 'msg-f',
  runId: 'run-6',
});
assert.equal(state['bot-3'], undefined);

// mismatched runId does not clear another in-flight placeholder
state = apply(state, {
  type: 'assistant_status',
  botId: 'bot-1',
  messageId: 'msg-g',
  status: '正在对比两家餐厅',
  runId: 'run-keep',
});
state = apply(state, {
  type: 'done',
  botId: 'bot-1',
  messageId: 'msg-other',
  runId: 'run-other',
});
assert.equal(state['bot-1']?.status, '正在对比两家餐厅');

// aborted done (soft-steer / Stop) does not clear — keep showing while busy
state = apply(state, {
  type: 'done',
  botId: 'bot-1',
  messageId: 'msg-g',
  runId: 'run-keep',
  aborted: true,
});
assert.equal(state['bot-1']?.status, '正在对比两家餐厅');

// late empty status / done / visible flush from the aborted run must not
// wipe a placeholder already updated by the replacement run
state = apply({}, {
  type: 'assistant_status',
  botId: 'bot-1',
  messageId: 'msg-new',
  status: '正在核对新路径与远程地址',
  runId: 'run-new',
  latestRunId: 'run-new',
});
state = apply(state, {
  type: 'assistant_status',
  botId: 'bot-1',
  messageId: 'msg-old',
  status: '',
  runId: 'run-old',
  latestRunId: 'run-new',
});
assert.equal(state['bot-1']?.status, '正在核对新路径与远程地址');
state = apply(state, {
  type: 'done',
  botId: 'bot-1',
  messageId: 'msg-old',
  runId: 'run-old',
  aborted: true,
  latestRunId: 'run-new',
});
assert.equal(state['bot-1']?.status, '正在核对新路径与远程地址');
state = apply(state, {
  type: 'assistant_message',
  botId: 'bot-1',
  messageId: 'msg-old-flush',
  hasVisibleReply: true,
  runId: 'run-old',
  latestRunId: 'run-new',
});
assert.equal(state['bot-1']?.status, '正在核对新路径与远程地址');

// leftover old-run placeholder is replaced when the new run actually replies
state = apply({}, {
  type: 'assistant_status',
  botId: 'bot-1',
  messageId: 'msg-old-kept',
  status: '正在浏览这个仓库',
  runId: 'run-old',
  latestRunId: 'run-new',
});
state = apply(state, {
  type: 'assistant_message',
  botId: 'bot-1',
  messageId: 'msg-new-reply',
  hasVisibleReply: true,
  runId: 'run-new',
  latestRunId: 'run-new',
});
assert.equal(state['bot-1'], undefined);

// a new set_status without runId must not inherit the aborted run's id
state = apply({}, {
  type: 'assistant_status',
  botId: 'bot-1',
  messageId: 'msg-old-2',
  status: '正在浏览这个仓库',
  runId: 'run-old',
});
state = apply(state, {
  type: 'assistant_status',
  botId: 'bot-1',
  messageId: 'msg-new-2',
  status: '正在核对新路径',
  latestRunId: 'run-new',
});
assert.equal(state['bot-1']?.runId, 'run-new');
state = apply(state, {
  type: 'done',
  botId: 'bot-1',
  messageId: 'msg-old-2',
  runId: 'run-old',
  latestRunId: 'run-new',
});
assert.equal(state['bot-1']?.status, '正在核对新路径');

console.log('assistantStatusPlaceholder.test.ts: ok');
