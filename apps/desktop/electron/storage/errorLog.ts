import fs from 'node:fs';
import path from 'node:path';
import { redactSensitiveText } from '@okbot/shared';
import { ensureDir } from './fs';

export type ErrorLogPhase = 'chatStart' | 'resumeHitl' | 'squadChat';

export type ErrorLogEntry = {
  ts: string;
  ownerId: string;
  messageId?: string;
  phase: ErrorLogPhase;
  error: string;
  stack?: string;
};

/** Local calendar date as YYYY-MM-DD for error log filenames. */
export function localDateYyyyMmDdDashed(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const ERRORS_FILE_RE = /^errors-(\d{4}-\d{2}-\d{2})\.jsonl$/;

function parseYmdDashed(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(y, mo - 1, d);
}

/** Keep today + previous 2 calendar days; delete older `errors-YYYY-MM-DD.jsonl`. */
export function pruneErrorLogs(logsDir: string, now = new Date()): void {
  let names: string[];
  try {
    names = fs.readdirSync(logsDir);
  } catch {
    return;
  }
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cutoff.setDate(cutoff.getDate() - 2); // oldest day to keep
  for (const name of names) {
    const match = ERRORS_FILE_RE.exec(name);
    if (!match) continue;
    const fileDate = parseYmdDashed(match[1]!);
    if (!fileDate) continue;
    if (fileDate < cutoff) {
      try {
        fs.unlinkSync(path.join(logsDir, name));
      } catch (err) {
        console.error('[okbot] prune error log failed', name, err);
      }
    }
  }
}

/**
 * Append one structured SDK/run error under `~/.okbot/logs/errors-YYYY-MM-DD.jsonl`.
 * Does not log secrets or user prompt text. Still call `console.error` separately.
 */
export function appendErrorLog(
  root: string,
  entry: {
    ownerId: string;
    messageId?: string;
    phase: ErrorLogPhase;
    error: unknown;
  },
): void {
  try {
    const logsDir = path.join(root, 'logs');
    ensureDir(logsDir);
    pruneErrorLogs(logsDir);

    const errObj = entry.error;
    const message =
      errObj instanceof Error
        ? errObj.message || String(errObj)
        : typeof errObj === 'string'
          ? errObj
          : String(errObj);
    const stack = errObj instanceof Error && errObj.stack ? errObj.stack : undefined;
    const record: ErrorLogEntry = {
      ts: new Date().toISOString(),
      ownerId: entry.ownerId,
      ...(entry.messageId ? { messageId: entry.messageId } : {}),
      phase: entry.phase,
      error: redactSensitiveText(message),
      ...(stack ? { stack: redactSensitiveText(stack) } : {}),
    };
    const file = path.join(logsDir, `errors-${localDateYyyyMmDdDashed()}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    console.error('[okbot] appendErrorLog failed', err);
  }
}

/** Read newest error-log lines (across retained daily files), newest first. */
export function readRecentErrorLog(
  root: string,
  limit = 50,
): ErrorLogEntry[] {
  const logsDir = path.join(root, 'logs');
  let names: string[];
  try {
    names = fs.readdirSync(logsDir).filter((n) => ERRORS_FILE_RE.test(n));
  } catch {
    return [];
  }
  names.sort(); // YYYY-MM-DD ascending
  const out: ErrorLogEntry[] = [];
  for (const name of names.reverse()) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(logsDir, name), 'utf8');
    } catch {
      continue;
    }
    const lines = raw.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const row = JSON.parse(lines[i]!) as ErrorLogEntry;
        if (row && typeof row.error === 'string') out.push(row);
      } catch {
        /* skip bad line */
      }
      if (out.length >= limit) return out;
    }
  }
  return out;
}
