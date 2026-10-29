/**
 * Multi-instance CLI flags: --port and --data-dir must be both set or both omitted.
 * Desktop Electron always uses the default root (~/.okbot) and does not scan custom dirs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultOkbotRoot } from '../storage/okbotLayout';
import { parsePort } from './parse';
import type { CliMessages } from './i18n';

export type InstanceFlagError =
  | 'both_required'
  | 'invalid_port'
  | 'invalid_data_dir'
  | 'unknown_flag';

export type ParsedInstanceFlags =
  | {
      ok: true;
      /** null = use default ~/.okbot */
      dataDir: string | null;
      /** null = use that data dir's server.json port (default 18765) */
      port: number | null;
      rest: string[];
    }
  | { ok: false; error: InstanceFlagError; detail?: string };

/** Expand leading ~ to the home directory; leave other paths unchanged. */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~' + path.sep)) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** Resolve okbot root: default ~/.okbot, or absolute path for a custom --data-dir. */
export function resolveOkbotRoot(dataDir: string | null | undefined): string {
  if (dataDir == null || dataDir === '') return defaultOkbotRoot();
  return path.resolve(expandHome(dataDir.trim()));
}

/**
 * Parse `--port N` and `--data-dir PATH` from command args.
 * Both must appear together, or neither. Unknown flags are returned in `rest`
 * only when parsing succeeds with neither/both; a lone unknown flag with one
 * of the pair still fails the both-required check first.
 */
export function parseInstanceFlags(args: string[]): ParsedInstanceFlags {
  let portRaw: string | undefined;
  let dataDirRaw: string | undefined;
  let sawPort = false;
  let sawDataDir = false;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const t = args[i]!;
    if (t === '--port') {
      sawPort = true;
      portRaw = args[++i];
      continue;
    }
    if (t.startsWith('--port=')) {
      sawPort = true;
      portRaw = t.slice('--port='.length);
      continue;
    }
    if (t === '--data-dir') {
      sawDataDir = true;
      dataDirRaw = args[++i];
      continue;
    }
    if (t.startsWith('--data-dir=')) {
      sawDataDir = true;
      dataDirRaw = t.slice('--data-dir='.length);
      continue;
    }
    rest.push(t);
  }

  if (sawPort !== sawDataDir) {
    return { ok: false, error: 'both_required' };
  }

  if (!sawPort && !sawDataDir) {
    return { ok: true, dataDir: null, port: null, rest };
  }

  const port = parsePort(portRaw);
  if (port == null) {
    return { ok: false, error: 'invalid_port', detail: portRaw };
  }

  const dataDir = typeof dataDirRaw === 'string' ? dataDirRaw.trim() : '';
  if (!dataDir) {
    return { ok: false, error: 'invalid_data_dir', detail: dataDirRaw };
  }

  // Reject obviously bad paths (empty after expand is already caught).
  // Do not require the directory to exist yet — FileStorage will create it.
  try {
    const resolved = resolveOkbotRoot(dataDir);
    // If it exists, it must be a directory (or we will create a new root).
    if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) {
      return { ok: false, error: 'invalid_data_dir', detail: dataDirRaw };
    }
  } catch {
    return { ok: false, error: 'invalid_data_dir', detail: dataDirRaw };
  }

  return { ok: true, dataDir, port, rest };
}

/** True when this resolved root is the product default (~/.okbot). */
export function isDefaultOkbotRoot(root: string): boolean {
  return path.resolve(root) === path.resolve(defaultOkbotRoot());
}

/** Print a clear error for bad --port/--data-dir combinations; returns exit code 1. */
export function reportInstanceFlagError(t: CliMessages, error: InstanceFlagError): number {
  if (error === 'both_required') console.error(t.instanceBothRequired);
  else if (error === 'invalid_port') console.error(t.instanceInvalidPort);
  else if (error === 'invalid_data_dir') console.error(t.instanceInvalidDataDir);
  else console.error(t.instanceBothRequired);
  return 1;
}

/**
 * Optional `--data-dir PATH` for commands that do not need `--port`
 * (token / config / data). Returns remaining args with the flag removed.
 */
export function peelDataDirFlag(args: string[]): {
  ok: true;
  dataDir: string | null;
  rest: string[];
} | { ok: false; error: 'invalid_data_dir'; detail?: string } {
  let dataDirRaw: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!;
    if (t === '--data-dir') {
      dataDirRaw = args[++i];
      continue;
    }
    if (t.startsWith('--data-dir=')) {
      dataDirRaw = t.slice('--data-dir='.length);
      continue;
    }
    rest.push(t);
  }
  if (dataDirRaw === undefined) {
    return { ok: true, dataDir: null, rest };
  }
  const dataDir = typeof dataDirRaw === 'string' ? dataDirRaw.trim() : '';
  if (!dataDir) return { ok: false, error: 'invalid_data_dir', detail: dataDirRaw };
  try {
    const resolved = resolveOkbotRoot(dataDir);
    if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) {
      return { ok: false, error: 'invalid_data_dir', detail: dataDirRaw };
    }
  } catch {
    return { ok: false, error: 'invalid_data_dir', detail: dataDirRaw };
  }
  return { ok: true, dataDir, rest };
}
