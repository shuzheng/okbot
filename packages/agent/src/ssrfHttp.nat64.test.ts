import assert from 'node:assert/strict';
import {
  isBlockedHostnameLiteral,
  isBlockedResolvedAddress,
  ipv4FromNat64,
  ipv4From6to4,
} from './ssrfHttp.ts';

assert.equal(ipv4FromNat64('64:ff9b::7f00:1'), '127.0.0.1');
assert.equal(ipv4FromNat64('64:ff9b::127.0.0.1'), '127.0.0.1');
assert.equal(ipv4From6to4('2002:7f00:0001::1'), '127.0.0.1');
assert.equal(ipv4From6to4('2002:a9fe:a9fe::1'), '169.254.169.254');

assert.equal(isBlockedHostnameLiteral('64:ff9b::127.0.0.1'), true);
assert.equal(isBlockedHostnameLiteral('2002:7f00:1::1'), true);
assert.equal(isBlockedResolvedAddress('64:ff9b::7f00:1', 6), true);
assert.equal(isBlockedResolvedAddress('2002:a9fe:a9fe::1', 6), true);
// Entire transition prefixes are rejected even when embedded IPv4 is public.
assert.equal(isBlockedHostnameLiteral('64:ff9b::0808:0808'), true);
assert.equal(isBlockedHostnameLiteral('2002:0808:0808::1'), true);

console.log('ssrfHttp.nat64.test.ts: ok');
