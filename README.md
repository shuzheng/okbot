# OkBot

个人桌面 AI 助手：左侧机器人 / 群聊列表，右侧对话框。

完整产品能力、UI 细节与关键代码路径见 **[GUIDE.md](./GUIDE.md)**（多轮上下文分层、来源与更新时机见其中 **§8.2**）。

> **文档同步规则：** 新功能或重要 UI 变更必须同步更新 `GUIDE.md` 与 `README.md`。

## 技术栈

- Electron + React + TypeScript + Vite（electron-vite）；单实例（再启动聚焦已有窗口）
- pnpm monorepo：`apps/desktop`、`packages/agent`、`packages/shared`
- 对话：`@openai/agents`（Chat Completions 模式，可接 DeepSeek / 自建网关）+ `openai` SDK
- 本机工具：`run_shell` / `read_file`（免批） / `write_file` / `edit_file`；写/执行先走设置里的自动审批规则，未命中再 HITL；`run_shell` 为个人机 regex 防护（非沙箱，见下）
- 设置 → **工具**：工具管理（启用 + 自动允许/询问；默认全开，仅 read_file 自动允许）；自动审批开关 + 关键词规则；**运行限制**（单轮最大工具调用默认 40、最大时长默认 600 秒、0=不限制；记录运行轨迹）
- 熔断硬限制：工具 `execute` 计数 + 墙钟超时（小队队长与队员嵌套工具共用预算）；对话顶栏可查看「本轮轨迹」
- 数据：纯文件 `~/.okbot`（`bots.json` 花名册；`<botId>/bot.json`（含 `useGlobalSkills` / `enabledGlobalSkills`）；`AGENTS.md` 系统提示（引导 + 高级可编 + 自动维护）；`session.jsonl`（v2 信封：每行 `{v:2,id,createdAt,item:AgentInputItem,meta?}`，经 SDK `Session` 注入模型历史；UI 气泡由 user/assistant 文本项投影）；用户/助手消息悬停可复制全文（用户侧最左、助手侧最右）；用户消息还可查看本轮完整上下文（由当前 SDK Session 项 + 此刻系统材料实时投影，不再落盘 `contexts/`）；`skills/<slug>/SKILL.md`（可选叠加 `~/.agents/skills` 已启用全局技能）；记忆：全局 `memory.md` + `<botId>/memory.md`（id/bot_id/memory/expires，自动+明确记住，注入上下文）；每轮按当前设置的模型上下文长度估大小，达到约 80%（含换小窗口模型后）时用 Summary+Buffer：默认保留最近 5 条原文，仅增量压缩新掉出的更早轮次并与旧摘要合并为结构化 ≤800 字摘要（目标/约定/路径/未完成/其他）写入 `session-summary.json`；发送时若判定为**新话题**则自动按同样规则压缩（保留最近缓冲，非 keep=0；可在设置关闭「自动换题压缩」）；完整上下文与模型窗口一致只显示摘要+未覆盖尾部，界面气泡历史不删；`resources/`）

## 当前范围

- 多助手：新建、搜索、右键改名 / 编辑资料（名称、描述、头像；默认**立体头像（新建随机形状）**，emoji 可选；两边颜色板均有「默认」— 立体=库色、emoji=无背景）；资料为**右侧通高抽屉**（与侧栏同高、贴右缘），**高级**可编 **指令**（AGENTS.md）、**记忆**、**私有技能**，并可开关选用 **全局技能**（`~/.agents/skills`）；新建后两步引导写入 AGENTS.md（场景含学习答疑 / 翻译润色 / 办公文档 / 资料检索 / 产品需求 / 运维排障等）；改名称/描述同步花名册与 AGENTS.md；**设置 → 系统指令 → AGENTS.md** 可改静默维护 system 与分析条数
- 侧栏展开态会话行显示上次更新时间（当天时刻 / 昨天 / 星期 / 月日 / 年月日）；折叠态 Dock 放大动效默认关（设置 → 通用可开）
- 单聊流式回复 + 本机工具审批（自动审批规则 → 未命中再 HITL）
- **中途改向**：回复未完成时仍可发送（1:1 / 小队）；停止钮独立保留；实现为 abort 当前跑并立即以完整历史重启（非排队等跑完）；旧跑中止以 `done.aborted` 结束，不再把 `Request was aborted` 抛成发送失败
- **对话 UX**：流式回复时未上滑则钉住底部（观察者 + 滞回阈值，避免误出「回到底部」）；发送失败时用户气泡右下角红色重试（1:1 / 小队 / 改向共用）
- **Skills（渐进披露）**：每助手 `skills/<slug>/SKILL.md` + 可选全局技能；系统提示仅注入**目录**（名称 / slug / 何时使用），匹配后经本机工具 `read_skill` 加载完整正文再执行；对话中可自动维护 / 刷新（**设置 → 系统指令 → 技能**可改判定指令与分析条数）
- **长期记忆**：全局 `memory.md` + 每助手 `memory.md`（JSONL：id / bot_id / memory / expires），自动 + 明确记住，注入上下文；**设置 → 系统指令 → 记忆**可改 scope 判定说明与分析最近消息条数；**设置 → 全局记忆**管理全局记忆列表；助手高级仍只管理本助手记忆
- **小队（Agents as Tools）**：星型拓扑，队长通过去重后的 `ask_*`（含 `_2` 后缀）串行咨询成员；与 1:1 共用 Summary+Buffer；用量按小队聚合计入 `byOwner`（详见 GUIDE §8–§9）
- 设置侧栏：通用设置 / 工具授权 / 安全防护 / 模型接入 / 系统指令 / 全局记忆 / 用量分析 / 自动更新。含主题、语言、**侧边栏缩起时的放大动效**（默认关）、麦克风、硬件加速、自定义供应商（可多条 BaseURL/API Key/API 格式含路径标注、模型目录；模型行连通测试；列表顺序稳定；默认模型仅下方拉）、全局默认模型（供应商→模型）、每模型上下文窗口与最大输出窗口、每模型「显示思考过程」（`<think>` 可折叠，默认真）、1:1 最大回合；**系统指令**（助手 | 小队 | AGENTS.md | 记忆 | 技能）；**全局记忆**列表；**工具授权**（开关与自动审批、运行限制）；**自动更新**独立 Tab；路径 / shell 安全防护
- **尚未**：MCP、复杂特效库；`run_shell` **不是** OS 沙箱（见下）

### `run_shell` 安全说明（诚实边界）

`run_shell` 面向**受信任的本机个人助手**，不是隔离边界：

- 用本机 shell（Windows：优先 PATH 中的 PowerShell Core `pwsh`，否则 `ComSpec`/cmd；其它：`SHELL` 或 zsh/bash）在用户环境（`process.env`）下执行，默认 cwd 为家目录
- Electron 渲染进程 `webPreferences.sandbox: false`（配合 preload / contextIsolation）
- 防护是 **regex 危险命令 denylist** + 路径前缀限制 + HITL / 自动审批，**不是**容器 / seatbelt / sandbox-exec
- 适合本地可信使用；不要当成多租户或不可信代码的执行沙箱

## 开发

```bash
cd ~/git/github/okbot-dev
pnpm install
# pnpm 11 若提示 Ignored build scripts：
pnpm approve-builds --all
pnpm --filter @okbot/shared build
pnpm --filter @okbot/agent build
pnpm dev

> 若启动报 `getaddrinfo ENOTFOUND localhost`：当前桌面已绑 `127.0.0.1`；也可在 `/etc/hosts` 补上 `127.0.0.1 localhost` 与 `::1 localhost`。
```

生产构建：

```bash
pnpm --filter @okbot/desktop build
pnpm --filter @okbot/desktop exec electron .
```

## 打包 / GitHub Releases / 自动更新

> **尚未正式发版。** 公开发布仓库为 `shuzheng/okbot`，日常开发在 `okbot-dev`；首发版本将是 `v0.1.0`。

版本以 `apps/desktop/package.json`（及根 `package.json`，保持同步）为准。

### 全平台正式发版（推荐）

推送版本标签即可触发 GitHub Actions（`.github/workflows/release.yml`），在 macOS / Windows / Ubuntu runners 上分别打包并上传到同一个 GitHub Release：

- macOS：DMG + ZIP（arm64、x64）
- Windows：NSIS（x64）
- Linux：AppImage（x64）

```bash
# 版本号已写在 package.json 时：
git tag v0.1.0
git push origin v0.1.0
# 或在 Actions 里用 workflow_dispatch
```

### 本机仅打 macOS 包

产物在 `apps/desktop/release/`。

```bash
pnpm dist          # 或 pnpm --filter @okbot/desktop dist:mac
pnpm dist:dir      # 未签名目录包，便于冒烟
# 仅 mac 上传（需 GH_TOKEN / gh 登录）：
pnpm publish:github
```

设置 → **自动更新**：开关「自动更新」（`autoUpdate`，默认开；已从「通用设置」迁出）。自动更新走 **electron-updater** + GitHub Releases。

> **诚实说明（当前早期构建）：** CI / 本机打出的 **macOS / Windows 包默认未签名、未 notarize**（`CSC_IDENTITY_AUTO_DISCOVERY=false`）。macOS Gatekeeper / Windows SmartScreen 可能拦截「打开」或静默更新；自动更新在未签名环境下**不保证**可顺利安装，需用户在系统里允许或手动下载 Release 资产。Linux AppImage 无同等代码签名要求。

## 数据目录

```text
~/.okbot/
  settings.json
  usage.json                     # token 用量：lifetime / daily / byOwner
  bots.json
  squads.json
  memory.md                      # 全局长期记忆（JSONL）
  logs/
    errors-YYYY-MM-DD.jsonl      # SDK/run 失败日志（保留 3 个日历日）
  <botId>/
    bot.json
    AGENTS.md
    memory.md                    # 助手级记忆
    skills/<slug>/SKILL.md
    session.jsonl                # v2 AgentInputItem 信封（SDK Session）
    session-summary.json         # Summary+Buffer 摘要
    last-run-trace.json          # 最近一轮工具/错误轨迹
    resources/
  <squadId>/                     # squad_YYYYMMDD_NN
    session.jsonl
    session-summary.json
    last-run-trace.json
```

## 冒烟

```bash
# 先在应用设置里保存模型，或导出环境变量后再测
pnpm test:agent
```

## License

见 `LICENSE`。
