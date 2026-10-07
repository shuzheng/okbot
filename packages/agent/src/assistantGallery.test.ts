import assert from 'node:assert/strict';
import { galleryAssistantPackage, listAssistantGallery } from './assistantGallery.ts';

const zh = listAssistantGallery('zh');
const en = listAssistantGallery('en');
assert.ok(zh.length >= 3 && zh.length <= 8);
assert.equal(zh[0]!.id, 'coder');
assert.equal(zh[0]!.name, '编程助手');
assert.deepEqual(zh.map((g) => g.id), en.map((g) => g.id));
assert.notEqual(zh[0]!.name, en[0]!.name);
for (const item of zh) {
  const pkg = galleryAssistantPackage(item.id, 'zh');
  assert.ok(pkg);
  assert.equal(pkg!.manifest.format, 'okbot-assistant');
  assert.ok(pkg!.agentsMd.startsWith('# '));
  for (const s of pkg!.skills) {
    assert.ok(s.slug.startsWith('okbot-'));
    assert.ok(s.name.startsWith('okbot-'));
  }
}
assert.equal(galleryAssistantPackage('nope'), null);
console.log('assistantGallery.test.ts: ok');
