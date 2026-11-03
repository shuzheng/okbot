# OkBot Market（市场）

独立可抽取目录：**本期只做连接器（对外接入渠道）**，**不做内置助手**。

助手（智能体 / persona / prompt / skills / workflows）由用户自行创建，或日后另建；本市场包不附带 `assistants/`。

- Wave-1（生活服务）对齐：https://x.com/xiaomovps/status/2116690552188260496
- Wave-2（办公协作）对齐：https://x.com/alin_zone/status/2116853074123772181

> 本目录目前只做 **目录布局 + 清单（manifest）+ 索引**，不实现完整 MCP 客户端。
> 凭证/Token 永不写入仓库；由用户在运行时配置。

## 本期范围

| 做 | 不做 |
| --- | --- |
| **连接器**：MCP / HTTP / Skill 渠道的 endpoint、鉴权方式、工具摘要、文档 | **内置助手**：不提供 persona / SOUL / 场景助手包 |
| 10 个国内平台对外接入清单 | 助手与连接器的 `requiredConnectors` 绑定（助手侧日后另建时再声明） |

连接器 **不是** Agent：不做对话人格，不嵌入平台凭证实值。

## 连接器一览（10）

### Wave-1 · 生活服务（5）

摘自 xiaomovps 推文正文（note）与官方文档；endpoint 以厂商公开页为准。

| # | 平台 | 连接器 id | 类型 |
| --- | ---: | --- | --- |
| 1 | 瑞幸咖啡 | `luckin` | MCP（Streamable HTTP，Bearer） |
| 2 | 美团跑腿 | `meituan-paotui` | Skill / ClawHub（暂无公开 MCP） |
| 3 | 麦当劳中国 | `mcdonalds` | MCP（需申请 Token） |
| 4 | 滴滴出行 | `didi` | MCP + 官方 Skill |
| 5 | 高德地图 | `amap` | MCP（HTTP `?key=` 或 stdio） |

推文顺序原文为：瑞幸 → 美团 → 麦当劳 → 滴滴 → 高德。第五项在推文中明确是 **高德地图官方 MCP**（地点搜索 / 路线 / 周边 / 生成地图），同时可作为叫车、附近咖啡店的地图底座。

### Wave-2 · 办公协作（5）

摘自 alin_zone 推文（飞书 / 钉钉 / 企业微信 / 语雀 / 邮箱）与官方文档；与 Wave-1 生活服务无重叠。

| # | 平台 | 连接器 id | 类型 |
| --- | ---: | --- | --- |
| 1 | 飞书 / Lark | `feishu`（别名 `lark`） | 远程 MCP（Docs first；`https://mcp.feishu.cn/mcp`） |
| 2 | 钉钉 | `dingtalk` | MCP stdio（`dingtalk-mcp`；通讯录 / AI 表格 / 日程…） |
| 3 | 企业微信 | `wecom` | `@wecom/cli` + 官方 MCP（消息 / 邮件 / 文档 / 待办 / 日程 / 会议 / 微盘 / 通讯录） |
| 4 | 语雀 | `yuque` | MCP stdio（`yuque-mcp`，19 tools） |
| 5 | 邮箱 | `email` | 通用 IMAP/SMTP MCP 投影（QQ / 163 / 企业邮预设；推文未点名单一品牌） |

推文顺序原文为：飞书 → 钉钉 → 企业微信 → 语雀 → 邮箱。邮箱按 **通用办公邮件渠道** 建模，便于日后接 CN 网页邮或专用 MCP。

完整 id 列表：`luckin`、`meituan-paotui`、`mcdonalds`、`didi`、`amap`、`feishu`、`dingtalk`、`wecom`、`yuque`、`email`。

## 目录布局

```
market/
  README.md
  catalog.json              # 机器可读市场索引（connectors only；含 wave 字段）
  connectors/<id>/
    manifest.json           # 连接器清单（无 secrets）
    README.md               # 接入说明 stub
```

> `assistants/` 已移除（catalog v3）。不再维护市场内置助手文件夹。

## 与现有运行时的关系（指针，暂不迁移）

当前 OkBot 已有 MCP / 助手画廊接线，**不在本目录内**：

- MCP 运行时：`packages/shared/src/mcp.ts`（`McpServerEntry` / `McpSettings`）+ `packages/agent/src/mcp/mcpHub.ts`
- 内置助手画廊：`packages/agent/gallery/`（及桌面镜像 `apps/desktop/resources/assistant-gallery/`）——与本 market 包无关；用户助手走画廊 / 自建，不走本目录

本 `market/` 清单字段刻意贴近连接器约定（如可映射为 `transport: http|stdio`、`url`、`headers`），方便日后把 catalog 灌进 gateway / settings，但 **暂时不改运行时加载路径**。

<!-- TODO(market): gateway 读取 market/catalog.json，将 connectors 投影为可选 McpServerEntry 模板。助手不在本包。 -->

## 以后如何抽取成独立包 / 仓库

1. 将整个 `market/` 目录移出（或 `git subtree split`）为独立 repo / npm package，例如 `@okbot/market-cn`。
2. 保留 `catalog.json` 为唯一入口；宿主（OkBot gateway / desktop）通过配置项指向该包路径或 registry 版本。
3. 连接器 secrets 仍由宿主 vault / settings 注入；包内只有模板与文档。
4. 若日后需要「市场助手」，另立包或目录，勿与本期 connectors-only 范围混写。

抽取前无需改业务代码：本目录自包含，对 `packages/*` / `apps/*` **零硬依赖**。

## 安全

- 禁止提交 Bearer Token、API Key、`Authorization` 实值、Cookie、邮箱密码 / 授权码。
- manifest 里只用占位符：`{{BEARER_TOKEN}}`、`{{AMAP_KEY}}`、`{{FEISHU_UAT}}`、`{{YUQUE_TOKEN}}`、`{{IMAP_PASS}}` 等。
- 支付 / 下单 / 发信 / 对外消息类工具后续接入时必须走与现有 MCP 相同的 HITL 审批（`needsApproval`）。
