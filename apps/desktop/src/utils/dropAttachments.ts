import type { AttachKind } from '../features/chat/ComposerAttachMenu';

/** Image extensions accepted by the native image picker (`pickPaths('image')`). */
export const ATTACH_IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
]);

export type DroppedAttachment = {
  kind: AttachKind;
  path: string;
  name: string;
};

type ElectronFileLike = File & { path?: string };

function basenameOf(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) || norm : norm;
}

function extOf(filePath: string): string {
  const base = basenameOf(filePath);
  const i = base.lastIndexOf('.');
  if (i <= 0 || i === base.length - 1) return '';
  return base.slice(i + 1).toLowerCase();
}

/** Classify a local path the same way the attach menu would (folder / image filter / file). */
export function classifyAttachPath(
  filePath: string,
  opts?: { isDirectory?: boolean },
): AttachKind {
  if (opts?.isDirectory) return 'folder';
  if (ATTACH_IMAGE_EXTENSIONS.has(extOf(filePath))) return 'image';
  return 'file';
}

export function dataTransferHasFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  return Array.from(dt.types ?? []).includes('Files');
}

type PathResolver = (file: File) => string;

function resolveFilePath(file: File | null | undefined, getPathForFile?: PathResolver): string {
  if (!file) return '';
  if (typeof getPathForFile === 'function') {
    try {
      const via = getPathForFile(file);
      if (typeof via === 'string' && via.trim()) return via.trim();
    } catch {
      // Fall through to legacy File.path (older Electron / tests).
    }
  }
  const legacy = (file as ElectronFileLike).path;
  return typeof legacy === 'string' && legacy.trim() ? legacy.trim() : '';
}

type DropItemLike = {
  kind: string;
  getAsFile: () => File | null;
  webkitGetAsEntry?: () => { isDirectory: boolean; isFile: boolean } | null;
};

/**
 * Collect dropped local paths for the composer attachment pipeline.
 * Directories stay as a single `folder` attachment (same as the folder picker).
 * Items without a resolvable absolute path are skipped (browser / no Electron path API).
 */
export function collectDroppedAttachments(
  dt: DataTransfer,
  opts?: { getPathForFile?: PathResolver },
): DroppedAttachment[] {
  const getPathForFile = opts?.getPathForFile;
  const out: DroppedAttachment[] = [];
  const seen = new Set<string>();

  const push = (filePath: string, isDirectory: boolean) => {
    const path = filePath.trim();
    if (!path || seen.has(path)) return;
    seen.add(path);
    out.push({
      kind: classifyAttachPath(path, { isDirectory }),
      path,
      name: basenameOf(path),
    });
  };

  const items = dt.items;
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as DropItemLike | undefined;
      if (!item || item.kind !== 'file') continue;
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      const file = item.getAsFile();
      const path = resolveFilePath(file, getPathForFile);
      if (!path) continue;
      push(path, Boolean(entry?.isDirectory));
    }
    return out;
  }

  for (const file of Array.from(dt.files ?? [])) {
    const path = resolveFilePath(file, getPathForFile);
    if (!path) continue;
    // files list has no directory flag; treat as file/image by extension only.
    push(path, false);
  }
  return out;
}
