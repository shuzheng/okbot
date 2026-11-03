# 连接器：邮箱（Email · wave-2 office）

- **定位**：Wave-2 办公邮件渠道的**通用**连接器（非生活服务）。推文将「邮箱」与飞书/钉钉/企微/语雀并列，**未点名单一 MCP 品牌**。
- **投影**：IMAP + SMTP（可读任意支持 IMAP 的邮箱；发信走 SMTP）
- **国内常用预设**：QQ 邮箱、网易 163、企业邮（自填主机）
- **鉴权**：IMAP/SMTP 主机 + 账号 + 客户端专用密码（不入库）
- **安全**：发送默认关闭（`SMTP_SEND_ENABLED=false`）；发送/转发须 HITL
- **参考实现**：如 `@aiwerk/mcp-server-imap`（可替换为其他兼容 MCP）

Stub only。日后可扩展 QQ/163 Web API 或托管 MCP；本清单保持协议层通用。
