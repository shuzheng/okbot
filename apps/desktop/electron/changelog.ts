import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ChangelogEntry,
  ChangelogLang,
  LocalizedChangelogNotes,
} from '@okbot/shared';

const REMOTE_CHANGELOG_URL = (version: string) =>
  `https://github.com/shuzheng/okbot/releases/download/v${version}/changelog.json`;

/** Directory of bundled changelog JSON (packaged extraResources or source tree). */
export function resolveChangelogDir(): string {
  // Prefer a directory that already has index.json so packaged, electron-vite
  // (out/main bundle), and plain Node tests all resolve without Electron APIs.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const resourcesPath =
    typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  const candidates = [
    resourcesPath ? path.join(resourcesPath, 'changelogs') : '',
    path.join(here, '..', 'changelogs'), // source: electron/../changelogs
    path.join(here, '..', '..', 'changelogs'), // bundle: out/main → apps/desktop/changelogs
    path.join(process.cwd(), 'changelogs'),
    path.join(process.cwd(), 'apps', 'desktop', 'changelogs'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.json'))) return dir;
  }
  return candidates.find(Boolean) || path.join(here, '..', 'changelogs');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function normalizeLocaleNotes(raw: unknown): ChangelogEntry['notes']['en'] | null {
  if (!isRecord(raw)) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const bodyMarkdown = typeof raw.bodyMarkdown === 'string' ? raw.bodyMarkdown : '';
  const highlights = Array.isArray(raw.highlights)
    ? raw.highlights.filter((h): h is string => typeof h === 'string' && h.trim().length > 0).map((h) => h.trim())
    : [];
  if (!title && !bodyMarkdown && highlights.length === 0) return null;
  return {
    title: title || 'Changelog',
    highlights,
    bodyMarkdown,
  };
}

/** Parse / clamp a changelog.json payload (bundled or remote). */
export function parseChangelogEntry(raw: unknown): ChangelogEntry | null {
  if (!isRecord(raw)) return null;
  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  if (!version) return null;
  const notesRaw = isRecord(raw.notes) ? raw.notes : null;
  if (!notesRaw) return null;
  const en = normalizeLocaleNotes(notesRaw.en);
  if (!en) return null;
  const zh = normalizeLocaleNotes(notesRaw.zh) ?? undefined;
  const releasedAt =
    typeof raw.releasedAt === 'string' && raw.releasedAt.trim()
      ? raw.releasedAt.trim()
      : new Date().toISOString();
  return {
    version,
    releasedAt,
    forceUpdate: raw.forceUpdate === true,
    notes: zh ? { en, zh } : { en },
  };
}

export function localizeChangelog(
  entry: ChangelogEntry,
  lang: ChangelogLang,
): LocalizedChangelogNotes {
  const notes = (lang === 'zh' ? entry.notes.zh : undefined) ?? entry.notes.en;
  const resolvedLang: ChangelogLang = lang === 'zh' && entry.notes.zh ? 'zh' : 'en';
  return {
    version: entry.version,
    releasedAt: entry.releasedAt,
    forceUpdate: entry.forceUpdate === true,
    lang: resolvedLang,
    title: notes.title,
    highlights: [...notes.highlights],
    bodyMarkdown: notes.bodyMarkdown,
  };
}

export function loadBundledChangelogEntry(version: string): ChangelogEntry | null {
  const file = path.join(resolveChangelogDir(), `${version}.json`);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    const entry = parseChangelogEntry(raw);
    if (!entry || entry.version !== version) return null;
    return entry;
  } catch {
    return null;
  }
}

/** Newest-first version ids from bundled index.json. */
export function loadBundledChangelogIndex(): string[] {
  const file = path.join(resolveChangelogDir(), 'index.json');
  try {
    if (!fs.existsSync(file)) return [];
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      const v = item.trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  } catch {
    return [];
  }
}

export function listBundledChangelogs(lang: ChangelogLang): LocalizedChangelogNotes[] {
  const versions = loadBundledChangelogIndex();
  const out: LocalizedChangelogNotes[] = [];
  for (const version of versions) {
    const entry = loadBundledChangelogEntry(version);
    if (!entry) continue;
    out.push(localizeChangelog(entry, lang));
  }
  return out;
}

export function getBundledWhatsNew(
  currentVersion: string,
  lang: ChangelogLang,
): LocalizedChangelogNotes | null {
  const entry = loadBundledChangelogEntry(currentVersion);
  if (!entry) return null;
  return localizeChangelog(entry, lang);
}

/**
 * Fetch release changelog.json for an available update.
 * Offline / 404 / parse failure → null (caller treats as version-only soft).
 */
export async function fetchRemoteChangelog(
  version: string,
  timeoutMs = 8_000,
): Promise<ChangelogEntry | null> {
  const v = version.trim();
  if (!v) return null;
  const url = REMOTE_CHANGELOG_URL(v);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as unknown;
    const entry = parseChangelogEntry(raw);
    if (!entry) return null;
    // Prefer the update version from the updater when the asset omits/mismatches.
    if (entry.version !== v) {
      return { ...entry, version: v };
    }
    return entry;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const PREFS_FILE = 'updater-prefs.json';

export type UpdaterPrefs = {
  lastSeenWhatsNewVersion: string;
  /** Soft-update only: version whose prompt the user dismissed. */
  updatePromptDismissedFor: string;
};

export function defaultUpdaterPrefs(): UpdaterPrefs {
  return { lastSeenWhatsNewVersion: '', updatePromptDismissedFor: '' };
}

export function readUpdaterPrefs(userDataPath: string): UpdaterPrefs {
  const file = path.join(userDataPath, PREFS_FILE);
  try {
    if (!fs.existsSync(file)) return defaultUpdaterPrefs();
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    return {
      lastSeenWhatsNewVersion:
        typeof raw.lastSeenWhatsNewVersion === 'string' ? raw.lastSeenWhatsNewVersion.trim() : '',
      updatePromptDismissedFor:
        typeof raw.updatePromptDismissedFor === 'string' ? raw.updatePromptDismissedFor.trim() : '',
    };
  } catch {
    return defaultUpdaterPrefs();
  }
}

export function writeUpdaterPrefs(userDataPath: string, prefs: UpdaterPrefs): void {
  const file = path.join(userDataPath, PREFS_FILE);
  const next: UpdaterPrefs = {
    lastSeenWhatsNewVersion: prefs.lastSeenWhatsNewVersion.trim(),
    updatePromptDismissedFor: prefs.updatePromptDismissedFor.trim(),
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export function markWhatsNewSeen(userDataPath: string, version: string): UpdaterPrefs {
  const prefs = readUpdaterPrefs(userDataPath);
  prefs.lastSeenWhatsNewVersion = version.trim();
  writeUpdaterPrefs(userDataPath, prefs);
  return prefs;
}

export function dismissUpdatePrompt(userDataPath: string, version: string): UpdaterPrefs {
  const prefs = readUpdaterPrefs(userDataPath);
  prefs.updatePromptDismissedFor = version.trim();
  writeUpdaterPrefs(userDataPath, prefs);
  return prefs;
}

/**
 * First install: seed lastSeen to current without showing the dialog, so later
 * upgrades can detect last !== current. No-op when already seeded or version empty.
 */
export function ensureWhatsNewBaseline(userDataPath: string, currentVersion: string): void {
  const v = currentVersion.trim();
  if (!v) return;
  const prefs = readUpdaterPrefs(userDataPath);
  const last = (prefs.lastSeenWhatsNewVersion || '').trim();
  if (last) return;
  markWhatsNewSeen(userDataPath, v);
}

export function shouldShowWhatsNew(userDataPath: string, currentVersion: string): boolean {
  const v = currentVersion.trim();
  if (!v) return false;
  if (!loadBundledChangelogEntry(v)) return false;
  const prefs = readUpdaterPrefs(userDataPath);
  const last = (prefs.lastSeenWhatsNewVersion || '').trim();
  // First install (never seen any What's New): do not pop the upgrade sheet.
  // Caller must ensureWhatsNewBaseline so upgrades later can show.
  if (!last) return false;
  return last !== v;
}

export function shouldShowUpdatePrompt(
  userDataPath: string,
  availableVersion: string | undefined,
  forceUpdate: boolean,
): boolean {
  const v = (availableVersion || '').trim();
  if (!v) return false;
  if (forceUpdate) return true;
  const prefs = readUpdaterPrefs(userDataPath);
  return prefs.updatePromptDismissedFor !== v;
}
