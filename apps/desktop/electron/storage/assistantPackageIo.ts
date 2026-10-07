import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  assistantPackageToFileMap,
  parseAssistantPackage,
  type AssistantPackageContents,
} from '@okbot/agent';

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

/** Write package contents to a directory (manifest + AGENTS.md + skills/). */
export function writeAssistantPackageDir(
  dir: string,
  pkg: AssistantPackageContents,
): void {
  ensureDir(dir);
  const files = assistantPackageToFileMap(pkg);
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, body, 'utf8');
  }
}

const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const MAX_PACKAGE_ENTRIES = 200;
const MAX_PACKAGE_FILE_BYTES = 1_000_000;

function assertSafePackageTree(dir: string): void {
  let count = 0;
  const walk = (current: string) => {
    for (const name of fs.readdirSync(current)) {
      count += 1;
      if (count > MAX_PACKAGE_ENTRIES) throw new Error('助手包条目过多');
      const abs = path.join(current, name);
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) throw new Error('助手包包含符号链接，已拒绝');
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!st.isFile()) throw new Error('助手包包含不支持的文件类型');
      if (st.size > MAX_PACKAGE_FILE_BYTES) throw new Error('助手包内文件过大');
    }
  };
  walk(dir);
}

function readRegularFile(abs: string): string {
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink()) throw new Error('助手包包含符号链接，已拒绝');
  if (!st.isFile()) throw new Error('助手包文件类型不对');
  if (st.size > MAX_PACKAGE_FILE_BYTES) throw new Error('助手包内文件过大');
  return fs.readFileSync(abs, 'utf8');
}

function assertArchiveListing(file: string): void {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('助手包不是文件');
  if (stat.size > MAX_PACKAGE_BYTES) throw new Error('助手包过大');
  let listing = '';
  try {
    listing = execFileSync('unzip', ['-Z', '-1', file], {
      encoding: 'utf8',
      maxBuffer: 2_000_000,
    });
  } catch {
    throw new Error('无法读取助手包（需要系统 unzip）');
  }
  const lines = listing.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length > MAX_PACKAGE_ENTRIES) throw new Error('助手包条目过多');
  for (const line of lines) {
    if (line.includes('\\') || line.startsWith('/') || /^[A-Za-z]:/.test(line)) {
      throw new Error('助手包路径不合法');
    }
    const normalized = line.replace(/\/+$/, '');
    if (!normalized) continue;
    if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('助手包路径不合法');
    }
  }
  // Zip bomb: reject when declared uncompressed total exceeds the package cap
  // before extracting. `unzip -l` ends with a Length total and "N file(s)".
  try {
    const longList = execFileSync('unzip', ['-l', file], {
      encoding: 'utf8',
      maxBuffer: 4_000_000,
    });
    // Info-ZIP variants:
    //   "       12  10-07-26 16:47   name"  or  "       12  10-07-2026 16:47   name"
    // footer: "       12                     1 file"  (or with compressed col on some builds)
    const totalMatch = /\n\s*-+[^\n]*\n\s*(\d+)\s+(?:\d+\s+)?\d+\s+files?\s*$/i.exec(
      longList,
    );
    if (totalMatch) {
      const uncompressed = Number(totalMatch[1]);
      if (Number.isFinite(uncompressed) && uncompressed > MAX_PACKAGE_BYTES) {
        throw new Error('助手包解压后过大');
      }
    }
    for (const row of longList.split(/\r?\n/)) {
      const m = /^\s*(\d+)\s+\d{2}-\d{2}-(?:\d{2}|\d{4})\s+\d{1,2}:\d{2}\s+(.+)$/.exec(
        row,
      );
      if (!m) continue;
      const len = Number(m[1]);
      const name = m[2]!.trim();
      if (!name || name.endsWith('/')) continue;
      if (Number.isFinite(len) && len > MAX_PACKAGE_FILE_BYTES) {
        throw new Error('助手包内文件过大');
      }
    }
  } catch (err) {
    if (err instanceof Error && /助手包/.test(err.message)) throw err;
    // If unzip -l is unavailable, path/entry checks above still apply; extract
    // path runs assertSafePackageTree afterward.
  }
}

/** Read package from a directory. */
export function readAssistantPackageDir(dir: string): AssistantPackageContents {
  const root = path.resolve(dir);
  assertSafePackageTree(root);
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('助手包缺少 manifest.json');
  }
  const manifest = JSON.parse(readRegularFile(manifestPath)) as unknown;
  let agentsMd = '';
  const agentsPath = path.join(root, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    agentsMd = readRegularFile(agentsPath);
  }
  const skillFiles: Array<{ slug: string; raw: string }> = [];
  const skillsRoot = path.join(root, 'skills');
  if (fs.existsSync(skillsRoot)) {
    const skillsStat = fs.lstatSync(skillsRoot);
    if (skillsStat.isSymbolicLink()) throw new Error('助手包包含符号链接，已拒绝');
    if (skillsStat.isDirectory()) {
      for (const name of fs.readdirSync(skillsRoot)) {
        const skillDir = path.join(skillsRoot, name);
        const dirStat = fs.lstatSync(skillDir);
        if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
          if (dirStat.isSymbolicLink()) throw new Error('助手包包含符号链接，已拒绝');
          continue;
        }
        const skillFile = path.join(skillDir, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;
        skillFiles.push({ slug: name, raw: readRegularFile(skillFile) });
      }
    }
  }
  return parseAssistantPackage({ manifest, agentsMd, skillFiles });
}

/** Zip a package directory into a .okbot file (zip archive). */
export function zipAssistantPackage(dir: string, outFile: string): void {
  const absDir = path.resolve(dir);
  const absOut = path.resolve(outFile);
  ensureDir(path.dirname(absOut));
  if (fs.existsSync(absOut)) fs.rmSync(absOut, { force: true });
  // zip contents (not the parent folder name) so unzip lands as manifest.json at root
  execFileSync('zip', ['-r', '-q', absOut, '.'], { cwd: absDir });
}

/** Unzip .okbot into a temp dir and parse. */
export function readAssistantPackageArchive(file: string): AssistantPackageContents {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error('助手包文件不存在');
  assertArchiveListing(abs);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-pkg-'));
  try {
    execFileSync('unzip', ['-q', '-o', abs, '-d', tmp]);
    assertSafePackageTree(tmp);
    // Support either flat root or single top-level folder
    const manifestDirect = path.join(tmp, 'manifest.json');
    if (fs.existsSync(manifestDirect)) {
      return readAssistantPackageDir(tmp);
    }
    const kids = fs.readdirSync(tmp).filter((n) => !n.startsWith('.'));
    for (const k of kids) {
      const cand = path.join(tmp, k);
      if (fs.statSync(cand).isDirectory() && fs.existsSync(path.join(cand, 'manifest.json'))) {
        return readAssistantPackageDir(cand);
      }
    }
    throw new Error('助手包内未找到 manifest.json');
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
