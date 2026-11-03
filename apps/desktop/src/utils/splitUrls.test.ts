import assert from 'node:assert/strict';
import { isHttpUrl, splitUrls } from './splitUrls';

assert.deepEqual(splitUrls(''), []);
assert.deepEqual(splitUrls('hello'), [{ kind: 'text', text: 'hello' }]);

{
  const segs = splitUrls('see https://okbot-ai.com please');
  assert.deepEqual(segs, [
    { kind: 'text', text: 'see ' },
    { kind: 'url', href: 'https://okbot-ai.com', text: 'https://okbot-ai.com' },
    { kind: 'text', text: ' please' },
  ]);
}

{
  const segs = splitUrls('https://example.com/path.');
  assert.deepEqual(segs, [
    { kind: 'url', href: 'https://example.com/path', text: 'https://example.com/path' },
    { kind: 'text', text: '.' },
  ]);
}

{
  const segs = splitUrls('go (https://ex.com/a) now');
  assert.deepEqual(segs, [
    { kind: 'text', text: 'go (' },
    { kind: 'url', href: 'https://ex.com/a', text: 'https://ex.com/a' },
    { kind: 'text', text: ')' },
    { kind: 'text', text: ' now' },
  ]);
}

{
  const segs = splitUrls('https://ex.com/a(b)');
  assert.deepEqual(segs, [
    { kind: 'url', href: 'https://ex.com/a(b)', text: 'https://ex.com/a(b)' },
  ]);
}

assert.equal(isHttpUrl('https://x.com'), true);
assert.equal(isHttpUrl('http://x.com'), true);
assert.equal(isHttpUrl('mailto:a@b.c'), false);
assert.equal(isHttpUrl(undefined), false);

console.log('splitUrls.test.ts: ok');
