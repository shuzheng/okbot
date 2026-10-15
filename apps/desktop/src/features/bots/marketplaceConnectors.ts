/**
 * Curated MCP connector presets for the marketplace 「连接器」 tab.
 * One-click adds a disabled-by-default server entry; user enables in Settings → MCP.
 */
export type MarketplaceConnectorPreset = {
  id: string;
  /** i18n-independent display names */
  nameZh: string;
  nameEn: string;
  descZh: string;
  descEn: string;
  transport: 'stdio';
  command: string;
  args: string[];
};

export const MARKETPLACE_CONNECTOR_PRESETS: MarketplaceConnectorPreset[] = [
  {
    id: 'mcp_memory',
    nameZh: 'Memory',
    nameEn: 'Memory',
    descZh: '简单键值记忆，适合跨会话记住偏好（stdio / npx）。',
    descEn: 'Simple key–value memory across chats (stdio / npx).',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
  },
  {
    id: 'mcp_sequential_thinking',
    nameZh: 'Sequential Thinking',
    nameEn: 'Sequential Thinking',
    descZh: '分步推理工具，适合把复杂任务拆成可检查的步骤。',
    descEn: 'Stepwise reasoning tools for breaking down complex tasks.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  },
  {
    id: 'mcp_fetch',
    nameZh: 'Fetch',
    nameEn: 'Fetch',
    descZh: '按 URL 拉取网页正文（stdio / npx）。远程内容仍受你的工具审批约束。',
    descEn: 'Fetch webpage text by URL (stdio / npx). Remote content still needs tool approval.',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
  },
];
