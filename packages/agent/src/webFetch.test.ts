import assert from 'node:assert/strict';
import http from 'node:http';
import {
  assertUrlAllowed,
  htmlToReadableText,
  isBlockedHostnameLiteral,
  isBlockedResolvedAddress,
  ipv4FromMappedIpv6,
  ipv4FromCompatibleIpv6,
  readBodyLimited,
  webFetch,
  formatWebFetchToolOutput,
  wrapUntrustedWebContent,
  UNTRUSTED_WEB_FENCE_OPEN,
  UNTRUSTED_WEB_FENCE_CLOSE,
} from './webFetch.js';

assert.equal(isBlockedHostnameLiteral('localhost'), true);
assert.equal(isBlockedHostnameLiteral('127.0.0.1'), true);
assert.equal(isBlockedHostnameLiteral('192.168.1.1'), true);
assert.equal(isBlockedHostnameLiteral('10.0.0.5'), true);
assert.equal(isBlockedHostnameLiteral('172.16.0.1'), true);
assert.equal(isBlockedHostnameLiteral('169.254.169.254'), true);
assert.equal(isBlockedHostnameLiteral('example.com'), false);
assert.equal(isBlockedHostnameLiteral('evil.localhost'), true);
assert.equal(isBlockedHostnameLiteral('localhost.'), true);
assert.equal(isBlockedHostnameLiteral('[::1]'), true);
assert.equal(isBlockedHostnameLiteral('[::ffff:127.0.0.1]'), true);
assert.equal(isBlockedHostnameLiteral('127.0.0.2'), true);

assert.equal(isBlockedResolvedAddress('8.8.8.8', 4), false);
assert.equal(isBlockedResolvedAddress('10.1.2.3', 4), true);
assert.equal(isBlockedResolvedAddress('::1', 6), true);

// IPv4-mapped IPv6: dotted + hex forms
assert.equal(ipv4FromMappedIpv6('::ffff:10.0.0.1'), '10.0.0.1');
assert.equal(ipv4FromMappedIpv6('::ffff:a00:1'), '10.0.0.1');
assert.equal(ipv4FromMappedIpv6('::ffff:7f00:1'), '127.0.0.1');
assert.equal(ipv4FromMappedIpv6('::ffff:c0a8:1'), '192.168.0.1');
assert.equal(isBlockedHostnameLiteral('::ffff:a00:1'), true);
assert.equal(isBlockedHostnameLiteral('::ffff:7f00:1'), true);
assert.equal(isBlockedHostnameLiteral('[::ffff:a00:1]'), true);
assert.equal(isBlockedResolvedAddress('::ffff:a00:1', 6), true);
assert.equal(isBlockedResolvedAddress('::ffff:0808:0808', 6), false); // 8.8.8.8

// IPv4-compatible IPv6 (deprecated, no ffff): ::7f00:1 / ::127.0.0.1
assert.equal(ipv4FromCompatibleIpv6('::7f00:1'), '127.0.0.1');
assert.equal(ipv4FromCompatibleIpv6('::127.0.0.1'), '127.0.0.1');
assert.equal(ipv4FromCompatibleIpv6('::ffff:7f00:1'), null); // mapped, not compatible
assert.equal(isBlockedHostnameLiteral('::7f00:1'), true);
assert.equal(isBlockedHostnameLiteral('::127.0.0.1'), true);
assert.equal(isBlockedHostnameLiteral('[::7f00:1]'), true);
assert.equal(isBlockedResolvedAddress('::7f00:1', 6), true);
assert.equal(isBlockedResolvedAddress('::127.0.0.1', 6), true);

const html = htmlToReadableText(
  '<html><head><title>Hi &amp; Bye</title><style>x{}</style></head><body><h1>Hello</h1><p>World<br/>Two</p><script>alert(1)</script></body></html>',
);
assert.equal(html.title, 'Hi & Bye');
assert.match(html.text, /Hello/);
assert.match(html.text, /World/);
assert.doesNotMatch(html.text, /alert/);

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

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
  assert.match(out, new RegExp(UNTRUSTED_WEB_FENCE_OPEN));
  assert.match(out, new RegExp(UNTRUSTED_WEB_FENCE_CLOSE));
  assert.match(out, /不可信/);
}

await assert.rejects(
  () =>
    webFetch('http://127.0.0.1/', { allowPrivateNetwork: false }, {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      fetchImpl: (async () => new Response('nope')) as typeof fetch,
    }),
  /SSRF|内网|本机/,
);

await assert.rejects(
  () =>
    webFetch('https://evil.example/', { allowPrivateNetwork: false }, {
      lookup: async () => [{ address: '10.0.0.9', family: 4 }],
      fetchImpl: (async () => new Response('nope')) as typeof fetch,
    }),
  /SSRF|内网/,
);

// Multi-A: any private address blocks the whole set
await assert.rejects(
  () =>
    webFetch('https://mixed.example/', { allowPrivateNetwork: false }, {
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.9', family: 4 },
      ],
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

// readBodyLimited: truncate without RangeError when keep > 0
{
  const encoder = new TextEncoder();
  const chunk1 = encoder.encode('aaaa');
  const chunk2 = encoder.encode('bbbbbbbb');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk1);
      controller.enqueue(chunk2);
      controller.close();
    },
  });
  const res = new Response(stream, { status: 200 });
  const { bytes, truncated } = await readBodyLimited(res, 6);
  assert.equal(truncated, true);
  assert.equal(bytes.byteLength, 6);
  assert.equal(new TextDecoder().decode(bytes), 'aaaabb');
}

{
  const wrapped = wrapUntrustedWebContent('hello');
  assert.match(wrapped, /不可信/);
  assert.ok(wrapped.includes(UNTRUSTED_WEB_FENCE_OPEN));
  assert.ok(wrapped.includes('hello'));
  assert.ok(wrapped.includes(UNTRUSTED_WEB_FENCE_CLOSE));
}


// Real pin-path (no fetchImpl): local slow/large body + redirect must not deadlock
// on agent.close. Use hostname + single-A pin so undici/Node call lookup with
// `{ all: true }` (IP literals skip custom lookup and would miss that bug).
{
  const payload = Buffer.alloc(512 * 1024, 0x61); // 512 KiB
  const server = http.createServer((req, res) => {
    if (req.url === '/redir') {
      res.writeHead(302, { Location: '/final' });
      res.end('redirect-body-should-be-cancelled');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': String(payload.length),
    });
    let sent = 0;
    const tick = () => {
      if (sent >= payload.length) {
        res.end();
        return;
      }
      const n = Math.min(32 * 1024, payload.length - sent);
      const chunk = payload.subarray(sent, sent + n);
      sent += n;
      res.write(chunk, () => setTimeout(tick, 2));
    };
    tick();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  let raceTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      webFetch(`http://localhost:${port}/redir`, { allowPrivateNetwork: true }, {
        timeoutMs: 15_000,
        maxBytes: 64 * 1024, // truncate so readBodyLimited cancels remainder
        // Force pins.length===1 while host stays a hostname (not an IP literal).
        lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      }),
      new Promise<never>((_, rej) => {
        raceTimer = setTimeout(
          () => rej(new Error('pin-path deadlock: timed out waiting for webFetch')),
          12_000,
        );
      }),
    ]);
    assert.equal(result.status, 200);
    assert.equal(result.finalUrl, `http://localhost:${port}/final`);
    assert.equal(result.truncated, true);
    assert.ok(result.text.length > 0);
    assert.match(result.text, /^a+/);
  } finally {
    if (raceTimer !== undefined) clearTimeout(raceTimer);
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
}

// Trailing-dot / bracket forms rejected at assertUrlAllowed
{
  await assert.rejects(
    () => assertUrlAllowed('http://localhost./x', false, publicLookup),
    /SSRF|内网|本机/,
  );
  await assert.rejects(
    () => assertUrlAllowed('http://[::1]/', false, publicLookup),
    /SSRF|内网|本机/,
  );
  await assert.rejects(
    () => assertUrlAllowed('http://[::ffff:127.0.0.1]/', false, publicLookup),
    /SSRF|内网|本机/,
  );
  await assert.rejects(
    () => assertUrlAllowed('http://127.0.0.2/', false, publicLookup),
    /SSRF|内网|本机/,
  );
}

// Manual redirect must re-check: public → loopback Location is blocked
await assert.rejects(
  () =>
    webFetch('https://evil.example/start', { allowPrivateNetwork: false }, {
      lookup: publicLookup,
      fetchImpl: (async (_url, init) => {
        const u = String(_url);
        if (u.includes('/start')) {
          return new Response(null, {
            status: 302,
            headers: { Location: 'http://127.0.0.1/secret' },
          });
        }
        return new Response('should-not-reach', { status: 200 });
      }) as typeof fetch,
    }),
  /SSRF|内网|本机/,
);

console.log('webFetch.test.ts: ok');
