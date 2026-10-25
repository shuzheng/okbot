import assert from 'node:assert/strict';
import {
  isMemoryExpired,
  memoryExpiresFromNow,
  normalizeMemoryExpires,
  MEMORY_TTL_MS,
} from './dist/memoryExpiry.js';

{
  assert.equal(normalizeMemoryExpires(null), null);
  assert.equal(normalizeMemoryExpires(''), null);
  assert.equal(normalizeMemoryExpires('null'), null);
  assert.equal(normalizeMemoryExpires('not-a-date'), null);
  const iso = normalizeMemoryExpires('2026-10-21T12:00:00.000Z');
  assert.equal(iso, '2026-10-21T12:00:00.000Z');
  const fromMs = normalizeMemoryExpires(Date.parse('2026-10-21T12:00:00.000Z'));
  assert.equal(fromMs, '2026-10-21T12:00:00.000Z');
}

{
  const now = Date.parse('2026-10-21T12:00:00.000Z');
  assert.equal(isMemoryExpired(null, now), false);
  assert.equal(isMemoryExpired(undefined, now), false);
  assert.equal(isMemoryExpired('2026-10-21T11:59:59.000Z', now), true);
  assert.equal(isMemoryExpired('2026-10-21T12:00:00.000Z', now), true);
  assert.equal(isMemoryExpired('2026-10-21T12:00:01.000Z', now), false);
  assert.equal(isMemoryExpired('bogus', now), false);
}

{
  const now = Date.parse('2026-10-21T00:00:00.000Z');
  assert.equal(memoryExpiresFromNow(0, now), null);
  assert.equal(
    memoryExpiresFromNow(MEMORY_TTL_MS.short, now),
    '2026-10-22T00:00:00.000Z',
  );
}

console.log('memoryExpiry.test.ts: ok');
