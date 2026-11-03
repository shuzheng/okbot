# 连接器：钉钉（DingTalk）

- **类型**：官方 MCP Server（stdio，`dingtalk-mcp`）
- **安装 / 运行**：`npx -y dingtalk-mcp@latest`
- **鉴权环境变量**：
  - `DINGTALK_Client_ID` = 企业应用 AppKey
  - `DINGTALK_Client_Secret` = AppSecret
  - `ACTIVE_PROFILES` = 模块列表（如 `dingtalk-contacts,dingtalk-notable,dingtalk-calendar`）或 `ALL`
- **核心能力**：通讯录、AI 表格、日程；另有待办、机器人、通知、TB 项目等
- **文档**：https://open.dingtalk.com/document/ai-dev/second-level-node-1

Stub only。权限点需在钉钉开放平台按模块开通；凭证不入库。
