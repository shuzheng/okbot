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

/** Read package from a directory. */
export function readAssistantPackageDir(dir: string): AssistantPackageContents {
  const root = path.resolve(dir);
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('助手包缺少 manifest.json');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
  let agentsMd = '';
  const agentsPath = path.join(root, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    agentsMd = fs.readFileSync(agentsPath, 'utf8');
  }
  const skillFiles: Array<{ slug: string; raw: string }> = [];
  const skillsRoot = path.join(root, 'skills');
  if (fs.existsSync(skillsRoot)) {
    for (const name of fs.readdirSync(skillsRoot)) {
      const skillFile = path.join(skillsRoot, name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      skillFiles.push({ slug: name, raw: fs.readFileSync(skillFile, 'utf8') });
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'okbot-pkg-'));
  try {
    execFileSync('unzip', ['-q', '-o', abs, '-d', tmp]);
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
