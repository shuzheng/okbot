# 连接器：飞书 / Lark（Feishu）

- **类型**：官方远程 MCP（推荐）+ 本地 OpenAPI MCP / Lark CLI 备选
- **Endpoint**：`https://mcp.feishu.cn/mcp`
- **鉴权**：请求头 `X-Lark-MCP-UAT` 或 `X-Lark-MCP-TAT`（用户自备，不入库）
- **场景**：当前远程 MCP 以 **云文档 Docs** 为主；更多场景（Base / Calendar 等）官方陆续开放
- **文档**：
  - MCP overview：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/mcp_integration/mcp_introduction
  - 开发者远程调用：https://open.feishu.cn/document/mcp_open_tools/developers-call-remote-mcp-server
  - Lark CLI：https://open.feishu.cn/document/mcp_open_tools/feishu-cli-let-ai-actually-do-your-work-in-feishu

Stub only：完整 MCP 客户端由宿主 `mcpHub` 在配置启用后连接。连接器 id=`feishu`（`lark` 为别名）。
