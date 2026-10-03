import { homedir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile, type ChildProcess } from 'node:child_process';
import { expandHome } from './guardrails.js';
import {
  foldExecStreamToFormatted,
  parseExecStreamSseBlocks,
} from './runtime/execStream.js';

const MAX_TOOL_OUTPUT = 24_000;
const MAX_FILE_BYTES = 200_000;
const SHELL_TIMEOUT_MS = 30_000;

export type ExecutionBackend = {
  /** Human label for tool descriptions (本机 / cloud name). */
  label: string;
  runShell(command: string, cwd?: string, signal?: AbortSignal): Promise<string>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<string>;
  editFile(filePath: string, oldText: string, newText: string): Promise<string>;
};

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

export type ShellExecSpec = {
  file: string;
  args: string[];
};

export type ResolveShellExecOptions = {
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

async function runLocalShellCommand(
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
  const updated = original.replace(oldText, () => newText);
  const out = Buffer.from(updated, 'utf8');
  await fs.writeFile(resolved, out, 'utf8');
  return `已编辑 ${resolved}（1 处替换；现 ${out.byteLength} 字节 / ${updated.length} 字符）`;
}

/** Local desktop host backend (default). */
export function createLocalExecutionBackend(): ExecutionBackend {
  return {
    label: '本机',
    runShell: runLocalShellCommand,
    readFile: readLocalFile,
    writeFile: writeLocalFile,
    editFile: editLocalFile,
  };
}

export type RemoteComputerTarget = {
  /** Display name */
  name: string;
  /** Base URL e.g. http://127.0.0.1:18790 */
  baseUrl: string;
  /** Bearer token */
  token: string;
  /** Optional fetch override (tests). */
  fetchImpl?: typeof fetch;
};

async function remoteJson(
  target: RemoteComputerTarget,
  method: string,
  urlPath: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const fetchFn = target.fetchImpl ?? fetch;
  const base = target.baseUrl.replace(/\/+$/, '');
  const res = await fetchFn(`${base}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${target.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`云电脑响应非 JSON（HTTP ${res.status}）: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const err = typeof json.error === 'string' ? json.error : `HTTP ${res.status}`;
    const msg = typeof json.message === 'string' ? json.message : '';
    throw new Error(`云电脑错误: ${err}${msg ? ` — ${msg}` : ''}`);
  }
  return json;
}


async function remoteShellSse(
  target: RemoteComputerTarget,
  command: string,
  cwd: string | undefined,
  signal?: AbortSignal,
): Promise<string | null> {
  const fetchFn = target.fetchImpl ?? fetch;
  const base = target.baseUrl.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetchFn(`${base}/v1/shell`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${target.token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ command, cwd }),
      signal,
    });
  } catch {
    return null;
  }
  const ct = res.headers.get('content-type') || '';
  if (!res.ok || !ct.includes('text/event-stream') || !res.body) {
    // Not an SSE response — caller falls back to JSON.
    return null;
  }
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const collected: ReturnType<typeof parseExecStreamSseBlocks>['events'] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parsed = parseExecStreamSseBlocks(buf);
    buf = parsed.rest;
    collected.push(...parsed.events);
  }
  if (buf.trim()) {
    const parsed = parseExecStreamSseBlocks(buf + '\n\n');
    collected.push(...parsed.events);
  }
  return foldExecStreamToFormatted(collected);
}

/** HTTP client for apps/sandbox-agent cloud computer. */
export function createRemoteExecutionBackend(target: RemoteComputerTarget): ExecutionBackend {
  const label = target.name || '云电脑';
  return {
    label,
    async runShell(command, cwd, signal) {
      try {
        // Prefer SSE when the sandbox supports it — same ExecStreamEvent model as
        // sandbox-agent; fold to formatted so tools share one consumption path.
        const sseFormatted = await remoteShellSse(target, command, cwd, signal);
        if (sseFormatted != null) return truncate(sseFormatted);
        const json = await remoteJson(
          target,
          'POST',
          '/v1/shell',
          { command, cwd },
          signal,
        );
        if (typeof json.formatted === 'string') return truncate(json.formatted);
        return truncate(JSON.stringify(json));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return truncate(`云电脑 (${label}) shell 失败: ${msg}`);
      }
    },
    async readFile(filePath) {
      const json = await remoteJson(target, 'POST', '/v1/fs/read', { path: filePath });
      if (typeof json.formatted === 'string') return truncate(json.formatted);
      return truncate(JSON.stringify(json));
    },
    async writeFile(filePath, content) {
      const json = await remoteJson(target, 'POST', '/v1/fs/write', {
        path: filePath,
        content,
      });
      if (typeof json.formatted === 'string') return json.formatted;
      return String(json.ok ? 'ok' : JSON.stringify(json));
    },
    async editFile(filePath, oldText, newText) {
      const json = await remoteJson(target, 'POST', '/v1/fs/edit', {
        path: filePath,
        old_text: oldText,
        new_text: newText,
      });
      if (typeof json.formatted === 'string') return json.formatted;
      return String(json.ok ? 'ok' : JSON.stringify(json));
    },
  };
}

/** Reachability + token check for a sandbox-agent computer. Does not run a shell. */
export async function probeRemoteComputer(
  target: RemoteComputerTarget,
): Promise<{ ok: true } | { ok: false; error: 'unreachable' | 'not_sandbox' | 'unauthorized' | 'unexpected' }> {
  const fetchFn = target.fetchImpl ?? fetch;
  const base = target.baseUrl.replace(/\/+$/, '');
  const signal = AbortSignal.timeout(5_000);
  let healthRes: Response;
  try {
    healthRes = await fetchFn(`${base}/v1/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch {
    return { ok: false, error: 'unreachable' };
  }
  let health: Record<string, unknown> = {};
  try {
    const text = await healthRes.text();
    health = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return { ok: false, error: 'not_sandbox' };
  }
  if (!healthRes.ok || health.ok !== true || health.service !== 'okbot-sandbox-agent') {
    return { ok: false, error: 'not_sandbox' };
  }
  let authRes: Response;
  try {
    authRes = await fetchFn(`${base}/v1/shell`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${target.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
      signal,
    });
  } catch {
    return { ok: false, error: 'unreachable' };
  }
  if (authRes.status === 401) return { ok: false, error: 'unauthorized' };
  const authText = await authRes.text();
  let authJson: Record<string, unknown> = {};
  try {
    authJson = authText.trim() ? (JSON.parse(authText) as Record<string, unknown>) : {};
  } catch {
    return { ok: false, error: 'unexpected' };
  }
  // Authorized empty shell is rejected before any command runs.
  if (authRes.status === 400 && authJson.error === 'command_required') return { ok: true };
  return { ok: false, error: 'unexpected' };
}

/** Resolve backend from settings computerId (`local` or registered id). */
export function resolveExecutionBackend(input: {
  computerId?: string | null;
  computers?: Array<{ id: string; name: string; host: string; port: number; token: string }>;
}): ExecutionBackend {
  const id = (input.computerId || 'local').trim() || 'local';
  if (id === 'local') return createLocalExecutionBackend();
  const list = Array.isArray(input.computers) ? input.computers : [];
  const entry = list.find((c) => c.id === id);
  if (!entry) {
    const local = createLocalExecutionBackend();
    return {
      ...local,
      label: `本机（未找到云电脑 ${id}）`,
    };
  }
  const host = entry.host.trim() || '127.0.0.1';
  const port = entry.port;
  const baseUrl = `http://${host}:${port}`;
  return createRemoteExecutionBackend({
    name: entry.name || id,
    baseUrl,
    token: entry.token,
  });
}
