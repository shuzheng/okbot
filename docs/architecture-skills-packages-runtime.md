# 架构：Skills 渐进披露、助手包、统一 RuntimeEvent

> 描述当前实现的分层与边界（不含产品版本号）。

## 目标

1. **Skills 渐进披露 + 热更新**：系统提示只注入技能目录（名称 / slug / 何时使用）；完整 `SKILL.md` 经 `read_skill` 按需加载；磁盘变更无需重启应用即可被下一轮对话与 UI 感知。
2. **助手安装包**：导入 / 导出文件夹或 `.okbot`（zip），含头像、名称、人设（description + AGENTS.md）、`skills/`；导出剥离密钥。
3. **统一 RuntimeEvent**：桌面 IPC、本机 HTTP API / Gateway SSE、云电脑 exec 适配共用同一事件模型，避免三套状态机。

## 分层

```text
domain（packages/shared + packages/agent）
  RuntimeEvent / BotSkill / 包清单类型
  formatSkillCatalog / parseSkillMarkdown / buildAssistantPackage
  encodeRuntimeEventSse / ExecStreamEvent
runtime（packages/agent）
  buildTools(read_skill) / hitl 循环 / ExecutionBackend
  SkillHotReloadHub（fs.watch → skills_changed）
adapters（apps/desktop/electron）
  FileStorage（磁盘） / IPC / localHttpApi SSE / remote SSE→formatted
  UI：侧栏右键「导出助手」、侧栏 +「导入助手」；高级区（默认折叠）只做技能编辑
storage
  ~/.okbot/<botId>/{bot.json,AGENTS.md,skills/*/SKILL.md}
  包文件：manifest.json + AGENTS.md + skills/
```

## Skills 渐进披露

| 位置 | 职责 |
|------|------|
| `packages/agent/src/skills/catalog.ts` | 目录文本拼装（不含正文） |
| `packages/agent/src/skills/parse.ts` | SKILL.md 解析 / 序列化 |
| `packages/agent/src/tools.ts` | `read_skill` 按 slug 取正文 |
| `FileStorage.formatSkillsForPrompt` | 读盘 → catalog |
| `SkillHotReloadHub` | watch → `RuntimeEvent.skills_changed` |

热更新语义：watch 仅发信号；**每轮对话仍从磁盘重读目录与 lookup**，因此改文件后无需重启进程。

## 助手包

- 格式 id：`okbot-assistant`（`manifest.json`）
- 导出：`exportAssistantPackage` → 目录或 `.okbot` zip；`stripSecrets` 去掉 apiKey/token 等
- 导入：新建助手 + 写入 AGENTS.md / skills；`onboardingComplete=true`
- UI：侧栏助手右键 **导出助手**（文件夹或 `.okbot`，剥离密钥）；侧栏 **+** 菜单在 **新建小队** 之后为 **导入助手**。导入成功后立刻 `listBots` 刷新侧栏会话列表。

## RuntimeEvent

单一联合类型（`packages/shared`）：`delta | done | error | user_message | assistant_message | tool_request | tool_result | skills_changed`。

| 消费者 | 方式 |
|--------|------|
| 桌面 renderer | `onRuntimeEvent`（IPC `okbot:chat-event`） |
| Gateway / localHttpApi | SSE `event: <type>` + `data: <RuntimeEvent JSON>`（`encodeRuntimeEventSse`） |
| 云电脑 shell | `ExecStreamEvent`（stdout/stderr/done）→ remote backend 折叠为同一 `formatted` 字符串，工具层不感知第二套状态机 |

## 设计约束

- 高内聚、低耦合；优先改 `packages/agent` / `packages/shared`
- 早期产品：就地清洁演进，不为旧格式留 shim
- id / 文案前缀：`okbot`
- GUIDE.md 不写版本号；高级 UI 默认隐藏
