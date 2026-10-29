import assert from 'node:assert/strict';
import {
  COMPRESS_HANDOFF_SECTION_HEADINGS,
  buildCompressHandoffSystemPrompt,
  buildCompressHandoffUserPrompt,
  stripCompressHandoffPreamble,
} from './compressHandoffPrompt.js';
import { formatSessionSummarySection } from './instructions.js';

const system = buildCompressHandoffSystemPrompt(2000);
assert.match(system, /交接文档/);
assert.match(system, /另一个（或同一个）模型/);
assert.doesNotMatch(system, /会话摘要器/);
assert.match(system, /不要写成干瘪的流水账摘要/);
for (const h of COMPRESS_HANDOFF_SECTION_HEADINGS) {
  assert.ok(system.includes(h), `missing heading ${h}`);
}
assert.match(system, /2000/);

const first = buildCompressHandoffUserPrompt('', 'hello delta');
assert.match(first, /旧交接文档：（无，这是首次压缩）/);
assert.match(first, /新掉出最近窗口的对话增量：/);
assert.match(first, /hello delta/);

const merged = buildCompressHandoffUserPrompt('目标：\n继续', 'more');
assert.match(merged, /旧交接文档：\n目标：/);
assert.match(merged, /more/);

assert.equal(stripCompressHandoffPreamble('摘要：目标：\n无'), '目标：\n无');
assert.equal(stripCompressHandoffPreamble('交接文档：约定：\n- x'), '约定：\n- x');
assert.equal(stripCompressHandoffPreamble('handoff document:其他：\n无'), '其他：\n无');
assert.equal(stripCompressHandoffPreamble('```md\n目标：\n无\n```'), '目标：\n无');

const section = formatSessionSummarySection('目标：\n无');
assert.match(section, /更早对话交接文档/);
assert.doesNotMatch(section, /更早对话摘要（/);

console.log('compressHandoffPrompt.test.ts: ok');
