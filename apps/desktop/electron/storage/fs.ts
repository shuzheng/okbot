import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
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

export function writeJson(file: string, data: unknown) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
