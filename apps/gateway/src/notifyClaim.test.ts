import assert from 'node:assert/strict';
import { claimNotify, notifyDeviceKey, refreshOwnAddresses } from './notifyClaim';

assert.equal(notifyDeviceKey('::ffff:127.0.0.1'), 'local');
assert.equal(notifyDeviceKey(undefined), 'local');
assert.equal(notifyDeviceKey('::ffff:192.0.2.7'), '192.0.2.7');
// Desktop window and loopback gateway page: one notification.
assert.equal(claimNotify('local', 'bot_1:reply', 1000), true);
assert.equal(claimNotify('local', 'bot_1:reply', 1500), false);
// Another device still notifies.
assert.equal(claimNotify('192.0.2.7', 'bot_1:reply', 1500), true);
// A later event of the same tag notifies again.
assert.equal(claimNotify('local', 'bot_1:reply', 7000), true);
console.log('notifyClaim.test.ts: ok');

{
  // Same machine via a LAN address maps to local (refresh once for the test).
  refreshOwnAddresses();
  const os = await import('node:os');
  let lan: string | undefined;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list || []) {
      if (info.family === 'IPv4' && !info.internal) { lan = info.address; break; }
    }
    if (lan) break;
  }
  if (lan) {
    assert.equal(notifyDeviceKey(lan), 'local');
    assert.equal(notifyDeviceKey(`::ffff:${lan}`), 'local');
  }
}

{
  // ownAddresses refresh on a TTL (simulate by forcing a refresh after clearing).
  refreshOwnAddresses(0);
  const first = notifyDeviceKey('127.0.0.1', 1);
  assert.equal(first, 'local');
  refreshOwnAddresses(60_000);
  assert.equal(notifyDeviceKey('::ffff:127.0.0.1', 60_000), 'local');
}
