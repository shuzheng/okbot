/** Per-assistant resources library (资料库) — metadata in resources.jsonl. */

import { createUlid, isUlid } from './tasks.js';

/**
 * Concrete resource types. Prefer extension-like values (`md`, `pdf`, `png`)
 * or `note` | `url` | `folder`. Do NOT use vague `file` / `image`.
 */
export type OwnerResourceType = string;

export type OwnerResourceCreatedBy = 'user' | 'assistant';

/**
 * One line in `~/.okbot/data/<ownerId>/resources.jsonl`.
 *
 * `path` convention (single field for all kinds):
 * - ingested copy → absolute path under that owner's `resources/` dir
 * - external folder/file link → absolute path (no copy)
 * - `type === 'url'` → the URL string itself (http/https), not a filesystem path
 */
export type OwnerResourceRecord = {
  id: string;
  type: OwnerResourceType;
  /** Default: filename / folder name; for URL prefer crawled title, else URL. */
  title?: string;
  path: string;
  /** Optional originating chat message id (assistant-private; no sourceSessionId). */
  sourceMessageId?: string;
  createdBy: OwnerResourceCreatedBy;
  createdAt: string;
  updatedAt: string;
  /** Optional; may be omitted in early builds. */
  tags?: string[];
};

/** UI / IPC list row: record + light derived fields (not persisted). */
export type OwnerResourceInfo = OwnerResourceRecord & {
  /** Display title fallback. */
  name: string;
  /** Guessed MIME for thumbs / preview routing. */
  mime?: string;
  /** Bytes when path is a local file we can stat; omitted for url / missing. */
  size?: number;
  /** `<ownerId>/resources/<fileName>` when ingested under resources/. */
  assetRel?: string;
  /** True when `path` is a file inside the owner's resources/ directory. */
  ingested?: boolean;
};

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'heic',
  'heif',
]);
const CODE_EXTS = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'css',
  'scss',
  'less',
  'json',
  'yml',
  'yaml',
  'toml',
  'xml',
  'svg',
  'py',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'rb',
  'php',
  'sh',
  'bash',
  'zsh',
  'sql',
  'r',
  'swift',
  'lua',
  'pl',
]);
const TEXT_EXTS = new Set(['txt', 'log', 'csv', 'tsv', 'ini', 'env', 'conf', 'cfg']);
const ARCHIVE_EXTS = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar']);
const OFFICE_EXTS = new Set([
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
]);
const AV_EXTS = new Set([
  'mp4',
  'webm',
  'mov',
  'mkv',
  'avi',
  'mp3',
  'wav',
  'aac',
  'm4a',
  'ogg',
  'flac',
]);

/** Normalize extension token used as `type` (jpeg→jpg, markdown→md). */
export function normalizeResourceTypeToken(raw: string): string {
  const t = (raw || '').trim().toLowerCase().replace(/^\./, '');
  if (!t) return 'txt';
  if (t === 'jpeg') return 'jpg';
  if (t === 'markdown') return 'md';
  if (t === 'htm') return 'html';
  return t;
}

/**
 * Infer concrete `type` from a filesystem path or explicit kind.
 * Never returns vague `file` / `image`.
 */
export function resourceTypeFromPath(
  filePathOrUrl: string,
  kind?: 'url' | 'folder' | 'note',
): OwnerResourceType {
  if (kind === 'url') return 'url';
  if (kind === 'folder') return 'folder';
  if (kind === 'note') return 'note';
  const s = (filePathOrUrl || '').trim();
  if (/^https?:\/\//i.test(s)) return 'url';
  const base = s.replace(/\\/g, '/').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return 'txt';
  return normalizeResourceTypeToken(base.slice(dot + 1));
}

export function mimeForResourceType(type: OwnerResourceType): string {
  const t = normalizeResourceTypeToken(type);
  if (t === 'url') return 'text/uri-list';
  if (t === 'folder') return 'inode/directory';
  if (t === 'md') return 'text/markdown';
  if (t === 'note' || t === 'html') return 'text/html';
  if (t === 'pdf') return 'application/pdf';
  if (t === 'txt' || t === 'log') return 'text/plain';
  if (t === 'json') return 'application/json';
  if (t === 'csv') return 'text/csv';
  if (t === 'jpg') return 'image/jpeg';
  if (IMAGE_EXTS.has(t)) return `image/${t === 'svg' ? 'svg+xml' : t}`;
  if (t === 'mp4') return 'video/mp4';
  if (t === 'webm') return 'video/webm';
  if (t === 'mp3') return 'audio/mpeg';
  if (t === 'wav') return 'audio/wav';
  if (CODE_EXTS.has(t)) return 'text/plain';
  if (TEXT_EXTS.has(t)) return 'text/plain';
  if (ARCHIVE_EXTS.has(t)) return 'application/octet-stream';
  if (OFFICE_EXTS.has(t)) return 'application/octet-stream';
  return 'application/octet-stream';
}

export function isImageResourceType(type: OwnerResourceType): boolean {
  const t = normalizeResourceTypeToken(type);
  return IMAGE_EXTS.has(t) || t === 'jpg';
}

export function isMarkdownResourceType(type: OwnerResourceType): boolean {
  const t = normalizeResourceTypeToken(type);
  return t === 'md';
}

/** HTML notes library entries (`type === 'note'`). */
export function isNoteResourceType(type: OwnerResourceType): boolean {
  return normalizeResourceTypeToken(type) === 'note';
}

/**
 * List/card display title: for notes, hide `.html` / legacy `.md` suffix.
 * Prefers `title`, else basename of path.
 */
export function resourceDisplayTitle(
  titleOrName: string | undefined,
  type: OwnerResourceType,
  pathOrUrl?: string,
): string {
  const t = normalizeResourceTypeToken(type);
  let raw = (titleOrName || '').trim();
  if (!raw && pathOrUrl) {
    const norm = pathOrUrl.replace(/\\/g, '/');
    raw = norm.split('/').filter(Boolean).pop() || pathOrUrl;
  }
  if (!raw) return pathOrUrl || '';
  if (t === 'note') {
    return raw.replace(/\.html?$/i, '').replace(/\.md$/i, '');
  }
  return raw;
}

/** Code / plain text preview (syntax highlight; never executed as a page). */
export function isCodeOrTextResourceType(type: OwnerResourceType): boolean {
  const t = normalizeResourceTypeToken(type);
  if (t === 'txt' || t === 'log' || t === 'csv' || t === 'tsv') return true;
  if (t === 'json' || t === 'yml' || t === 'yaml' || t === 'toml' || t === 'xml') return true;
  return CODE_EXTS.has(t);
}

export function isPdfResourceType(type: OwnerResourceType): boolean {
  return normalizeResourceTypeToken(type) === 'pdf';
}

export function isAvResourceType(type: OwnerResourceType): boolean {
  return AV_EXTS.has(normalizeResourceTypeToken(type));
}

export function isArchiveResourceType(type: OwnerResourceType): boolean {
  return ARCHIVE_EXTS.has(normalizeResourceTypeToken(type));
}

export function isOfficeResourceType(type: OwnerResourceType): boolean {
  return OFFICE_EXTS.has(normalizeResourceTypeToken(type));
}

export function isHtmlResourceType(type: OwnerResourceType): boolean {
  return normalizeResourceTypeToken(type) === 'html';
}

export function defaultTitleForResource(pathOrUrl: string, type: OwnerResourceType): string {
  const t = normalizeResourceTypeToken(type);
  if (t === 'url') {
    try {
      const u = new URL(pathOrUrl);
      return u.hostname || pathOrUrl;
    } catch {
      return pathOrUrl;
    }
  }
  const norm = pathOrUrl.replace(/\\/g, '/');
  const base = norm.split('/').filter(Boolean).pop() || pathOrUrl;
  return base;
}

export function normalizeOwnerResourceRecord(
  raw: unknown,
  index = 0,
): OwnerResourceRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const idRaw = typeof o.id === 'string' ? o.id.trim() : '';
  const id = isUlid(idRaw) ? idRaw : idRaw || `resource_${index + 1}`;
  const typeRaw =
    typeof o.type === 'string' && o.type.trim()
      ? o.type.trim()
      : typeof o.path === 'string'
        ? resourceTypeFromPath(o.path)
        : 'txt';
  const type = normalizeResourceTypeToken(typeRaw);
  // Reject vague legacy labels if somehow present.
  if (type === 'file' || type === 'image') return null;
  const pathVal = typeof o.path === 'string' ? o.path.trim() : '';
  if (!pathVal) return null;
  const createdBy: OwnerResourceCreatedBy =
    o.createdBy === 'assistant' ? 'assistant' : 'user';
  const createdAt =
    typeof o.createdAt === 'string' && o.createdAt.trim()
      ? o.createdAt.trim()
      : new Date().toISOString();
  const updatedAt =
    typeof o.updatedAt === 'string' && o.updatedAt.trim()
      ? o.updatedAt.trim()
      : createdAt;
  const title =
    typeof o.title === 'string' && o.title.trim() ? o.title.trim() : undefined;
  const sourceMessageId =
    typeof o.sourceMessageId === 'string' && o.sourceMessageId.trim()
      ? o.sourceMessageId.trim()
      : undefined;
  let tags: string[] | undefined;
  if (Array.isArray(o.tags)) {
    const cleaned = o.tags
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 32);
    if (cleaned.length) tags = cleaned;
  }
  const rec: OwnerResourceRecord = {
    id,
    type,
    path: pathVal,
    createdBy,
    createdAt,
    updatedAt,
  };
  if (title) rec.title = title;
  if (sourceMessageId) rec.sourceMessageId = sourceMessageId;
  if (tags) rec.tags = tags;
  return rec;
}

/** Mint a new record (caller persists). */
export function createOwnerResourceRecord(input: {
  id?: string;
  type?: OwnerResourceType;
  title?: string;
  path: string;
  sourceMessageId?: string;
  createdBy?: OwnerResourceCreatedBy;
  tags?: string[];
  createdAt?: string;
}): OwnerResourceRecord {
  const at = input.createdAt || new Date().toISOString();
  const pathVal = (input.path || '').trim();
  if (!pathVal) throw new Error('resource path required');
  const type = normalizeResourceTypeToken(
    input.type || resourceTypeFromPath(pathVal),
  );
  if (type === 'file' || type === 'image') {
    throw new Error('vague resource type not allowed');
  }
  const idRaw = (input.id || '').trim();
  const id = isUlid(idRaw) ? idRaw : createUlid();
  const title =
    (input.title || '').trim() || defaultTitleForResource(pathVal, type);
  const rec: OwnerResourceRecord = {
    id,
    type,
    title,
    path: pathVal,
    createdBy: input.createdBy === 'assistant' ? 'assistant' : 'user',
    createdAt: at,
    updatedAt: at,
  };
  if (input.sourceMessageId?.trim()) rec.sourceMessageId = input.sourceMessageId.trim();
  if (input.tags?.length) {
    const tags = input.tags.map((t) => t.trim()).filter(Boolean).slice(0, 32);
    if (tags.length) rec.tags = tags;
  }
  return rec;
}
