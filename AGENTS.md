# OkBot 代理操作手册

给在本仓库改代码的 AI 用。产品行为细节以 `GUIDE.md` 为准；模块怎么连以 `DESIGN.md` 为准。两份手册都按当前代码写，改了对应实现就要改手册。

## 产品

OkBot 是跑在本机的个人桌面 AI 助手（Electron + React）。助手和小队的对话、工具、记忆都落在 `~/.okbot`，没有云端账号。同一份数据目录上，Electron 窗口和 `okbot serve` 共用一个网关进程；远程电脑是另一个进程 `sandbox-agent`，只执行 shell 和文件。

## 仓库布局

```text
apps/desktop/          Electron 壳、React UI、网关 HTTP、okbot serve
  electron/            main、preload、IPC、FileStorage、updater、localHttpApi、cli
  src/                 渲染进程（features/chat、settings、sidebar…）
  bin/okbot.mjs        只加载已构建的 out/main/cli.js
  out/                 electron-vite 产物（gitignore）。不是源码
packages/agent/        跑对话、工具、小队、压缩、执行后端
packages/shared/       设置类型与默认值、IpcChannels、LOCAL_COMPUTER_ID
apps/sandbox-agent/    远程电脑 HTTP（shell / fs），不是桌面网关
```

## 改哪里

| 要改的事 | 先看 |
| --- | --- |
| 聊天气泡、设置页、侧栏 | `apps/desktop/src/features/`，编排在 `src/App.tsx` |
| 窗口 IPC、存储、审批、更新安装 | `apps/desktop/electron/ipc/`、`electron/storage/`、`electron/updater.ts`、`electron/macUpdateInstall.ts` |
| 网关路由、`okbot serve`、附着窗口 | `electron/localHttpApi.ts`、`electron/cli.ts`、`electron/main.ts`、`electron/attachPreload.ts`、`src/bridge/httpOkbot.ts` |
| 模型调用、工具、电脑路由、压缩 | `packages/agent/src/`（`tools.ts`、`computerSelection.ts`、`executionBackend.ts`、`runAgentChat.ts`、`squad.ts`） |
| 定时任务（schedules.json / ticker） | `apps/desktop/electron/storage/schedules.ts`、`FileStorage` 的 schedule 方法、`scheduleTicker.ts`、工具 `manage_schedule`（默认 allow；create/delete 强制 HITL（含 AAR 不可旁路）；list 不审批）；编辑助手/小队里的 `SchedulesList.tsx` |
| 网页工具 | `packages/agent/src/webFetch.ts`、`webSearch.ts`；设置 `settings.web`；工具注册在 `tools.ts` |
| 聊天拖放附件 | Composer / 聊天区 DnD → 与附件选择器同一管线（见 GUIDE §3.4） |
| 助手市场（内置画廊 + GitHub 来源） | 内置 `packages/agent/src/assistantGallery.ts`；URL 解析 `githubAssistantSource.ts`；拉取 `electron/storage/fetchGithubAssistant.ts`；整页 UI `features/bots/AssistantMarketplacePage.tsx`（卡片列表仍用 `AssistantGallery.tsx`）；侧栏底部入口；文案键 `galleryTitle` 等 |
| 设置字段、IPC 通道名 | `packages/shared/src/index.ts`。改了字段要同时改 `FileStorage` 的读写和 normalize |
| 远程电脑协议 | `apps/sandbox-agent/src/server.ts`。桌面侧探测在 `probeRemoteComputer` |
| 产品行为说明 | `GUIDE.md` 对应章节。不要把开发向边界写进 README |

`out/`、`dist/`、`node_modules/` 是构建结果。不要手改。

## 构建和测试

Node `>=22.13`，包管理器 `pnpm@11.15.1`（见根 `package.json` 的 `packageManager`）。命令以仓库根目录为准：

| 命令 | 做什么 |
| --- | --- |
| `pnpm dev` | 先构建 `@okbot/shared` 和 `@okbot/agent`，再 `electron-vite dev` |
| `pnpm build` | shared + agent + `electron-vite build` |
| `pnpm typecheck` | 构建 shared，agent `tsc`，再 `pnpm -r typecheck` |
| `pnpm test` | `@okbot/shared test`、`@okbot/agent test`、`@okbot/desktop test`。不含 sandbox |
| `pnpm test:agent` | `pnpm --filter @okbot/agent test:smoke` |
| `pnpm test:sandbox` 或 `pnpm test:sandbox-agent` | `@okbot/sandbox-agent test` |
| `pnpm dist` | 即 `pnpm --filter @okbot/desktop dist:mac` |
| `pnpm dist:dir` | mac 目录包，不打 dmg |
| `pnpm publish:github` | desktop 的 `publish:github`。用户没要求就不要跑 |

桌面包自己的 `test` 是一串 `node --import tsx`（存储、网关、IPC、压缩、mac 更新安装等），清单在 `apps/desktop/package.json` 的 `scripts.test`。agent 的 `test` 同样是一串 `node --import tsx`，见 `packages/agent/package.json`。没有单独的测试框架配置文件。

`pnpm --filter @okbot/desktop build` 与 `pnpm dev`（经 `electron-vite`）都会按 `electron.vite.config.ts` 的 main `input` 把 `electron/cli.ts` 打成 `apps/desktop/out/main/cli.js`（带 `#!/usr/bin/env node`）。用法是 `node apps/desktop/out/main/cli.js serve`，或 `node apps/desktop/bin/okbot.mjs serve`（bin 只负责加载已构建的 `cli.js`）。没有单独的安装脚本，不要新造一个。

改完行为相关代码后，在仓库根目录跑 `pnpm typecheck` 与 `pnpm test`（或至少 `pnpm --filter @okbot/desktop test`）再收工。

## 进程

同一 `~/.okbot` 只允许一个服务听端口。Electron 启动时如果端口上已经是 OkBot，窗口只做界面（`attach` preload），关掉窗口不停那个进程。端口空闲时 Electron 自己 `listen`，退出时停掉。`okbot serve` 和 Electron 主进程走同一份 `localHttpApi`，不是两套服务。

## UI 约束

改渲染进程界面时：

- 优先复用已有共享 UI 组件（设置行、开关、列表、对话框、表头等），不要另起一套。
- 颜色 / 间距 / 圆角只走现有 token 或 CSS 变量，禁止临时写死新色值。
- 改一个控件时，同页同类控件一并对齐。
- 收工前对照相邻页面做一次快速视觉一致性检查。
- **Chrome 用边框，不用投影**：按钮、侧栏抽屉、弹层 / 对话框、菜单、卡片、toast 等避免 `box-shadow` / `drop-shadow` 软阴影；用 `--border` / `--hairline`、细描边与轻微背景填充表现层次。焦点环可用 `0 0 0 Npx` 描边式阴影，不算 elevation。目标是原生桌面（Electron / macOS / Windows）观感，而不是网页悬浮卡片。

## 文档约束

- `GUIDE.md` 不要写产品号，也不要出现「版本」这两个字。行为以代码为准，写进对应章节。
- `README.md` / `README_zh.md` 的功能条目是用户写的。不要为了「对齐实现」重写那些条目。根 README 保持短述，开发细节留在 `GUIDE.md`。
- 不要把密钥、真实令牌、`settings.json` 内容写进仓库文件。
