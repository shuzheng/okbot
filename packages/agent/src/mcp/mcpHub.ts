/**
 * MCP servers as agent tools ("advanced extensions", off by default).
 *
 * The hub keeps one connection per configured server and turns each MCP tool
 * into a plain function tool with `needsApproval: true`, so every call goes
 * through the same HITL card as `run_shell`. The SDK's own `mcpServers` agent
 * option is not used: it has no per-tool approval hook.
 */
import {
  MCPServerStdio,
  MCPServerStreamableHttp,
  tool,
  type MCPServer,
  type Tool,
} from '@openai/agents';
import { createHash } from 'node:crypto';
import {
  isInsecureRemoteMcpUrl,
  isMcpServerConnectable,
  MCP_TOOL_PREFIX,
  type McpServerEntry,
  type McpSettings,
} from '@okbot/shared';
import { wrapToolExecute, type ToolRunBudget } from '../toolRunBudget.js';

const CONNECT_TIMEOUT_MS = 15_000;
const MAX_TOOL_OUTPUT = 24_000;
const MAX_TOOL_NAME = 64;
/** One MCP tool call may not run longer than this. */
const CALL_TIMEOUT_MS = 120_000;
/** Arguments larger than this are refused before they reach the server. */
const MAX_CALL_ARGS_CHARS = 100_000;

export type McpServerStatus = {
  id: string;
  name: string;
  ok: boolean;
  toolCount: number;
  toolNames?: string[];
  error?: string;
};

type McpToolInfo = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

type Connection = {
  key: string;
  entry: McpServerEntry;
  server: MCPServer;
  tools: McpToolInfo[];
};

function entryKey(entry: McpServerEntry): string {
  return JSON.stringify(entry);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} 超时（${Math.round(ms / 1000)} 秒）`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Variables a stdio server gets from the host: enough for `npx` / `uvx` to run,
 * no API keys or tokens from the app environment. Configured `env` adds to it.
 * (Same idea as the MCP SDK default environment.)
 */
const INHERITED_ENV_KEYS =
  process.platform === 'win32'
    ? ['APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATH', 'PATHEXT', 'PROCESSOR_ARCHITECTURE',
       'PROGRAMFILES', 'SYSTEMDRIVE', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERNAME', 'USERPROFILE', 'COMSPEC']
    : ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR'];

export function stdioEnv(extra?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const key of INHERITED_ENV_KEYS) {
    const v = process.env[key];
    // Values that look like shell functions are skipped (same as the MCP SDK).
    if (typeof v === 'string' && !v.startsWith('()')) base[key] = v;
  }
  return { ...base, ...(extra ?? {}) };
}

export function createMcpServer(entry: McpServerEntry): MCPServer {
  if (entry.transport === 'http') {
    if (isInsecureRemoteMcpUrl(entry.url || '')) {
      // Code, not text: the settings UI maps it to the user's language.
      throw new Error('mcp_insecure_url');
    }
    return new MCPServerStreamableHttp({
      url: entry.url || '',
      name: entry.name,
      cacheToolsList: true,
      ...(entry.headers ? { requestInit: { headers: entry.headers } } : {}),
    });
  }
  return new MCPServerStdio({
    command: entry.command || '',
    args: entry.args ?? [],
    env: stdioEnv(entry.env),
    name: entry.name,
    cacheToolsList: true,
  });
}

function sanitizeNamePart(raw: string): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/** Four hex chars from the server id: two servers with the same display name keep distinct, stable tool names. */
export function mcpServerTag(serverId: string): string {
  return createHash('sha256').update(serverId).digest('hex').slice(0, 4);
}

/**
 * `mcp_<server>_<tag>_<tool>`, max 64 chars (provider tool-name limit), unique within `used`.
 * The tag comes from the server id, so names do not depend on connection order.
 */
export function mcpToolName(serverName: string, toolName: string, used: Set<string>, serverId = serverName): string {
  const server = (sanitizeNamePart(serverName) || 'server').slice(0, 20);
  const base = `${MCP_TOOL_PREFIX}${server}_${mcpServerTag(serverId)}_${sanitizeNamePart(toolName) || 'tool'}`;
  let name = base.slice(0, MAX_TOOL_NAME);
  let n = 2;
  while (used.has(name)) {
    const suffix = `_${n++}`;
    name = base.slice(0, MAX_TOOL_NAME - suffix.length) + suffix;
  }
  used.add(name);
  return name;
}

/** MCP content blocks → model-visible text. */
/**
 * Call one MCP tool. A result with `isError: true` is a tool error: the text
 * says so, so the model does not read it as a success.
 */
export async function callMcpTool(
  server: Pick<MCPServer, 'callTool' | 'callToolResult'>,
  toolName: string,
  input: Record<string, unknown>,
): Promise<string> {
  if (typeof server.callToolResult === 'function') {
    const result = await server.callToolResult(toolName, input);
    const text = formatMcpToolOutput(result.content);
    return result.isError === true ? `MCP 工具返回错误：${text}` : text;
  }
  return formatMcpToolOutput(await server.callTool(toolName, input));
}

export function formatMcpToolOutput(content: unknown): string {
  const blocks = Array.isArray(content) ? content : [content];
  const parts = blocks.map((b) => {
    if (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text') {
      return String((b as { text?: unknown }).text ?? '');
    }
    return JSON.stringify(b);
  });
  const text = parts.join('\n').trim() || '（MCP 工具没有返回内容）';
  if (text.length <= MAX_TOOL_OUTPUT) return text;
  return `${text.slice(0, MAX_TOOL_OUTPUT)}\n\n…(已截断，共 ${text.length} 字符)`;
}

function normalizeSchema(raw: unknown): Record<string, unknown> {
  const s = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
  return {
    ...s,
    type: 'object',
    properties: s.properties && typeof s.properties === 'object' ? s.properties : {},
    required: Array.isArray(s.required) ? s.required : [],
    additionalProperties: s.additionalProperties === true,
  };
}

async function connectEntry(entry: McpServerEntry): Promise<Connection> {
  const server = createMcpServer(entry);
  try {
    await withTimeout(server.connect(), CONNECT_TIMEOUT_MS, `连接 MCP 服务「${entry.name}」`);
    const listed = await withTimeout(server.listTools(), CONNECT_TIMEOUT_MS, `读取「${entry.name}」的工具`);
    const tools = listed.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: normalizeSchema(t.inputSchema),
    }));
    return { key: entryKey(entry), entry, server, tools };
  } catch (err) {
    await server.close().catch(() => {});
    throw err;
  }
}

export class McpHub {
  private readonly connections = new Map<string, Connection>();
  private readonly errors = new Map<string, string>();
  private syncing: Promise<void> = Promise.resolve();

  /** Connect new / changed servers, close removed ones. Safe to call before every run. */
  sync(settings: McpSettings): Promise<void> {
    const run = async () => {
      const wanted = new Map<string, McpServerEntry>();
      if (settings.enabled) {
        for (const s of settings.servers) if (isMcpServerConnectable(s)) wanted.set(s.id, s);
      }
      for (const [id, conn] of [...this.connections]) {
        const next = wanted.get(id);
        if (next && entryKey(next) === conn.key) continue;
        this.connections.delete(id);
        await conn.server.close().catch(() => {});
      }
      for (const id of [...this.errors.keys()]) if (!wanted.has(id)) this.errors.delete(id);
      await Promise.all(
        [...wanted.values()]
          .filter((entry) => !this.connections.has(entry.id))
          .map(async (entry) => {
            try {
              this.connections.set(entry.id, await connectEntry(entry));
              this.errors.delete(entry.id);
            } catch (err) {
              this.errors.set(entry.id, errorText(err));
            }
          }),
      );
    };
    this.syncing = this.syncing.then(run, run);
    return this.syncing;
  }

  /** Function tools for every connected server. Every call needs approval. */
  buildTools(budget?: ToolRunBudget, reservedNames: Iterable<string> = []): Tool[] {
    const used = new Set<string>(reservedNames);
    const out: Tool[] = [];
    // Stable order (server id), not connection-completion order.
    const conns = [...this.connections.values()].sort((a, b) => a.entry.id.localeCompare(b.entry.id));
    for (const conn of conns) {
      for (const info of conn.tools) {
        const name = mcpToolName(conn.entry.name, info.name, used, conn.entry.id);
        const server = conn.server;
        out.push(
          tool({
            name,
            description: `[MCP · ${conn.entry.name}] ${(info.description || info.name).slice(0, 1000)}`,
            parameters: info.inputSchema as never,
            strict: false,
            needsApproval: true,
            execute: wrapToolExecute(name, budget, async (args: unknown) => {
              try {
                const input =
                  args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
                const size = JSON.stringify(input).length;
                if (size > MAX_CALL_ARGS_CHARS) {
                  return `MCP 工具调用失败：参数过大（${size} 字符，上限 ${MAX_CALL_ARGS_CHARS}）`;
                }
                return await withTimeout(
                  callMcpTool(server, info.name, input),
                  CALL_TIMEOUT_MS,
                  `MCP 工具「${info.name}」`,
                );
              } catch (err) {
                return `MCP 工具调用失败：${errorText(err)}`;
              }
            }),
          }) as Tool,
        );
      }
    }
    return out;
  }

  status(settings: McpSettings): McpServerStatus[] {
    return settings.servers.map((s) => {
      const conn = this.connections.get(s.id);
      if (conn) {
        return { id: s.id, name: s.name, ok: true, toolCount: conn.tools.length, toolNames: conn.tools.map((t) => t.name) };
      }
      return { id: s.id, name: s.name, ok: false, toolCount: 0, error: this.errors.get(s.id) };
    });
  }

  async closeAll(): Promise<void> {
    const conns = [...this.connections.values()];
    this.connections.clear();
    this.errors.clear();
    await Promise.all(conns.map((c) => c.server.close().catch(() => {})));
  }
}

/** One-off connection check for the settings page. Does not touch the hub. */
export async function testMcpServer(entry: McpServerEntry): Promise<McpServerStatus> {
  if (!isMcpServerConnectable({ ...entry, enabled: true })) {
    return { id: entry.id, name: entry.name, ok: false, toolCount: 0, error: 'incomplete' };
  }
  try {
    const conn = await connectEntry({ ...entry, enabled: true });
    await conn.server.close().catch(() => {});
    return {
      id: entry.id,
      name: entry.name,
      ok: true,
      toolCount: conn.tools.length,
      toolNames: conn.tools.map((t) => t.name),
    };
  } catch (err) {
    return { id: entry.id, name: entry.name, ok: false, toolCount: 0, error: errorText(err) };
  }
}
