import assert from 'node:assert/strict';
import { dedupeMemoryFacts, extractDurableFacts, isAcceptableMemoryFact } from './durableFacts';

const summary = `目标：
做压缩
约定：
- 回复用中文
- 无
决定：
- 不改公开仓库
其他：
寒暄
`;

{
  const facts = extractDurableFacts(summary);
  assert.deepEqual(facts, ['回复用中文', '不改公开仓库']);
}

{
  const fresh = dedupeMemoryFacts(
    ['回复用中文', '回复用中文', '新的约定：晚上不打扰'],
    ['回复用中文'],
  );
  assert.deepEqual(fresh, ['新的约定：晚上不打扰']);
}

{
  const contained = dedupeMemoryFacts(['回复用中文并且简短'], ['回复用中文并且简短一些']);
  assert.deepEqual(contained, []);
}

{
  assert.deepEqual(extractDurableFacts('## 约定\n- 用中文\n## 目标\n做别的\n'), ['用中文']);
  assert.deepEqual(extractDurableFacts('约定：A、B\n'), ['A', 'B']);
  assert.deepEqual(extractDurableFacts('## 决定：继续用 pnpm\n'), ['继续用 pnpm']);
}

{
  // Quality gate via dedupe: junk crumbs never upsert
  assert.deepEqual(dedupeMemoryFacts(['删除', '定时任务', '用中文'], []), []);
  assert.deepEqual(
    dedupeMemoryFacts(['用户偏好中文回复', '删除', 'web_search'], []),
    ['用户偏好中文回复'],
  );
  assert.equal(isAcceptableMemoryFact('用户偏好中文回复'), true);
  assert.equal(isAcceptableMemoryFact('删除'), false);
}

console.log('durableFacts.test.ts: ok');
