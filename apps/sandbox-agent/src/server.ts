#!/usr/bin/env node
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { assertAuthorized } from './auth.js';
import { editTextFile, readTextFile, writeTextFile } from './fsOps.js';
import { matchPath, openSse, readBody, sendJson, wantsSse, writeSse } from './httpUtil.js';
import { runShell } from './shellOps.js';

export type SandboxConfig = {
  host: string;
  port: number;
  token: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SandboxConfig {
  const host = (env.SANDBOX_HOST || '0.0.0.0').trim() || '0.0.0.0';
  let port = Number(env.SANDBOX_PORT || 18790);
  if (!Number.isFinite(port) || port < 1 || port > 65535) port = 18790;
  let token = (env.SANDBOX_TOKEN || '').trim();
  if (!token) {
    token = randomBytes(24).toString('hex');
    console.warn('[okbot-sandbox-agent] SANDBOX_TOKEN unset; generated ephemeral token (set env for stable auth)');
    console.warn(`[okbot-sandbox-agent] token=${token}`);
  }
  return { host, port, token };
}

export function createSandboxHandler(token: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const method = (req.method || 'GET').toUpperCase();
    const { parts } = matchPath(req.url || '/');

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-OkBot-Token',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end();
      return;
    }

    if (method === 'GET' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'health') {
      sendJson(res, 200, { ok: true, service: 'okbot-sandbox-agent' });
      return;
    }

    if (!assertAuthorized(req, token)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    try {
      // POST /v1/shell
      if (method === 'POST' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'shell') {
        let parsed: Record<string, unknown> = {};
        try {
          const raw = await readBody(req);
          parsed = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch (err) {
          if (err instanceof Error && err.message === 'payload_too_large') {
            sendJson(res, 413, { ok: false, error: 'payload_too_large' });
            return;
          }
          sendJson(res, 400, { ok: false, error: 'invalid_json' });
          return;
        }
        const command = typeof parsed.command === 'string' ? parsed.command : '';
        if (!command.trim()) {
          sendJson(res, 400, { ok: false, error: 'command_required' });
          return;
        }
        const cwd = typeof parsed.cwd === 'string' ? parsed.cwd : undefined;
        const ac = new AbortController();
        req.on('close', () => {
          if (!res.writableEnded) ac.abort();
        });

        if (wantsSse(req)) {
          openSse(res);
          const result = await runShell(command, cwd, ac.signal, {
            onStdout: (chunk) => writeSse(res, 'stdout', { chunk }),
            onStderr: (chunk) => writeSse(res, 'stderr', { chunk }),
          });
          writeSse(res, 'done', {
            cwd: result.cwd,
            shell: result.shell,
            exitCode: result.exitCode,
            killed: result.killed,
            aborted: result.aborted,
            error: result.error,
            formatted: result.formatted,
          });
          try {
            if (!res.writableEnded) res.end();
          } catch {
            /* ignore */
          }
          return;
        }

        const result = await runShell(command, cwd, ac.signal);
        sendJson(res, 200, {
          ok: true,
          cwd: result.cwd,
          shell: result.shell,
          exitCode: result.exitCode,
          killed: result.killed,
          aborted: result.aborted,
          error: result.error,
          stdout: result.stdout,
          stderr: result.stderr,
          formatted: result.formatted,
        });
        return;
      }

      // POST /v1/fs/read | write | edit
      if (method === 'POST' && parts.length === 3 && parts[0] === 'v1' && parts[1] === 'fs') {
        let parsed: Record<string, unknown> = {};
        try {
          const raw = await readBody(req);
          parsed = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch (err) {
          if (err instanceof Error && err.message === 'payload_too_large') {
            sendJson(res, 413, { ok: false, error: 'payload_too_large' });
            return;
          }
          sendJson(res, 400, { ok: false, error: 'invalid_json' });
          return;
        }
        const filePath = typeof parsed.path === 'string' ? parsed.path : '';
        if (!filePath.trim()) {
          sendJson(res, 400, { ok: false, error: 'path_required' });
          return;
        }

        if (parts[2] === 'read') {
          const formatted = await readTextFile(filePath);
          sendJson(res, 200, { ok: true, formatted });
          return;
        }
        if (parts[2] === 'write') {
          const content = typeof parsed.content === 'string' ? parsed.content : '';
          const formatted = await writeTextFile(filePath, content);
          sendJson(res, 200, { ok: true, formatted });
          return;
        }
        if (parts[2] === 'edit') {
          const oldText = typeof parsed.old_text === 'string' ? parsed.old_text : '';
          const newText = typeof parsed.new_text === 'string' ? parsed.new_text : '';
          const formatted = await editTextFile(filePath, oldText, newText);
          sendJson(res, 200, { ok: true, formatted });
          return;
        }
      }

      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[okbot-sandbox-agent] request failed', err);
      sendJson(res, 500, { ok: false, error: 'internal_error', message });
    }
  };
}

export function startSandboxServer(config: SandboxConfig): Promise<http.Server> {
  const handler = createSandboxHandler(config.token);
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      console.info(`[okbot-sandbox-agent] listening on http://${config.host}:${config.port}`);
      resolve(server);
    });
  });
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('/server.js') ||
    process.argv[1].endsWith('/server.ts') ||
    process.argv[1].endsWith('okbot-sandbox-agent'));

if (isMain) {
  const config = loadConfig();
  void startSandboxServer(config).catch((err) => {
    console.error('[okbot-sandbox-agent] failed to start', err);
    process.exit(1);
  });
}
