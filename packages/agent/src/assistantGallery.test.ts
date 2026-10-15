import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  galleryAssistantPackage,
  listAssistantGallery,
  loadGalleryPackageDir,
  resolveGalleryRoot,
  resetGalleryRootCache,
  GALLERY_ORDER,
} from './assistantGallery.ts';

resetGalleryRootCache();
const root = resolveGalleryRoot();
assert.ok(fs.existsSync(path.join(root, 'order.json')), `gallery root missing order.json: ${root}`);
assert.equal(path.basename(root), 'gallery');

const zh = listAssistantGallery('zh');
const en = listAssistantGallery('en');
assert.ok(zh.length >= 3 && zh.length <= 8);
assert.equal(zh[0]!.id, 'coder');
assert.equal(zh[0]!.name, '编程助手');
assert.deepEqual(zh.map((g) => g.id), en.map((g) => g.id));
assert.deepEqual(zh.map((g) => g.id), [...GALLERY_ORDER]);
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
  const packPath = path.join(root, item.id, 'zh');
  const fromDisk = loadGalleryPackageDir(packPath);
  assert.equal(fromDisk.manifest.name, pkg!.manifest.name);
  assert.equal(fromDisk.skills.length, pkg!.skills.length);
}
assert.equal(galleryAssistantPackage('nope'), null);
console.log('assistantGallery.test.ts: ok');
