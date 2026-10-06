import fs from 'node:fs';
import path from 'node:path';

/**
 * Owner directories deleted in this process. Every storage write goes through
 * `assertWritable` (via `ensureDir`, `writeJson`, `writeText`, `appendText`), so a
 * run that finishes after its assistant or squad was deleted cannot recreate the
 * directory. Owner ids are never reused, so the set only grows.
 */
const deletedDirs = new Set<string>();

export function markDirDeleted(dir: string): void {
  deletedDirs.add(path.resolve(dir));
}

export function isInDeletedDir(target: string): boolean {
  if (deletedDirs.size === 0) return false;
  const p = path.resolve(target);
  for (const d of deletedDirs) {
    if (p === d || p.startsWith(d + path.sep)) return true;
  }
  return false;
}

export function assertWritable(target: string): void {
  if (isInDeletedDir(target)) throw new Error('owner_deleted');
}

export function ensureDir(dir: string) {
  assertWritable(dir);
  fs.mkdirSync(dir, { recursive: true });
}

export function writeText(file: string, text: string): void {
  assertWritable(file);
  fs.writeFileSync(file, text, 'utf8');
}

export function appendText(file: string, text: string): void {
  assertWritable(file);
  fs.appendFileSync(file, text, 'utf8');
}

export type ReadJsonResult<T> =
  | { status: 'missing'; data: T }
  | { status: 'ok'; data: T }
  | { status: 'invalid'; data: T; error: string };

/** Read JSON; never throws. Distinguishes missing vs parse/IO failure. */
export function readJsonResult<T>(file: string, fallback: T): ReadJsonResult<T> {
  try {
    if (!fs.existsSync(file)) return { status: 'missing', data: fallback };
    const text = fs.readFileSync(file, 'utf8');
    return { status: 'ok', data: JSON.parse(text) as T };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { status: 'invalid', data: fallback, error };
  }
}

export function readJson<T>(file: string, fallback: T): T {
  return readJsonResult(file, fallback).data;
}

/** Copy `file` aside before overwrite. Returns backup path or null. */
export function backupFileAside(file: string, tag: string): string | null {
  try {
    if (!fs.existsSync(file)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${file}.${tag}.${stamp}`;
    fs.copyFileSync(file, backup);
    return backup;
  } catch (err) {
    console.error('[okbot] backupFileAside failed', file, err);
    return null;
  }
}

export function unquoteYamlScalar(v: string): string {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    try {
      return JSON.parse(s.startsWith("'") ? `"${s.slice(1, -1)}"` : s) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

export function writeJson(file: string, data: unknown, opts?: { mode?: number }) {
  assertWritable(file);
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  const body = JSON.stringify(data, null, 2);
  if (opts?.mode != null) {
    fs.writeFileSync(tmp, body, { encoding: 'utf8', mode: opts.mode });
  } else {
    fs.writeFileSync(tmp, body, 'utf8');
  }
  fs.renameSync(tmp, file);
  if (opts?.mode != null) {
    try {
      fs.chmodSync(file, opts.mode);
    } catch (err) {
      console.error('[okbot] chmod after writeJson failed', file, err);
    }
  }
}
