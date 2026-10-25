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
  parseChangelogEntry,
  readUpdaterPrefs,
  shouldShowUpdatePrompt,
  shouldShowWhatsNew,
  writeUpdaterPrefs,
} from './changelog';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.join(here, '..', 'changelogs', '0.12.0.json');
const indexPath = path.join(here, '..', 'changelogs', 'index.json');

assert.ok(fs.existsSync(seedPath), 'bundled 0.12.0.json missing');
assert.ok(fs.existsSync(indexPath), 'bundled index.json missing');

const raw = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as unknown;
const entry = parseChangelogEntry(raw);
assert.ok(entry, 'seed must parse');
assert.equal(entry!.version, '0.12.0');
assert.equal(entry!.forceUpdate, false);
assert.ok(entry!.notes.en.title.includes('0.12.0'));
assert.ok(entry!.notes.zh?.title.includes('0.12.0'));
assert.ok(entry!.notes.en.highlights.length >= 3);
assert.ok(entry!.notes.zh!.highlights.length >= 3);
assert.ok(entry!.notes.en.bodyMarkdown.includes('multi-instance'));
assert.ok(entry!.notes.zh!.bodyMarkdown.includes('多实例'));

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

markWhatsNewSeen(tmp, '0.12.0');
assert.equal(readUpdaterPrefs(tmp).lastSeenWhatsNewVersion, '0.12.0');

dismissUpdatePrompt(tmp, '0.13.0');
assert.equal(readUpdaterPrefs(tmp).updatePromptDismissedFor, '0.13.0');

assert.equal(shouldShowUpdatePrompt(tmp, '0.13.0', false), false);
assert.equal(shouldShowUpdatePrompt(tmp, '0.13.0', true), true); // force ignores dismiss
assert.equal(shouldShowUpdatePrompt(tmp, '0.14.0', false), true);

assert.equal(readUpdaterPrefs(tmp).lastSeenWhatsNewVersion, '0.12.0');
assert.equal(shouldShowWhatsNew(tmp, '0.12.0'), false);
assert.equal(shouldShowWhatsNew(tmp, '0.13.0'), false); // no bundled file for 0.13.0
writeUpdaterPrefs(tmp, { lastSeenWhatsNewVersion: '', updatePromptDismissedFor: '0.13.0' });
assert.equal(shouldShowWhatsNew(tmp, '0.12.0'), true);

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as unknown;
assert.ok(Array.isArray(index) && index[0] === '0.12.0');

assert.deepEqual(loadBundledChangelogIndex(), ['0.12.0', '0.11.0']);
const historyZh = listBundledChangelogs('zh');
assert.equal(historyZh.length, 2);
assert.equal(historyZh[0]!.version, '0.12.0');
assert.equal(historyZh[0]!.lang, 'zh');
assert.equal(historyZh[1]!.version, '0.11.0');
const whats = getBundledWhatsNew('0.12.0', 'en');
assert.ok(whats);
assert.equal(whats!.title, entry!.notes.en.title);
assert.equal(getBundledWhatsNew('0.0.0', 'en'), null);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('changelog.test.ts: ok');
