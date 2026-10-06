import assert from 'node:assert/strict';
import {
  redactSecretArgs,
  redactSecretUrl,
  isLoopbackHostname,
  isInsecureRemoteMcpUrl,
  isSecretName,
} from './dist/index.js';

const r = (args) => redactSecretArgs(args);

// Header-style values.
assert.deepEqual(r(['--header', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.x.y']), ['--header', 'Authorization: ']);
assert.deepEqual(r(['-H', 'X-API-Key: abc123']), ['-H', 'X-API-Key: ']);
assert.deepEqual(r(['--header=Cookie: sid=1']), ['--header=Cookie: ']);
assert.deepEqual(r(['--header', 'Proxy-Authorization: Basic Zm9v']), ['--header', 'Proxy-Authorization: ']);
assert.deepEqual(r(['--header', 'Accept: application/json']), ['--header', 'Accept: application/json']);
// Non-secret header whose value is a token.
assert.deepEqual(r(['--header', 'X-Foo: sk-live-abc']), ['--header', 'X-Foo: ']);
assert.deepEqual(r(['Authorization: Bearer abc']), ['Authorization: ']);
assert.deepEqual(r(['Bearer abc.def']), ['Bearer ']);
// Bearer flags.
assert.deepEqual(r(['--bearer=sk-live-123']), ['--bearer=']);
assert.deepEqual(r(['--bearer', 'plainvalue']), ['--bearer', '']);
// Short and exact password flags (space, =, and glued).
assert.deepEqual(r(['-p', 'hunter2']), ['-p', '']);
assert.deepEqual(r(['-p', '8080']), ['-p', '8080']);
assert.deepEqual(r(['-p=hunter2']), ['-p=']);
assert.deepEqual(r(['-p=8080']), ['-p=8080']);
assert.deepEqual(r(['-phunter2']), ['-p']);
assert.deepEqual(r(['--password', 'hunter2']), ['--password', '']);
assert.deepEqual(r(['--passwd=x']), ['--passwd=']);
assert.deepEqual(r(['--pass', 'x']), ['--pass', '']);
assert.deepEqual(r(['--pass=secret']), ['--pass=']);
// pass / session / sig must redact (regression from the pass-through exemption).
assert.deepEqual(
  r(['--pass=x', '--session=abc', '--session_id=sid', '--session-id=sid2', '--sig=deadbeef']),
  ['--pass=', '--session=', '--session_id=', '--session-id=', '--sig='],
);
assert.equal(isSecretName('--pass'), true);
assert.equal(isSecretName('--session_id'), true);
assert.equal(isSecretName('--sig'), true);
assert.equal(isSecretName('--pass-through'), false);
assert.equal(isSecretName('--sort-key'), false);
// Whole-word names.
assert.deepEqual(r(['--token=abc', '--api-key', 'k', '--apiKey=v', '--client-secret', 's', '--auth', 'a']),
  ['--token=', '--api-key', '', '--apiKey=', '--client-secret', '', '--auth', '']);
assert.deepEqual(r(['API_TOKEN=abc', 'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_x']), ['API_TOKEN=', 'GITHUB_PERSONAL_ACCESS_TOKEN=']);
// NAME=value with an embedded token-like value (name itself not secret).
assert.deepEqual(r(['ENDPOINT=sk-live-1', 'NAME=hello']), ['ENDPOINT=', 'NAME=hello']);
// URL credentials inside an arg value.
assert.deepEqual(
  r(['--endpoint=https://user:pass@host/x?token=abc', 'https://x?session=1']),
  ['--endpoint=https://host/x?token=', 'https://x/?session='],
);
// No false positives.
assert.deepEqual(
  r(['--monkey=banana', '--pass-through', 'yes', '--credentials-file', '/tmp/c.json', '--token-env', 'MY_TOKEN', '--keyboard', 'us', '--sort-key=name', '--key=secret']),
  ['--monkey=banana', '--pass-through', 'yes', '--credentials-file', '/tmp/c.json', '--token-env', 'MY_TOKEN', '--keyboard', 'us', '--sort-key=name', '--key='],
);
assert.deepEqual(r(['-y', '@modelcontextprotocol/server-filesystem', '/Users/me']), ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me']);
// Flag followed by another flag: nothing blanked.
assert.deepEqual(r(['--token', '--verbose']), ['--token', '--verbose']);
// Bare token-like values.
assert.deepEqual(r(['sk-abc', 'ghp_abc', 'eyJhbGciOiJIUzI1NiJ9.e30.sig', 'hello']), ['', '', '', 'hello']);
assert.equal(isSecretName('--secret-key-file'), false);
assert.equal(isSecretName('--secret'), true);

// URL query keys: whole-word + plural/compound fallback (args stay whole-word).
assert.match(redactSecretUrl('https://h/x?pass=secret&session=1&sig=ab&token=t&keep=1'), /pass=&/);
assert.match(redactSecretUrl('https://h/x?pass=secret&session=1&sig=ab&token=t&keep=1'), /session=&/);
assert.match(redactSecretUrl('https://h/x?pass=secret&session=1&sig=ab&token=t&keep=1'), /sig=&/);
assert.match(redactSecretUrl('https://h/x?pass=secret&session=1&sig=ab&token=t&keep=1'), /token=&/);
assert.match(redactSecretUrl('https://h/x?pass=secret&session=1&sig=ab&token=t&keep=1'), /keep=1/);
{
  const u = redactSecretUrl('https://h/x?tokens=a&apikeys=b&keys=c&sessions=d&passphrase=hunter&keep=1');
  assert.match(u, /tokens=&/);
  assert.match(u, /apikeys=&/);
  assert.match(u, /keys=&/);
  assert.match(u, /sessions=&/);
  assert.match(u, /passphrase=&/);
  assert.match(u, /keep=1/);
}
assert.equal(redactSecretUrl('https://h/x?pass_through=1'), 'https://h/x?pass_through=1');
assert.equal(redactSecretUrl('https://h/x?sort_key=name'), 'https://h/x?sort_key=name');
// Args still whole-word: plurals as flag names are uncommon; --pass-through / --sort-key stay.
assert.deepEqual(r(['--pass-through', 'yes', '--sort-key=name']), ['--pass-through', 'yes', '--sort-key=name']);

// Loopback.
for (const h of ['localhost', '[::1]', '::1', '127.0.0.1', '127.1.2.3', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '::ffff:7f00:1']) {
  assert.equal(isLoopbackHostname(h), true, h);
}
for (const h of ['127.evil.com', '[::ffff:10.0.0.1]', '[::ffff:a00:1]', '10.0.0.1', '[::2]', 'localhost.evil.com']) {
  assert.equal(isLoopbackHostname(h), false, h);
}
assert.equal(isInsecureRemoteMcpUrl('http://[::ffff:127.0.0.1]:3000/mcp'), false);
assert.equal(isInsecureRemoteMcpUrl('http://[::ffff:10.0.0.1]:3000/mcp'), true);

console.log('mcp.test.mjs: ok');
