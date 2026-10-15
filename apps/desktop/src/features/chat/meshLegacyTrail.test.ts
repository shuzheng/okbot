import assert from 'node:assert/strict';

/** Mirrors ChatTranscript isLegacyMeshTrailBubble ask-line detection. */
const LEGACY_MESH_ASK_RE = /^向\s*@?.+?\s*求助[：:]/;

assert.ok(LEGACY_MESH_ASK_RE.test('向 @翻译助手 求助：\n把英文'));
assert.ok(LEGACY_MESH_ASK_RE.test('向 翻译助手 求助：把英文'));
assert.ok(LEGACY_MESH_ASK_RE.test('向@翻译助手 求助: hello'));
assert.equal(LEGACY_MESH_ASK_RE.test('已发消息给: 翻译助手'), false);
assert.equal(LEGACY_MESH_ASK_RE.test('翻译结果：你好'), false);
assert.equal(LEGACY_MESH_ASK_RE.test('我请翻译助手看了，结果是…'), false);

console.log('meshLegacyTrail.test.ts: ok');
