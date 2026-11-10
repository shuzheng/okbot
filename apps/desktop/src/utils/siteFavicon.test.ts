import assert from 'node:assert/strict';
import {
  clearFaviconCacheForTests,
  getCachedFavicon,
  probeSiteFavicon,
  siteFaviconCandidates,
  siteOriginKey,
} from './siteFavicon';

clearFaviconCacheForTests();

assert.equal(siteOriginKey('https://okbot-ai.com/path?q=1'), 'https://okbot-ai.com');
assert.equal(siteOriginKey('http://example.com:8080/a'), 'http://example.com:8080');
assert.equal(siteOriginKey('mailto:a@b.c'), null);
assert.equal(siteOriginKey('not a url'), null);
assert.equal(siteOriginKey(''), null);

assert.deepEqual(siteFaviconCandidates('https://okbot-ai.com/docs'), [
  'https://okbot-ai.com/favicon.ico',
  'https://okbot-ai.com/favicon.svg',
  'https://okbot-ai.com/apple-touch-icon.png',
]);
assert.deepEqual(siteFaviconCandidates('mailto:x@y.z'), []);

{
  // Node has no Image — probe should fail closed and cache the miss.
  clearFaviconCacheForTests();
  const result = await probeSiteFavicon('https://example.com/page');
  assert.deepEqual(result, { status: 'fail' });
  assert.deepEqual(getCachedFavicon('https://example.com'), { status: 'fail' });
  // Second call hits cache (still fail).
  const again = await probeSiteFavicon('https://example.com/other');
  assert.deepEqual(again, { status: 'fail' });
}

console.log('siteFavicon.test.ts: ok');
