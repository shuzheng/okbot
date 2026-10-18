import assert from 'node:assert/strict';
import {
  isOkbotAssetSrc,
  isSafeDataImageSrc,
  mediaAssetPathname,
  parseAssetRel,
  parseOwnerResourceSrc,
} from './mediaAsset';

assert.equal(isOkbotAssetSrc('okbot-asset:bot_1/resources/a.png'), true);
assert.equal(isOkbotAssetSrc('https://x/y.png'), false);

assert.equal(isSafeDataImageSrc('data:image/png;base64,aaa'), true);
assert.equal(isSafeDataImageSrc('data:image/svg+xml;base64,PHN2Zy'), true);
assert.equal(isSafeDataImageSrc('data:image/jpeg;base64,/9j/'), true);
assert.equal(isSafeDataImageSrc('data:text/html;base64,aaa'), false);
assert.equal(isSafeDataImageSrc('https://x/y.png'), false);

assert.deepEqual(parseAssetRel('bot_1/resources/bee-honey.png'), {
  assetRel: 'bot_1/resources/bee-honey.png',
  ownerId: 'bot_1',
  fileName: 'bee-honey.png',
  subdir: 'resources',
});
assert.deepEqual(parseAssetRel('bot_1/uploads/clip.png'), {
  assetRel: 'bot_1/uploads/clip.png',
  ownerId: 'bot_1',
  fileName: 'clip.png',
  subdir: 'uploads',
});
assert.equal(parseAssetRel('../etc/passwd'), null);
assert.equal(parseAssetRel('bot_1/other/x.png'), null);
assert.equal(parseAssetRel('bot_1/resources/a/b.png'), null);

assert.deepEqual(parseOwnerResourceSrc('okbot-asset:bot_1/resources/bee-honey.png'), {
  assetRel: 'bot_1/resources/bee-honey.png',
  ownerId: 'bot_1',
  fileName: 'bee-honey.png',
  subdir: 'resources',
});

assert.deepEqual(parseOwnerResourceSrc('/v1/media/bot_1/resources/bee-honey.png'), {
  assetRel: 'bot_1/resources/bee-honey.png',
  ownerId: 'bot_1',
  fileName: 'bee-honey.png',
  subdir: 'resources',
});
assert.deepEqual(parseOwnerResourceSrc('/v1/media/bot_1/uploads/clip.png'), {
  assetRel: 'bot_1/uploads/clip.png',
  ownerId: 'bot_1',
  fileName: 'clip.png',
  subdir: 'uploads',
});

assert.deepEqual(
  parseOwnerResourceSrc('http://127.0.0.1:8787/v1/media/bot_1/resources/bee-honey.png?token=abc'),
  {
    assetRel: 'bot_1/resources/bee-honey.png',
    ownerId: 'bot_1',
    fileName: 'bee-honey.png',
    subdir: 'resources',
  },
);

assert.deepEqual(
  parseOwnerResourceSrc('file:///Users/zhangshuzheng/.okbot/bot_1/resources/bee-honey.png'),
  {
    assetRel: 'bot_1/resources/bee-honey.png',
    ownerId: 'bot_1',
    fileName: 'bee-honey.png',
    subdir: 'resources',
  },
);
assert.deepEqual(
  parseOwnerResourceSrc('/Users/zhangshuzheng/.okbot/bot_1/uploads/pasted.png'),
  {
    assetRel: 'bot_1/uploads/pasted.png',
    ownerId: 'bot_1',
    fileName: 'pasted.png',
    subdir: 'uploads',
  },
);

assert.deepEqual(
  parseOwnerResourceSrc('file:///home/u/.okbot/squad_2/resources/x.webp'),
  {
    assetRel: 'squad_2/resources/x.webp',
    ownerId: 'squad_2',
    fileName: 'x.webp',
    subdir: 'resources',
  },
);

// Outside ~/.okbot/resources — not rewritten.
assert.equal(parseOwnerResourceSrc('file:///Users/zhangshuzheng/Downloads/bee-honey.png'), null);
assert.equal(parseOwnerResourceSrc('https://example.com/a.png'), null);

assert.equal(
  mediaAssetPathname('bot_1/resources/bee-honey.png'),
  '/v1/media/bot_1/resources/bee-honey.png',
);
assert.equal(
  mediaAssetPathname('bot_1/uploads/clip.png'),
  '/v1/media/bot_1/uploads/clip.png',
);
assert.equal(mediaAssetPathname('bad'), null);

console.log('mediaAsset.test.ts: ok');
