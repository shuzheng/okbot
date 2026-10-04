import { execFile, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const SHELL_TIMEOUT_MS = 30_000;
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

function killTree(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export type ShellStreamHandlers = {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

export type ShellResult = {
  cwd: string;
  shell: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  killed: boolean;
  aborted: boolean;
  error?: string;
  formatted: string;
};

export async function runShell(
  command: string,
  cwd: string | undefined,
  signal: AbortSignal | undefined,
  handlers?: ShellStreamHandlers,
): Promise<ShellResult> {
  const workdir = cwd?.trim() ? expandHome(cwd.trim()) : process.env.SANDBOX_WORKDIR || homedir();
  try {
    if (!existsSync(workdir)) mkdirSync(workdir, { recursive: true });
  } catch {
    /* ignore; exec will surface cwd errors */
  }
  const env = { ...process.env };
  delete env.SANDBOX_TOKEN;
  const shellFile =
    (process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : '') ||
    (existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh');
  const shellArgs = ['-lc', command];

  if (signal?.aborted) {
    const formatted = truncate(`cwd: ${workdir}\n\nshell: ${shellFile}\n\nerror: aborted`);
    return {
      cwd: workdir,
      shell: shellFile,
      stdout: '',
      stderr: '',
      exitCode: null,
      killed: false,
      aborted: true,
      error: 'aborted',
      formatted,
    };
  }

  let stdout = '';
  let stderr = '';
  let exitCode: number | null = null;
  let killed = false;

  try {
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        shellFile,
        shellArgs,
        {
          cwd: workdir,
          timeout: SHELL_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          env,
        } as import('node:child_process').ExecFileOptions,
        (err: Error | null, out: string | Buffer, errOut: string | Buffer) => {
          stdout = typeof out === 'string' ? out : (out?.toString('utf8') ?? '');
          stderr = typeof errOut === 'string' ? errOut : (errOut?.toString('utf8') ?? '');
          if (err) {
            const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
            exitCode = typeof e.code === 'number' ? e.code : null;
            killed = Boolean(e.killed);
            // Still resolve with output for formatted response
            reject(err);
            return;
          }
          exitCode = 0;
          resolve();
        },
      );

      child.stdout?.on('data', (buf: Buffer) => {
        const chunk = buf.toString('utf8');
        stdout += chunk;
        handlers?.onStdout?.(chunk);
      });
      child.stderr?.on('data', (buf: Buffer) => {
        const chunk = buf.toString('utf8');
        stderr += chunk;
        handlers?.onStderr?.(chunk);
      });

      const onAbort = () => killTree(child);
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      child.on('exit', (code) => {
        if (exitCode == null && typeof code === 'number') exitCode = code;
        signal?.removeEventListener('abort', onAbort);
      });
    });
  } catch (err) {
    const aborted = Boolean(signal?.aborted);
    const e = err as { message?: string; code?: number | string; killed?: boolean };
    const error = aborted
      ? 'aborted'
      : e.killed
        ? `timeout (>${SHELL_TIMEOUT_MS}ms)`
        : e.message || String(err);
    const parts = [
      `cwd: ${workdir}`,
      `shell: ${shellFile}`,
      `error: ${error}`,
      exitCode != null || e.code != null ? `exit: ${exitCode ?? e.code}` : '',
      stdout.trim() ? `stdout:\n${stdout}` : '',
      stderr.trim() ? `stderr:\n${stderr}` : '',
    ].filter(Boolean);
    return {
      cwd: workdir,
      shell: shellFile,
      stdout,
      stderr,
      exitCode: typeof exitCode === 'number' ? exitCode : typeof e.code === 'number' ? e.code : null,
      killed: Boolean(e.killed),
      aborted,
      error,
      formatted: truncate(parts.join('\n\n')),
    };
  }

  const parts = [
    `cwd: ${workdir}`,
    `shell: ${shellFile}`,
    stdout.trim() ? `stdout:\n${stdout}` : 'stdout: (empty)',
    stderr.trim() ? `stderr:\n${stderr}` : '',
  ].filter(Boolean);
  return {
    cwd: workdir,
    shell: shellFile,
    stdout,
    stderr,
    exitCode: exitCode ?? 0,
    killed: false,
    aborted: false,
    formatted: truncate(parts.join('\n\n')),
  };
}
