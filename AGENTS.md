# OkBot 代理操作手册

给在本仓库改代码的 AI 用。产品行为细节以 `GUIDE.md` 为准；模块怎么连以 `DESIGN.md` 为准。两份手册都按当前代码写，改了对应实现就要改手册。

## 产品

OkBot 是跑在本机的个人桌面 AI 助手（Electron + React）。助手和小队的对话、工具、记忆都落在 `~/.okbot`，没有云端账号。同一份数据目录上，Electron 窗口和 `okbot serve` 共用一个网关进程；远程电脑是另一个进程 `sandbox-agent`，只执行 shell 和文件。

## 仓库布局

```text
apps/desktop/          Electron 壳、React UI、附着窗口
  electron/            main、preload、IPC、updater（存储与网关在 apps/gateway）
  src/                 渲染进程（features/chat、settings、sidebar…）
  bin/okbot.mjs        兼容 shim → apps/gateway/bin/okbot.mjs
  out/                 electron-vite 产物（gitignore）。不是源码
apps/gateway/          网关 HTTP、`okbot serve` CLI、server.json 存储
  src/cli.ts           源码入口 → 构建为 dist/cli.js
  src/storage/         FileStorage 门面 + 域 Store（bots/squads/session/…）
  bin/okbot.mjs        加载已构建的 dist/cli.js
packages/agent/        跑对话、工具、小队、压缩、执行后端
packages/shared/       设置 / 审批 / 文本 / IPC / trace 等模块；`src/index.ts` 只做 barrel 再导出
apps/sandbox-agent/    远程电脑 HTTP（shell / fs），不是桌面网关
```

## 改哪里

| 要改的事 | 先看 |
| --- | --- |
| 聊天气泡、设置页、侧栏 | `apps/desktop/src/features/`，编排在 `src/App.tsx` |
| 窗口 IPC、审批、更新安装 | `apps/desktop/electron/ipc/`、`electron/updater.ts`、`electron/macUpdateInstall.ts` |
| 网关路由、`okbot serve`、附着窗口 | `apps/gateway/src/gatewayHttpApi.ts`、`apps/gateway/src/cli.ts`、`apps/desktop/electron/main.ts`、`electron/attachPreload.ts`、`src/bridge/httpOkbot.ts` |
| 模型调用、工具、电脑路由、压缩 | `packages/agent/src/`（`tools.ts`、`computerSelection.ts`、`executionBackend.ts`、`runAgentChat.ts`、`squad.ts`、`mesh.ts` 私聊 `ask_assistant`） |
| 定时任务（schedules.jsonl / ticker） | `apps/gateway/src/storage/ScheduleStore.ts`（经 `FileStorage` 门面）、`scheduleTicker.ts`、工具 `manage_schedule`（默认 allow；create/delete 强制 HITL（含 AAR 不可旁路）；list 不审批）；编辑助手/小队里的 `SchedulesList.tsx`（暂停 / 恢复 / `requestConfirm` 删除） |
| 网页工具 | `packages/agent/src/webFetch.ts`、`webSearch.ts`；设置 `settings.web`；工具注册在 `tools.ts` |
| 聊天粘贴 / 拖放附件 | Composer 粘贴与聊天区 DnD → 上传到网关 `~/.okbot/<owner>/uploads/`（见 GUIDE §3.4）；文件夹仍为路径引用 |
| 助手市场（助手 Tab + 连接器 Tab） | 内置 `packages/agent/src/assistantGallery.ts`；URL 解析 `githubAssistantSource.ts`；拉取 `apps/gateway/src/storage/fetchGithubAssistant.ts`；整页 UI `features/bots/AssistantMarketplacePage.tsx`（助手画廊 `AssistantGallery.tsx`；连接器预设 `marketplaceConnectors.ts`）；侧栏底部入口；文案键 `galleryTitle` / `galleryTabAssistants` / `galleryTabConnectors` 等 |
| 设置字段、IPC 通道名、ChatStartPayload | `packages/shared/src/`（`settings.ts` / `ipc.ts` / `chat.ts` 等；`index.ts` 为 barrel）。改了字段要同时改 `SettingsStore`（经 `FileStorage` 门面）的读写和 normalize；聊天启动字段走 `ChatStartPayload` / `CHAT_START_*_KEYS` |
| 远程电脑协议 | `apps/sandbox-agent/src/server.ts`。桌面侧探测在 `probeRemoteComputer` |
| 扩展面（工具 / MCP / skills / 供应商 / 电脑） | [`docs/extension-surfaces.md`](./docs/extension-surfaces.md)；无独立 plugin runtime |
| 产品行为说明 | `GUIDE.md` 对应章节。不要把开发向边界写进 README |

`out/`、`dist/`、`node_modules/` 是构建结果。不要手改。

## 构建和测试

Node `>=22.13`，包管理器 `pnpm@11.15.1`（见根 `package.json` 的 `packageManager`）。命令以仓库根目录为准：

| 命令 | 做什么 |
| --- | --- |
| `pnpm dev` | 先构建 `@okbot/shared` 和 `@okbot/agent`，再 `electron-vite dev` |
| `pnpm build` | shared + agent + `electron-vite build` |
| `pnpm typecheck` | 构建 shared，agent `tsc`，再 `pnpm -r typecheck` |
| `pnpm test` | `@okbot/shared`、`@okbot/agent`、`@okbot/desktop` 的 `test`。不含 sandbox |
| `pnpm test:agent` | `pnpm --filter @okbot/agent test:smoke` |
| `pnpm test:sandbox` 或 `pnpm test:sandbox-agent` | `@okbot/sandbox-agent test`（CI 也会跑） |
| `pnpm lint` | 根目录 ESLint（typescript-eslint 推荐子集；未使用变量等为 warn） |
| `pnpm dist` | 即 `pnpm --filter @okbot/desktop dist:mac` |
| `pnpm dist:dir` | mac 目录包，不打 dmg |
| `pnpm publish:github` | desktop 的 `publish:github`。用户没要求就不要跑 |

各包 `test` 用根目录 `scripts/run-node-tests.mjs` 按 glob 发现 `*.test.ts` / `*.test.mjs`（跳过 `node_modules` / `dist` / `out`）。shared 先 `build` 再跑；agent / desktop 用 `node --import tsx`。新建 `*.test.ts` 会自动被跑到，不必改 `package.json`。

`okbot serve` 源码在 `apps/gateway/src/cli.ts`，由 `pnpm --filter @okbot/gateway build` 打成 `apps/gateway/dist/cli.js`（带 shebang）。桌面 `pnpm --filter @okbot/desktop build` / `pnpm dev` 会级联构建 gateway。用法是 `node apps/gateway/dist/cli.js serve`，或 `node apps/gateway/bin/okbot.mjs serve`（bin 只负责加载已构建的 `cli.js`）。没有单独的安装脚本，不要新造一个。

改完行为相关代码后，在仓库根目录跑 `pnpm typecheck` 与 `pnpm test`（或至少 `pnpm --filter @okbot/desktop test`）再收工。

## 进程

Gateway vs Electron 职责表与惰性 `require('electron')` 说明见 [`DESIGN.md`](./DESIGN.md#gateway-vs-electron-边界)。

同一数据根（默认 `~/.okbot`）只允许一个服务听端口。`okbot serve` 可用成对的 `--port` + `--data-dir` 启隔离实例；缺一不可。本地 Electron 桌面客户端只连接默认根 `~/.okbot`（及其 server.json 端口，默认 18765），不扫描其它 data-dir。Electron 启动时如果默认端口上已经是 OkBot，窗口只做界面（`attach` preload），关掉窗口不停那个进程。端口空闲时 Electron 自己 `listen`，退出时停掉。`okbot serve` 和 Electron 主进程走同一份 `gatewayHttpApi`，不是两套服务。

## UI 约束

改渲染进程界面时：

- 优先复用已有共享 UI 组件（设置行、开关、列表、对话框、表头等），不要另起一套。
- 颜色 / 间距 / 圆角只走现有 token 或 CSS 变量，禁止临时写死新色值。
- 改一个控件时，同页同类控件一并对齐。
- 收工前对照相邻页面做一次快速视觉一致性检查。
- **Chrome 用边框，不用投影**：按钮、侧栏抽屉、弹层 / 对话框、菜单、卡片、toast 等避免 `box-shadow` / `drop-shadow` 软阴影；用 `--border` / `--hairline`、细描边与轻微背景填充表现层次。焦点环可用 `0 0 0 Npx` 描边式阴影，不算 elevation。目标是原生桌面（Electron / macOS / Windows）观感，而不是网页悬浮卡片。

## 文档约束

- 单一事实来源：`DESIGN.md` = 架构与边界；`GUIDE.md` = 产品行为；`AGENTS.md` = 本仓库改码流程。重叠的 HTTP 路由表 / 数据目录 / 工具默认值只在权威文档保留一份，其它处交叉引用。
- 只写终态，不写迁移笔记；不写本机绝对路径或内部仓库名。
- `GUIDE.md` 不要写产品号，也不要出现「版本」这两个字。行为以代码为准，写进对应章节。
- `README.md` / `README_zh.md` 的功能条目是用户写的。不要为了「对齐实现」重写那些条目。根 README 保持短述，开发细节留在 `GUIDE.md`。
- 不要把密钥、真实令牌、`settings.json` 内容写进仓库文件。
