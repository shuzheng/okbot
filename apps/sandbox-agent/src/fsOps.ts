import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';

const MAX_FILE_BYTES = 200_000;
const MAX_TOOL_OUTPUT = 24_000;

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
  return p;
}

function truncate(text: string, max = MAX_TOOL_OUTPUT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…(truncated, ${text.length} chars)`;
}

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8000));
  let weird = 0;
  for (const b of sample) {
    if (b === 0) return true;
    if (b < 7 || (b > 13 && b < 32)) weird += 1;
  }
  return weird / sample.length > 0.3;
}

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf',
  '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm',
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.wav', '.ogg',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.sqlite', '.db', '.dmg', '.pkg', '.app',
]);

export async function readTextFile(filePath: string): Promise<string> {
  const resolved = path.resolve(expandHome(filePath.trim()));
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error(`not a regular file: ${resolved}`);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`file too large (${stat.size} bytes, max ${MAX_FILE_BYTES}): ${resolved}`);
  }
  const buf = await fs.readFile(resolved);
  if (looksBinary(buf)) throw new Error(`binary file refused: ${resolved}`);
  return truncate(`path: ${resolved}\n\n${buf.toString('utf8')}`);
}

export async function writeTextFile(filePath: string, content: string): Promise<string> {
  const resolved = path.resolve(expandHome(filePath.trim()));
  const ext = path.extname(resolved).toLowerCase();
  if (BINARY_EXTS.has(ext)) {
    throw new Error(`binary extension refused (${ext}): ${resolved}`);
  }
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const buf = Buffer.from(content, 'utf8');
  await fs.writeFile(resolved, buf, 'utf8');
  return `wrote ${resolved} (${buf.byteLength} bytes / ${content.length} chars)`;
}

export async function editTextFile(
  filePath: string,
  oldText: string,
  newText: string,
): Promise<string> {
  const resolved = path.resolve(expandHome(filePath.trim()));
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') throw new Error(`file not found: ${resolved}`);
    throw err;
  }
  if (!stat.isFile()) throw new Error(`not a regular file: ${resolved}`);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`file too large (${stat.size} bytes, max ${MAX_FILE_BYTES}): ${resolved}`);
  }
  const buf = await fs.readFile(resolved);
  if (looksBinary(buf)) throw new Error(`binary file refused: ${resolved}`);
  const original = buf.toString('utf8');
  if (!oldText) throw new Error('old_text must not be empty');
  let count = 0;
  let idx = 0;
  while (true) {
    const found = original.indexOf(oldText, idx);
    if (found === -1) break;
    count += 1;
    idx = found + oldText.length;
  }
  if (count === 0) throw new Error(`old_text not found, unchanged: ${resolved}`);
  if (count > 1) {
    throw new Error(`old_text matched ${count} times; provide a more unique old_text: ${resolved}`);
  }
  const updated = original.replace(oldText, () => newText);
  const out = Buffer.from(updated, 'utf8');
  await fs.writeFile(resolved, out, 'utf8');
  return `edited ${resolved} (1 replacement; now ${out.byteLength} bytes / ${updated.length} chars)`;
}
