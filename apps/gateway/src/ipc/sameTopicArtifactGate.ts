/**
 * Same-topic artifact host gate: reject write_file create (new path) and
 * manage_note create when a library resource already has the same filename/title.
 * Same-path overwrite and intentional edit/update stay allowed.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  isPathInsideDir,
  ownerWorkDirFromResourcesDir, resolveOwnerWorkPath,
} from '@okbot/agent';
import { resourceDisplayTitle, type OwnerResourceInfo } from '@okbot/shared';
import type { FileStorage } from '../storage';

export type SameTopicMatch = {
  id: string;
  path: string;
  title: string;
  type: string;
};

/** Normalize title/filename for same-topic compare (strip note suffixes, casefold). */
export function normalizeArtifactTopicKey(raw: string): string {
  let s = (raw || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/\\/g, '/');
  // Drop trailing extension commonly used for notes / pages.
  s = s.replace(/\.(html?|md|txt|markdown)$/i, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function resourceTopicKeys(rec: OwnerResourceInfo): string[] {
  const keys = new Set<string>();
  const display = resourceDisplayTitle(rec.title || rec.name, rec.type, rec.path);
  const k1 = normalizeArtifactTopicKey(display);
  if (k1) keys.add(k1);
  const base = path.basename((rec.path || '').replace(/\\/g, '/'));
  const k2 = normalizeArtifactTopicKey(base);
  if (k2) keys.add(k2);
  if (rec.title?.trim()) {
    const k3 = normalizeArtifactTopicKey(rec.title);
    if (k3) keys.add(k3);
  }
  return [...keys];
}

/** Find an existing resource with the same topic key (title or basename). */
export function findSameTopicResource(
  resources: OwnerResourceInfo[] | null | undefined,
  topicRaw: string,
  opts?: { types?: string[] | null },
): SameTopicMatch | null {
  const want = normalizeArtifactTopicKey(topicRaw);
  if (!want || !resources?.length) return null;
  const typeFilter = opts?.types?.map((t) => t.trim().toLowerCase()).filter(Boolean) ?? null;

  for (const r of resources) {
    if (typeFilter && typeFilter.length) {
      const t = (r.type || '').trim().toLowerCase();
      if (!typeFilter.includes(t)) continue;
    }
    const keys = resourceTopicKeys(r);
    if (keys.includes(want)) {
      return {
        id: r.id,
        path: r.path,
        title: resourceDisplayTitle(r.title || r.name, r.type, r.path),
        type: r.type,
      };
    }
  }
  return null;
}

/**
 * manage_note create: reject when a note with the same title already exists.
 * Returns a model-visible tool error string, or null to allow.
 */
export function rejectDuplicateNoteCreate(
  storage: Pick<FileStorage, 'listOwnerResources'>,
  ownerId: string,
  title: string,
): string | null {
  const id = (ownerId || '').trim();
  const t = (title || '').trim() || '未命名笔记';
  if (!id) return null;
  let list: OwnerResourceInfo[];
  try {
    list = storage.listOwnerResources(id);
  } catch (err) {
    console.error('[okbot] same-topic note gate: list failed', err);
    return null;
  }
  const hit = findSameTopicResource(list, t, { types: ['note'] });
  if (!hit) return null;
  return (
    `错误：已有同题笔记 id=${hit.id} path=${hit.path}「${hit.title}」。` +
    `请用 manage_note update（传该 id 或 path）维护同一篇，不要 create 第二份。`
  );
}

/**
 * write_file under owner resources/: allow same-path overwrite; reject create of a
 * new path when basename/title collides with an existing library resource.
 * Returns a model-visible tool error string, or null to allow.
 */
export function rejectDuplicateLibraryWrite(
  storage: Pick<FileStorage, 'listOwnerResources'>,
  ownerId: string,
  filePath: string,
  resourcesDir: string,
): string | null {
  const id = (ownerId || '').trim();
  const root = (resourcesDir || '').trim();
  const raw = (filePath || '').trim();
  if (!id || !root || !raw) return null;

  const workDir = ownerWorkDirFromResourcesDir(root);
  const abs = path.resolve(resolveOwnerWorkPath(raw, workDir || root));
  if (!isPathInsideDir(root, abs)) return null;
  if (path.resolve(abs) === path.resolve(root)) return null;

  // Intentional update: same path already on disk → allow overwrite.
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return null;
  } catch {
    /* treat as create */
  }

  let list: OwnerResourceInfo[];
  try {
    list = storage.listOwnerResources(id);
  } catch (err) {
    console.error('[okbot] same-topic write gate: list failed', err);
    return null;
  }

  const basename = path.basename(abs);
  const hit = findSameTopicResource(list, basename);
  if (!hit) return null;

  // Exact same path in the index but file missing (deleted on disk) → allow recreate.
  try {
    if (path.resolve(hit.path) === abs) return null;
  } catch {
    /* continue reject */
  }

  return (
    `错误：资料库已有同题产物 id=${hit.id} path=${hit.path} type=${hit.type}「${hit.title}」。` +
    `请用 edit_file（或对同一路径 write_file 覆盖）维护已有文件，不要新建第二份。`
  );
}

/** Bound write_file gate for buildTools assertLibraryWriteAllowed. */
export function libraryWriteGateForOwner(
  storage: Pick<FileStorage, 'listOwnerResources'>,
  ownerId: string,
  resourcesDir: string,
): (input: { filePath: string }) => string | null {
  return (input) =>
    rejectDuplicateLibraryWrite(storage, ownerId, input.filePath, resourcesDir);
}
