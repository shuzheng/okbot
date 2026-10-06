/**
 * Desktop-side owner of MCP connections (one hub per process).
 * Runs call `mcpToolsForRun` before they build agents; settings call status / test.
 * MCP is desktop-only: the gateway cannot change `settings.mcp` (it starts host processes).
 */
import { normalizeMcpSettings, type AppSettings, type McpServerEntry } from '@okbot/shared';
import { McpHub, testMcpServer, type McpServerStatus, type ToolRunBudget } from '@okbot/agent';

const hub = new McpHub();

/** Built-in tool names an MCP tool must not shadow. */
const RESERVED_TOOL_NAMES = [
  'run_shell',
  'read_file',
  'read_skill',
  'write_file',
  'edit_file',
  'generate_image',
];

export type McpRunTools = ReturnType<McpHub['buildTools']>;

/** MCP tools for one run. Empty (and connections closed) when MCP is off. Never throws. */
export async function mcpToolsForRun(
  settings: Pick<AppSettings, 'mcp'>,
  budget?: ToolRunBudget,
): Promise<McpRunTools> {
  const mcp = normalizeMcpSettings(settings.mcp);
  try {
    await hub.sync(mcp);
  } catch (err) {
    console.error('[okbot] mcp sync failed', err);
  }
  if (!mcp.enabled) return [];
  return hub.buildTools(budget, RESERVED_TOOL_NAMES);
}

export async function mcpStatus(settings: Pick<AppSettings, 'mcp'>): Promise<McpServerStatus[]> {
  const mcp = normalizeMcpSettings(settings.mcp);
  await hub.sync(mcp).catch(() => {});
  return hub.status(mcp);
}

export function mcpTest(entry: McpServerEntry): Promise<McpServerStatus> {
  return testMcpServer(entry);
}

export function closeMcp(): Promise<void> {
  return hub.closeAll();
}
