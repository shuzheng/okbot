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

/** Paths that failed JSON parse — refuse further writes until process restart or clear. */
const corruptJsonPaths = new Set<string>();

export function noteCorruptJson(file: string): void {
  corruptJsonPaths.add(path.resolve(file));
}

export function clearCorruptJson(file: string): void {
  corruptJsonPaths.delete(path.resolve(file));
}

export function isCorruptJson(file: string): boolean {
  return corruptJsonPaths.has(path.resolve(file));
}

/**
 * Throws `json_corrupt:<file>` when a prior read was invalid for this path.
 * Self-heals if the on-disk file is valid JSON again (manual fix / CLI reset).
 */
export function assertJsonWritable(file: string): void {
  const resolved = path.resolve(file);
  if (!corruptJsonPaths.has(resolved)) return;
  try {
    if (fs.existsSync(resolved)) {
      JSON.parse(fs.readFileSync(resolved, 'utf8'));
      clearCorruptJson(resolved);
      return;
    }
  } catch {
    /* still corrupt */
  }
  throw new Error(`json_corrupt:${file}`);
}


export function ensureDir(dir: string) {
  assertWritable(dir);
  fs.mkdirSync(dir, { recursive: true });
}

export function writeText(file: string, text: string): void {
  assertWritable(file);
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
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
    const data = JSON.parse(text) as T;
    clearCorruptJson(file);
    return { status: 'ok', data };
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

/**
 * On invalid JSON: backup once, mark path corrupt (blocks writeJson), log.
 * Returns true when status was invalid (caller should use in-memory fallback only).
 */
export function handleCorruptJsonRead(
  file: string,
  status: ReadJsonResult<unknown>['status'],
  error: string | undefined,
  label: string,
): boolean {
  if (status !== 'invalid') return false;
  if (!isCorruptJson(file)) {
    const backup = backupFileAside(file, 'corrupt');
    noteCorruptJson(file);
    const detail = backup
      ? `${label} 无法解析（${error || 'invalid'}）。已备份到 ${backup}，未覆盖原文件。`
      : `${label} 无法解析（${error || 'invalid'}）。未能写入备份；未覆盖原文件。`;
    console.error('[okbot]', detail);
  } else {
    noteCorruptJson(file);
  }
  return true;
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


export type ResetCorruptJsonResult =
  | { ok: true; restored: 'backup' | 'fallback'; backupPath?: string }
  | { ok: false; error: string; code?: 'not_corrupt' };

/**
 * Explicit recovery for a path that is invalid on disk (or force-overwritten):
 * 1) refuse when the current file is valid JSON unless `opts.force` (then backupAside first);
 * 2) try newest readable `*.corrupt.*` aside backup;
 * 3) else write `fallback` JSON.
 * Always clearCorruptJson on success so subsequent writeJson works without restart.
 * Missing files are treated as recoverable (write fallback / restore backup).
 */
export function resetCorruptJsonFile(
  file: string,
  fallback: unknown,
  opts?: { force?: boolean },
): ResetCorruptJsonResult {
  const resolved = path.resolve(file);
  const dir = path.dirname(resolved);
  const base = path.basename(resolved);

  let onDiskValid = false;
  if (fs.existsSync(resolved)) {
    try {
      JSON.parse(fs.readFileSync(resolved, 'utf8'));
      onDiskValid = true;
    } catch {
      onDiskValid = false;
    }
  }

  if (onDiskValid && !opts?.force) {
    return {
      ok: false,
      code: 'not_corrupt',
      error: 'not_corrupt: file is valid JSON; refuse overwrite without force',
    };
  }

  try {
    // Drop the block first so writeJson / writeText can proceed.
    clearCorruptJson(resolved);
    if (onDiskValid && opts?.force) {
      backupFileAside(resolved, 'reset-force');
    }
    if (fs.existsSync(dir)) {
      const prefix = `${base}.corrupt.`;
      const candidates = fs
        .readdirSync(dir)
        .filter((n) => n.startsWith(prefix))
        .map((n) => path.join(dir, n))
        .sort();
      for (let i = candidates.length - 1; i >= 0; i--) {
        const cand = candidates[i]!;
        try {
          const text = fs.readFileSync(cand, 'utf8');
          JSON.parse(text);
          writeText(resolved, text);
          clearCorruptJson(resolved);
          return { ok: true, restored: 'backup', backupPath: cand };
        } catch {
          /* try older backup */
        }
      }
    }
    writeJson(resolved, fallback);
    clearCorruptJson(resolved);
    return { ok: true, restored: 'fallback' };
  } catch (err) {
    noteCorruptJson(resolved);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function writeJson(file: string, data: unknown, opts?: { mode?: number }) {
  assertWritable(file);
  assertJsonWritable(file);
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
