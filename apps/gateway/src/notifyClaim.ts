import os from 'node:os';

/**
 * One system notification per event per device.
 *
 * Every window (desktop, attach window, browser gateway page) gets the same run
 * events. Before it shows a notification, a window claims the tag here. The first
 * claim from a device wins for `windowMs`; other windows of that device skip it.
 * Desktop IPC and loopback HTTP are the device `local`. A gateway page opened via
 * this host's LAN address is also `local` (same computer). Other peers are keyed
 * by their address so a phone still gets its own notification.
 */
const DEFAULT_WINDOW_MS = 5000;
const OWN_ADDR_TTL_MS = 30_000;
const claims = new Map<string, number>();

/** Host IPv4/IPv6 addresses (no zone id). Refreshed on a TTL so DHCP / VPN changes apply. */
let ownAddresses: Set<string> | null = null;
let ownAddressesAt = 0;

export function refreshOwnAddresses(now = Date.now()): void {
  const next = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list || []) {
      const a = (info.address || '').split('%')[0]?.toLowerCase();
      if (a) next.add(a);
    }
  }
  ownAddresses = next;
  ownAddressesAt = now;
}

function isOwnAddress(addr: string, now = Date.now()): boolean {
  if (!ownAddresses || now - ownAddressesAt >= OWN_ADDR_TTL_MS) refreshOwnAddresses(now);
  return ownAddresses!.has(addr.toLowerCase());
}

export function notifyDeviceKey(remoteAddress: string | undefined, now = Date.now()): string {
  const a = (remoteAddress || '').trim();
  if (!a || a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1') return 'local';
  const v4 = a.replace(/^::ffff:/i, '').toLowerCase();
  if (v4 === '127.0.0.1' || isOwnAddress(v4, now) || isOwnAddress(a, now)) return 'local';
  return v4;
}

export function claimNotify(device: string, tag: string, now = Date.now(), windowMs = DEFAULT_WINDOW_MS): boolean {
  const t = String(tag || '').slice(0, 200);
  if (!t) return true;
  for (const [k, at] of claims) {
    if (now - at >= windowMs) claims.delete(k);
  }
  const key = `${device}\n${t}`;
  const at = claims.get(key);
  if (at != null && now - at < windowMs) return false;
  claims.set(key, now);
  return true;
}
