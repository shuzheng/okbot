/**
 * URL resource helpers: normalize + extract from markdown/plain text.
 */
import assert from 'node:assert/strict';
import {
  isUrlResourceType,
  listHttpUrlsFromText,
  normalizeResourceUrl,
} from './dist/resources.js';

assert.equal(isUrlResourceType('url'), true);
assert.equal(isUrlResourceType('URL'), true);
assert.equal(isUrlResourceType('note'), false);

assert.equal(
  normalizeResourceUrl('https://Example.com/Path/?q=1#frag'),
  'https://example.com/Path?q=1',
);
assert.equal(normalizeResourceUrl('https://example.com/'), 'https://example.com/');
assert.equal(normalizeResourceUrl('https://example.com/a/'), 'https://example.com/a');
assert.equal(normalizeResourceUrl('ftp://example.com'), null);
assert.equal(normalizeResourceUrl('not a url'), null);

{
  const listed = listHttpUrlsFromText(
    [
      '见 [OkBot](https://okbot-ai.com/docs) 与 https://okbot-ai.com/docs/',
      '内网 https://localhost/x 与媒体 ![x](/v1/media/bot/resources/a.png)',
      '外链 https://example.com/a.png',
    ].join('\n'),
  );
  assert.equal(listed.length, 2);
  assert.equal(listed[0].href, 'https://okbot-ai.com/docs');
  assert.equal(listed[0].title, 'OkBot');
  assert.equal(listed[1].href, 'https://example.com/a.png');
}

{
  const listed = listHttpUrlsFromText('https://ex.com/a). next');
  assert.equal(listed[0].href, 'https://ex.com/a');
}

console.log('resources.url.test.mjs: ok');
