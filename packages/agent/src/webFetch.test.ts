import assert from 'node:assert/strict';
import {
  htmlToReadableText,
  isBlockedHostnameLiteral,
  isBlockedResolvedAddress,
  webFetch,
  formatWebFetchToolOutput,
} from './webFetch.js';

assert.equal(isBlockedHostnameLiteral('localhost'), true);
assert.equal(isBlockedHostnameLiteral('127.0.0.1'), true);
assert.equal(isBlockedHostnameLiteral('192.168.1.1'), true);
assert.equal(isBlockedHostnameLiteral('10.0.0.5'), true);
assert.equal(isBlockedHostnameLiteral('172.16.0.1'), true);
assert.equal(isBlockedHostnameLiteral('169.254.169.254'), true);
assert.equal(isBlockedHostnameLiteral('example.com'), false);
assert.equal(isBlockedHostnameLiteral('evil.localhost'), true);

assert.equal(isBlockedResolvedAddress('8.8.8.8', 4), false);
assert.equal(isBlockedResolvedAddress('10.1.2.3', 4), true);
assert.equal(isBlockedResolvedAddress('::1', 6), true);

const html = htmlToReadableText(
  '<html><head><title>Hi &amp; Bye</title><style>x{}</style></head><body><h1>Hello</h1><p>World<br/>Two</p><script>alert(1)</script></body></html>',
);
assert.equal(html.title, 'Hi & Bye');
assert.match(html.text, /Hello/);
assert.match(html.text, /World/);
assert.doesNotMatch(html.text, /alert/);

const publicLookup = async () => ({ address: '93.184.216.34', family: 4 });

{
  const result = await webFetch('https://example.com/page', { allowPrivateNetwork: false }, {
    lookup: publicLookup,
    fetchImpl: (async () =>
      new Response('<html><title>Ex</title><body><p>Hello page</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })) as typeof fetch,
  });
  assert.equal(result.title, 'Ex');
  assert.match(result.text, /Hello page/);
  const out = formatWebFetchToolOutput(result);
  assert.match(out, /Title: Ex/);
}

await assert.rejects(
  () =>
    webFetch('http://127.0.0.1/', { allowPrivateNetwork: false }, {
      lookup: async () => ({ address: '127.0.0.1', family: 4 }),
      fetchImpl: (async () => new Response('nope')) as typeof fetch,
    }),
  /SSRF|内网|本机/,
);

await assert.rejects(
  () =>
    webFetch('https://evil.example/', { allowPrivateNetwork: false }, {
      lookup: async () => ({ address: '10.0.0.9', family: 4 }),
      fetchImpl: (async () => new Response('nope')) as typeof fetch,
    }),
  /SSRF|内网/,
);

// allowPrivateNetwork bypasses SSRF literal check
{
  const result = await webFetch('http://127.0.0.1:9/x', { allowPrivateNetwork: true }, {
    fetchImpl: (async () =>
      new Response('local-ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })) as typeof fetch,
  });
  assert.match(result.text, /local-ok/);
}

console.log('webFetch.test.ts: ok');
