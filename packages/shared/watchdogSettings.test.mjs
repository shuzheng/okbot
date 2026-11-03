import assert from 'node:assert/strict';
import {
  DEFAULT_WATCHDOG_SETTINGS,
  normalizeWatchdogSettings,
} from './dist/settings.js';

assert.equal(DEFAULT_WATCHDOG_SETTINGS.intervalMs, 30_000);
assert.equal(DEFAULT_WATCHDOG_SETTINGS.transientRetries, 3);
assert.equal(DEFAULT_WATCHDOG_SETTINGS.enabled, true);

const d = normalizeWatchdogSettings(undefined);
assert.equal(d.intervalMs, 30_000);
assert.equal(d.transientRetries, 3);
assert.equal(d.enabled, true);

const custom = normalizeWatchdogSettings({ intervalMs: 45_000, transientRetries: 2, enabled: false });
assert.equal(custom.intervalMs, 45_000);
assert.equal(custom.transientRetries, 2);
assert.equal(custom.enabled, false);

assert.equal(normalizeWatchdogSettings({ intervalMs: 100 }).intervalMs, 5_000);
assert.equal(normalizeWatchdogSettings({ intervalMs: 999_999 }).intervalMs, 300_000);
assert.equal(normalizeWatchdogSettings({ transientRetries: 0 }).transientRetries, 1);
assert.equal(normalizeWatchdogSettings({ transientRetries: 9 }).transientRetries, 5);

console.log('watchdogSettings.test.mjs: ok');
