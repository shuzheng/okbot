import assert from 'node:assert/strict';
import { listOwnerResourceMediaRefsFromMarkdown } from './generateImage.js';

const md = [
  '小狗头像已经生成好了',
  '',
  '![一只可爱的小狗](/v1/media/bot_20261008_001/resources/cf48a96585824edc84979cf0f0f430db.jpg)',
  '',
  '另见图 ![x](https://example.com/nope.png)',
].join('\n');

const refs = listOwnerResourceMediaRefsFromMarkdown(md);
assert.equal(refs.length, 1);
assert.equal(refs[0]!.ownerId, 'bot_20261008_001');
assert.equal(refs[0]!.fileName, 'cf48a96585824edc84979cf0f0f430db.jpg');
assert.equal(refs[0]!.title, '一只可爱的小狗');
assert.equal(
  refs[0]!.assetRel,
  'bot_20261008_001/resources/cf48a96585824edc84979cf0f0f430db.jpg',
);

const empty = listOwnerResourceMediaRefsFromMarkdown('no images');
assert.equal(empty.length, 0);

console.log('listOwnerResourceMediaRefs.test.ts: ok');
