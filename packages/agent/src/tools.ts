import { homedir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile, type ChildProcess } from 'node:child_process';
import { tool } from '@openai/agents';
import { z } from 'zod';
import type { SecuritySettings, ToolPreferences } from '@okbot/shared';
import { DEFAULT_SECURITY } from '@okbot/shared';
import { buildToolInputGuardrails, expandHome } from './guardrails.js';
import { wrapToolExecute, type ToolRunBudget } from './toolRunBudget.js';


const MAX_TOOL_OUTPUT = 24_000;
const MAX_FILE_BYTES = 200_000;
const SHELL_TIMEOUT_MS = 30_000;


export type ShellExecSpec = {
  file: string;
  args: string[];
};

export type ResolveShellExecOptions = {
  /** Resolve an executable from PATH; injectable to keep Windows behavior testable. */
  findExecutable?: (name: string) => string | null;
};

function findExecutableOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const pathValue = env.PATH ?? env.Path;
  if (!pathValue) return null;

  const pathExts = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean);
  const hasExtension = /\.[^\\/]+$/.test(name);
  const names = hasExtension ? [name] : [name, ...pathExts.map((ext) => `${name}${ext}`)];

  for (const directory of pathValue.split(';')) {
    for (const candidateName of names) {
      const candidate = path.win32.join(directory || '.', candidateName);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Pick shell binary + args for execFile (platform/env/resolver injectable for tests). */
export function resolveShellExec(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  options: ResolveShellExecOptions = {},
): ShellExecSpec {
  if (platform === 'win32') {
    const pwsh = (options.findExecutable ?? ((name) => findExecutableOnPath(name, env)))('pwsh');
    if (pwsh) return { file: pwsh, args: ['-NoProfile', '-NonInteractive', '-Command', command] };

    const file = env.ComSpec || 'cmd.exe';
    return { file, args: ['/d', '/s', '/c', command] };
  }
  const file = env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return { file, args: ['-lc', command] };
}

function truncate(text: string, max = MAX_TOOL_OUTPUT): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…(已截断，共 ${text.length} 字符)`;
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

function killShellProcessTree(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

async function runShellCommand(
  command: string,
  cwd?: string,
  signal?: AbortSignal,
): Promise<string> {
  const workdir = cwd?.trim() ? expandHome(cwd.trim()) : homedir();
  const { file: shellFile, args: shellArgs } = resolveShellExec(command);
  if (signal?.aborted) {
    return truncate(`cwd: ${workdir}\n\nshell: ${shellFile}\n\n错误: 已中止`);
  }
  try {
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = execFile(
          shellFile,
          shellArgs,
          {
            cwd: workdir,
            timeout: SHELL_TIMEOUT_MS,
            maxBuffer: 1024 * 1024,
            env: process.env,
            windowsHide: true,
            // New process group on POSIX so abort can kill the whole tree.
            ...(process.platform === 'win32' ? {} : { detached: true }),
          },
          (err, stdout, stderr) => {
            if (err) {
              (err as { stdout?: string; stderr?: string }).stdout = stdout;
              (err as { stdout?: string; stderr?: string }).stderr = stderr;
              reject(err);
              return;
            }
            resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
          },
        );
        const onAbort = () => killShellProcessTree(child);
        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        }
        child.on('exit', () => {
          signal?.removeEventListener('abort', onAbort);
        });
      },
    );
    const out = [
      `cwd: ${workdir}`,
      `shell: ${shellFile}`,
      stdout?.trim() ? `stdout:\n${stdout}` : 'stdout: (empty)',
      stderr?.trim() ? `stderr:\n${stderr}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    return truncate(out);
  } catch (err) {
    const e = err as {
      message?: string;
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };
    const aborted = Boolean(signal?.aborted);
    const parts = [
      `cwd: ${workdir}`,
      `shell: ${shellFile}`,
      aborted
        ? '错误: 已中止'
        : e.killed
          ? `错误: 超时（>${SHELL_TIMEOUT_MS}ms）`
          : `错误: ${e.message || String(err)}`,
      e.code != null ? `exit: ${e.code}` : '',
      e.stdout?.trim() ? `stdout:\n${e.stdout}` : '',
      e.stderr?.trim() ? `stderr:\n${e.stderr}` : '',
    ].filter(Boolean);
    return truncate(parts.join('\n\n'));
  }
}

async function readLocalFile(filePath: string): Promise<string> {
  const resolved = path.resolve(expandHome(filePath.trim()));
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error(`不是普通文件: ${resolved}`);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`文件过大（${stat.size} 字节，上限 ${MAX_FILE_BYTES}）: ${resolved}`);
  }
  const buf = await fs.readFile(resolved);
  if (looksBinary(buf)) throw new Error(`疑似二进制文件，已拒绝读取: ${resolved}`);
  return truncate(`path: ${resolved}\n\n${buf.toString('utf8')}`);
}

async function writeLocalFile(filePath: string, content: string): Promise<string> {
  const resolved = path.resolve(expandHome(filePath.trim()));
  const ext = path.extname(resolved).toLowerCase();
  const binaryExts = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf',
    '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar',
    '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm',
    '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.wav', '.ogg',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.sqlite', '.db', '.dmg', '.pkg', '.app',
  ]);
  if (binaryExts.has(ext)) {
    throw new Error(`疑似二进制路径（扩展名 ${ext}），已拒绝写入: ${resolved}`);
  }
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const buf = Buffer.from(content, 'utf8');
  await fs.writeFile(resolved, buf, 'utf8');
  return `已写入 ${resolved}（${buf.byteLength} 字节 / ${content.length} 字符）`;
}

async function editLocalFile(
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
    if (e.code === 'ENOENT') throw new Error(`文件不存在: ${resolved}`);
    throw err;
  }
  if (!stat.isFile()) throw new Error(`不是普通文件: ${resolved}`);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`文件过大（${stat.size} 字节，上限 ${MAX_FILE_BYTES}）: ${resolved}`);
  }
  const buf = await fs.readFile(resolved);
  if (looksBinary(buf)) throw new Error(`疑似二进制文件，已拒绝编辑: ${resolved}`);
  const original = buf.toString('utf8');
  if (!oldText) throw new Error('old_text 不能为空');
  let count = 0;
  let idx = 0;
  while (true) {
    const found = original.indexOf(oldText, idx);
    if (found === -1) break;
    count += 1;
    idx = found + oldText.length;
  }
  if (count === 0) {
    throw new Error(`未找到 old_text，未修改文件: ${resolved}`);
  }
  if (count > 1) {
    throw new Error(
      `old_text 匹配到 ${count} 处，为安全起见未修改。请提供更唯一的 old_text: ${resolved}`,
    );
  }
  // Use replacer fn so `$&` / `$1` / `$$` in newText are literal, not expand patterns.
  const updated = original.replace(oldText, () => newText);
  const out = Buffer.from(updated, 'utf8');
  await fs.writeFile(resolved, out, 'utf8');
  return `已编辑 ${resolved}（1 处替换；现 ${out.byteLength} 字节 / ${updated.length} 字符）`;
}

export type SkillLookupResult = {
  slug: string;
  name: string;
  description: string;
  body: string;
  /** True when loaded from ~/.agents/skills (enabled global). */
  global?: boolean;
};

/** Resolve an enabled skill body by slug for the current bot (or squad member). */
export type SkillLookup = (slug: string) => SkillLookupResult | null;

export type BuildToolsOptions = {
  /** Required for `read_skill` to return bodies; omit when no skill catalog is bound. */
  skillLookup?: SkillLookup;
};

export function buildTools(
  prefs: ToolPreferences,
  security?: SecuritySettings,
  budget?: ToolRunBudget,
  options?: BuildToolsOptions,
) {
  const list = [];
  const inputGuardrails = buildToolInputGuardrails(security ?? DEFAULT_SECURITY);
  const guardrailOpts = inputGuardrails.length ? { inputGuardrails } : {};

  if (prefs.run_shell.enabled) {
    list.push(
      tool({
        name: 'run_shell',
        description:
          '在用户本机通过系统命令行执行一条命令（Windows 优先 PowerShell Core，找不到时使用 cmd）。仅在用户明确需要时使用；危险命令会先请求用户批准。',
        parameters: z.object({
          command: z.string().describe('要执行的命令'),
          cwd: z.string().optional().describe('可选工作目录，支持 ~'),
        }),
        needsApproval: prefs.run_shell.approval === 'ask',
        ...guardrailOpts,
        execute: wrapToolExecute(
          'run_shell',
          budget,
          async ({ command, cwd }: { command: string; cwd?: string }) =>
            runShellCommand(command, cwd, budget?.signal),
        ),
      }),
    );
  }

  if (prefs.read_file.enabled) {
    list.push(
      tool({
        name: 'read_file',
        description: '读取用户本机上的一个文本文件。',
        parameters: z.object({
          path: z.string().describe('文件绝对路径或 ~/…'),
        }),
        needsApproval: prefs.read_file.approval === 'ask',
        ...guardrailOpts,
        execute: wrapToolExecute(
          'read_file',
          budget,
          async ({ path: filePath }: { path: string }) => readLocalFile(filePath),
        ),
      }),
    );
  }

  if (prefs.read_skill.enabled) {
    list.push(
      tool({
        name: 'read_skill',
        description:
          '按 slug 加载本助手已启用技能的完整 SKILL.md 正文（含名称与描述）。系统提示仅含技能目录；当用户请求与某技能的名称或描述匹配时，必须先调用本工具再按正文执行，不要凭空发明步骤。',
        parameters: z.object({
          slug: z.string().describe('技能目录名（kebab-case slug，见系统提示技能目录）'),
        }),
        needsApproval: prefs.read_skill.approval === 'ask',
        ...guardrailOpts,
        execute: wrapToolExecute(
          'read_skill',
          budget,
          async ({ slug }: { slug: string }) => {
            const key = slug.trim();
            if (!key) return '错误：slug 不能为空';
            const lookup = options?.skillLookup;
            if (!lookup) {
              return '错误：当前会话未绑定技能查阅（无助手技能目录）。';
            }
            const skill = lookup(key);
            if (!skill) {
              return `错误：未找到已启用的技能「${key}」。请核对系统提示技能目录中的 slug。`;
            }
            const source = skill.global
              ? '来源：全局技能（~/.agents/skills）'
              : '来源：本助手技能';
            return truncate(
              [
                `# ${skill.name} (\`${skill.slug}\`)`,
                source,
                `何时使用：${skill.description}`,
                '',
                skill.body.trim() || '（正文为空）',
              ].join('\n'),
            );
          },
        ),
      }),
    );
  }

  if (prefs.write_file.enabled) {
    list.push(
      tool({
        name: 'write_file',
        description:
          '写入（覆盖）用户本机上的一个文本文件；必要时创建父目录。适合新建文件或整文件重写。',
        parameters: z.object({
          path: z.string().describe('文件绝对路径或 ~/…'),
          content: z.string().describe('要写入的完整 UTF-8 文本内容'),
        }),
        needsApproval: prefs.write_file.approval === 'ask',
        ...guardrailOpts,
        execute: wrapToolExecute(
          'write_file',
          budget,
          async ({ path: filePath, content }: { path: string; content: string }) =>
            writeLocalFile(filePath, content),
        ),
      }),
    );
  }

  if (prefs.edit_file.enabled) {
    list.push(
      tool({
        name: 'edit_file',
        description:
          '对已存在的文本文件做一次精确字符串替换（old_text → new_text）。适合小范围修改；若匹配 0 次或多于 1 次则报错不改。',
        parameters: z.object({
          path: z.string().describe('文件绝对路径或 ~/…'),
          old_text: z.string().describe('要替换的原文本（须在文件中恰好出现一次）'),
          new_text: z.string().describe('替换后的新文本'),
        }),
        needsApproval: prefs.edit_file.approval === 'ask',
        ...guardrailOpts,
        execute: wrapToolExecute(
          'edit_file',
          budget,
          async ({
            path: filePath,
            old_text,
            new_text,
          }: {
            path: string;
            old_text: string;
            new_text: string;
          }) => editLocalFile(filePath, old_text, new_text),
        ),
      }),
    );
  }

  return list;
}

export const TOOL_BLURBS: Record<string, string> = {
  run_shell: '执行命令',
  read_file: '读文件',
  read_skill: '加载技能正文',
  write_file: '新建/整文件覆盖写入',
  edit_file: '精确单处替换',
};
