import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dismissUpdatePrompt,
  getBundledWhatsNew,
  listBundledChangelogs,
  loadBundledChangelogIndex,
  localizeChangelog,
  markWhatsNewSeen,
  ensureWhatsNewBaseline,
  parseChangelogEntry,
  readUpdaterPrefs,
  shouldShowUpdatePrompt,
  shouldShowWhatsNew,
  writeUpdaterPrefs,
} from './changelog';

const here = path.dirname(fileURLToPath(import.meta.url));
const changelogsDir = path.join(here, '..', 'changelogs');
const indexPath = path.join(changelogsDir, 'index.json');

assert.ok(fs.existsSync(indexPath), 'bundled index.json missing');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as unknown;
assert.ok(Array.isArray(index) && index.length >= 1 && typeof index[0] === 'string');
const latestVersion = String(index[0]);
const seedPath = path.join(changelogsDir, `${latestVersion}.json`);
assert.ok(fs.existsSync(seedPath), `bundled ${latestVersion}.json missing`);

const raw = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as unknown;
const entry = parseChangelogEntry(raw);
assert.ok(entry, 'seed must parse');
assert.equal(entry!.version, latestVersion);
assert.equal(typeof entry!.forceUpdate, 'boolean');
assert.ok(entry!.notes.en.title.includes(latestVersion));
assert.ok((entry!.notes.zh?.title || '').length > 0);
assert.ok(entry!.notes.en.highlights.length >= 1);
assert.ok((entry!.notes.zh?.highlights.length || 0) >= 1);
assert.ok(entry!.notes.en.bodyMarkdown.length > 0);
assert.ok((entry!.notes.zh?.bodyMarkdown || '').length > 0);

const en = localizeChangelog(entry!, 'en');
assert.equal(en.lang, 'en');
assert.equal(en.title, entry!.notes.en.title);

const zh = localizeChangelog(entry!, 'zh');
assert.equal(zh.lang, 'zh');
assert.equal(zh.title, entry!.notes.zh!.title);

// Fallback to en when zh missing
const enOnly = parseChangelogEntry({
  version: '9.9.9',
  releasedAt: '2026-01-01T00:00:00Z',
  forceUpdate: true,
  notes: { en: { title: 'Only EN', highlights: ['a'], bodyMarkdown: 'body' } },
});
assert.ok(enOnly);
const zhFallback = localizeChangelog(enOnly!, 'zh');
assert.equal(zhFallback.lang, 'en');
assert.equal(zhFallback.title, 'Only EN');
assert.equal(zhFallback.forceUpdate, true);

assert.equal(parseChangelogEntry(null), null);
assert.equal(parseChangelogEntry({ version: '1.0.0' }), null);
assert.equal(parseChangelogEntry({ version: '', notes: { en: { title: 'x', highlights: [], bodyMarkdown: '' } } }), null);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-updater-prefs-'));
writeUpdaterPrefs(tmp, { lastSeenWhatsNewVersion: '', updatePromptDismissedFor: '' });
assert.deepEqual(readUpdaterPrefs(tmp), {
  lastSeenWhatsNewVersion: '',
  updatePromptDismissedFor: '',
});

// First install (empty lastSeen): do not show What's New.
assert.equal(shouldShowWhatsNew(tmp, latestVersion), false);
assert.equal(readUpdaterPrefs(tmp).lastSeenWhatsNewVersion, '');

// Silent baseline seed (startup path) — still no dialog, but upgrades can show later.
ensureWhatsNewBaseline(tmp, latestVersion);
assert.equal(readUpdaterPrefs(tmp).lastSeenWhatsNewVersion, latestVersion);
assert.equal(shouldShowWhatsNew(tmp, latestVersion), false);
// Idempotent.
ensureWhatsNewBaseline(tmp, latestVersion);
assert.equal(readUpdaterPrefs(tmp).lastSeenWhatsNewVersion, latestVersion);

markWhatsNewSeen(tmp, latestVersion);
assert.equal(readUpdaterPrefs(tmp).lastSeenWhatsNewVersion, latestVersion);

dismissUpdatePrompt(tmp, '0.13.0');
assert.equal(readUpdaterPrefs(tmp).updatePromptDismissedFor, '0.13.0');

assert.equal(shouldShowUpdatePrompt(tmp, '0.13.0', false), false);
assert.equal(shouldShowUpdatePrompt(tmp, '0.13.0', true), true); // force ignores dismiss
assert.equal(shouldShowUpdatePrompt(tmp, '0.14.0', false), true);

assert.equal(readUpdaterPrefs(tmp).lastSeenWhatsNewVersion, latestVersion);
assert.equal(shouldShowWhatsNew(tmp, latestVersion), false);
assert.equal(shouldShowWhatsNew(tmp, '0.0.0'), false); // no bundled file
// Simulate upgrade: last seen older than current bundled.
writeUpdaterPrefs(tmp, { lastSeenWhatsNewVersion: '0.0.1', updatePromptDismissedFor: '0.13.0' });
assert.equal(shouldShowWhatsNew(tmp, latestVersion), true);

const loadedIndex = loadBundledChangelogIndex();
assert.ok(loadedIndex.length >= 1);
assert.equal(loadedIndex[0], latestVersion);
const historyZh = listBundledChangelogs('zh');
assert.equal(historyZh.length, loadedIndex.length);
assert.equal(historyZh[0]!.version, latestVersion);
assert.equal(historyZh[0]!.lang, 'zh');
const whats = getBundledWhatsNew(latestVersion, 'en');
assert.ok(whats);
assert.equal(whats!.title, entry!.notes.en.title);
assert.equal(getBundledWhatsNew('0.0.0', 'en'), null);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('changelog.test.ts: ok');
