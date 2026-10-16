/**
 * Model-facing history must drop assistant `<think>` spans while UI storage may keep them.
 */
import { normalizeAgentInputItemForRunState, stripThinkFromAgentInputItem } from '@okbot/shared';
import { formatHistoryBlock } from './instructions.ts';
import { formatAgentInputItem } from './promptContext.ts';
import { OkbotFileSession, type OkbotSessionStore } from './session/OkbotFileSession.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const THINK = '<think>secret reasoning</think>\n\nvisible answer';

// formatHistoryBlock (fallback when session does not own history)
const block = formatHistoryBlock([
  { id: 'u1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'a1', role: 'assistant', content: THINK, createdAt: '2026-01-01T00:00:01.000Z' },
]);
assert(block.includes('visible answer'), 'history block keeps answer');
assert(!block.includes('<think>'), 'history block strips open tag');
assert(!block.includes('secret reasoning'), 'history block strips thinking body');
assert(block.includes('用户: hi'), 'history block keeps user text');

// stripThinkFromAgentInputItem — string + array content
const strItem = stripThinkFromAgentInputItem({
  type: 'message',
  role: 'assistant',
  content: THINK,
});
assert(strItem.content === 'visible answer', 'string content stripped');

const arrItem = stripThinkFromAgentInputItem({
  type: 'message',
  role: 'assistant',
  content: [{ type: 'output_text', text: THINK }],
});
const part = (arrItem.content as Array<Record<string, unknown>>)[0]!;
assert(part.text === 'visible answer', 'array text part stripped');

const userKept = stripThinkFromAgentInputItem({
  type: 'message',
  role: 'user',
  content: THINK,
});
assert(userKept.content === THINK, 'user content not stripped');

// 「完整上下文」projection
const formatted = formatAgentInputItem(
  { type: 'message', role: 'assistant', content: THINK },
  1,
);
assert(formatted.includes('visible answer'), 'prompt context keeps answer');
assert(!formatted.includes('<think>'), 'prompt context strips think tag');
assert(!formatted.includes('secret reasoning'), 'prompt context strips thinking');

// OkbotFileSession.getItems strips for the SDK/model
const store: OkbotSessionStore = {
  getSessionId: () => 'bot1',
  readItems: () => [
    { type: 'message', role: 'user', content: 'hi' },
    { type: 'message', role: 'assistant', content: THINK },
  ],
  appendItems: () => {},
  popItem: () => undefined,
  clearItems: () => {},
  replaceItems: () => {},
};
const session = new OkbotFileSession(store);
const items = await session.getItems();
assert(items.length === 2, 'getItems returns both');
const modelAssistant = items[1] as {
  content: Array<{ type?: string; text?: string }>;
  status?: string;
};
assert(Array.isArray(modelAssistant.content), 'getItems normalizes assistant content to array');
assert(modelAssistant.content[0]?.text === 'visible answer', 'session getItems strips');
assert(modelAssistant.status === 'completed', 'getItems sets assistant status for RunState');
assert(
  (store.readItems()[1] as { content: string }).content === THINK,
  'store still has raw think for UI',
);

// normalizeAgentInputItemForRunState — plain UI assistant + reasoning + system
const plain = normalizeAgentInputItemForRunState({
  type: 'message',
  role: 'assistant',
  content: 'hello',
});
assert(Array.isArray(plain.content), 'plain UI assistant → array content');
assert(
  (plain.content as Array<{ type: string; text: string }>)[0]?.type === 'output_text',
  'plain UI assistant → output_text',
);
assert(plain.status === 'completed', 'plain UI assistant → status completed');

const reasoning = normalizeAgentInputItemForRunState({
  type: 'reasoning',
  content: 'why',
});
assert(Array.isArray(reasoning.content), 'reasoning string → array');
assert(
  (reasoning.content as Array<{ type: string; text: string }>)[0]?.type === 'input_text',
  'reasoning → input_text',
);

const system = normalizeAgentInputItemForRunState({
  type: 'message',
  role: 'system',
  content: [{ type: 'input_text', text: 'sys' }],
});
assert(system.content === 'sys', 'system array → string');

const userLeft = normalizeAgentInputItemForRunState({
  type: 'message',
  role: 'user',
  content: 'hi',
});
assert(userLeft.content === 'hi', 'user string left alone');

console.log('stripThinkHistory.test.ts: ok');
