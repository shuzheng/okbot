import assert from 'node:assert/strict';
import { listHardcodedSystemPrompts } from './hardcodedSystemPrompts.js';
import { buildCompressHandoffSystemPrompt } from './compressHandoffPrompt.js';
import { buildTopicChangeSystemPrompt } from './topicChangePrompt.js';
import { CONTEXT_SUMMARY_MAX_CHARS } from '@okbot/shared';

const entries = listHardcodedSystemPrompts();
assert.ok(entries.length >= 10, 'catalog should list major hardcoded prompts');

const ids = new Set(entries.map((e) => e.id));
assert.ok(ids.has('compressHandoffSystem'), 'must include compress handoff system');
assert.ok(ids.has('compressHandoffUser'), 'must include compress handoff user');
assert.ok(ids.has('topicChangeSystem'), 'must include topic-change system');
assert.ok(ids.has('replyStyle'), 'must include reply style');
assert.ok(ids.has('memoryRefreshSystem'), 'must include memory refresh');
assert.ok(ids.has('skillsRefreshSystem'), 'must include skills refresh');
assert.ok(ids.has('visionTurn'), 'must include vision turn');

const compress = entries.find((e) => e.id === 'compressHandoffSystem')!;
assert.equal(
  compress.body,
  buildCompressHandoffSystemPrompt(CONTEXT_SUMMARY_MAX_CHARS),
  'compress body must match runtime builder',
);
assert.ok(compress.body.includes('交接文档'), 'compress prompt is Chinese handoff');

const topic = entries.find((e) => e.id === 'topicChangeSystem')!;
assert.equal(topic.body, buildTopicChangeSystemPrompt());

for (const e of entries) {
  assert.ok(e.id && e.titleZh && e.titleEn && e.source && e.body.trim(), `entry ${e.id} incomplete`);
}

console.log('hardcodedSystemPrompts.test.ts: ok', entries.length, 'entries');
