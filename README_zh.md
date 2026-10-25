<h1>
  <img src="apps/desktop/src/assets/okbot-icon.png" alt="" width="48" valign="middle" />
  OkBot
</h1>

<p>
  <a href="./README.md">English</a> · <strong>中文</strong>
</p>

[![GitHub release](https://img.shields.io/github/v/release/shuzheng/okbot?display_name=tag)](https://github.com/shuzheng/okbot/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](https://github.com/shuzheng/okbot/releases)
[![GitHub stars](https://img.shields.io/github/stars/shuzheng/okbot)](https://github.com/shuzheng/okbot/stargazers)
[![Downloads](https://img.shields.io/github/downloads/shuzheng/okbot/total)](https://github.com/shuzheng/okbot/releases)

**OkBot 是面向桌面的本地优先 Personal Agent。**  
把 AI 当成永久联系人（人设 + 记忆与进化），真正可执行的工具（经人机审批），长程任务、定时任务，Squad + Mesh 成员协作，自托管个人网关（`okbot serve`），多机执行，以及市场与助手包。自备模型，安全与可观测内置。MIT 开源。

## 什么是 Personal Agent？

在 2026 年的讨论里，**Personal Agent（个人 Agent）** 既不同于聊天机器人，也不同于编程 Agent：

| | 聊天标签页 / 网页 Chatbot | 编程 Harness / CLI 插件 | **OkBot（Personal Agent）** |
| --- | --- | --- | --- |
| **形态** | 对话框里回答；会话淡去 | 活在终端或 IDE，面向软件工程 | 桌面应用 + 可选无界面网关 |
| **身份** | 通用聊天 | 仓库 / 任务范围 | 有名字的助手：头像、`SOUL.md`、记忆 |
| **行动** | 主要是文本 | 仓库工具 / 补丁 | Shell、文件系统、网页等——配合 **HITL** 审批 |
| **多智能体** | 少见 | 编程循环里的 Agent 团队 | **小队（Squad）**（队长编排）+ **Mesh**（1:1 互聊求助） |
| **常驻** | 标签页要开着 | 按任务调用 | 定时任务 + 本机 `okbot serve` |
| **模型** | 厂商锁定或自备 | 通常自备 | **自备**云端 API 或本地 URL——OkBot 不托管推理 |
| **数据** | 常在云端 | 本地仓库 + 厂商 | 网关主机上的 `~/.okbot` |

OkBot 属于第三类：桌面原生 Personal Agent，IM 式「把助手当人」的交互，真正可执行的工具，以及可无界面跑在你自己机器上的开源 MIT 网关。

## 为什么选 OkBot

- **长程任务** — 自动拆解任务、状态持久化、任务恢复、自动修正并继续推进、多任务管理
- **自托管个人网关** — `okbot serve`（以及 Electron 附着）跑在本机或局域网，可选 Web UI；无需 OkBot 云端账号
- **多台运行电脑** — 默认本机执行；经 `sandbox-agent` 登记远程主机，一网关连多机
- **成员自动协作** — **小队（Squad）** 由队长编排完成你分配的任务；**Mesh** 让 1:1 助手向花名册同伴求助
- **跨会话记忆与进化** — 重要信息跨会话记住；跑后静默刷新 `SOUL.md` / 技能 / 记忆，助手随使用演进
- **自备模型 · 安全 · 可观测** — 接入你已有的供应商（OkBot 不托管推理）；HITL、路径与危险命令防护、令牌权限；轻量 Token 与链路追踪
- **市场与助手包** — 应用内市场安装入门助手与连接器；导出 / 导入 `.okbot` 助手包，也可从公开 GitHub 源导入

## 功能特性

### 助手、小队与 Mesh

- 把助手当人来建：名称、头像、人设（`SOUL.md`），像加联系人一样开始聊
- 把多位助手组成 **小队**（队长编排），你分配任务，他们协作完成
- **Mesh**：在 1:1 会话中，助手可向花名册中其他同伴求助（状态行 + 只读往来面板）

### 市场与助手包

- 应用内 **市场** 安装入门助手与推荐 MCP 连接器
- 导出 / 导入助手包（`.okbot`）；也可从公开 GitHub 源导入（仓库、目录或 `.okbot` 直链）

### 聊天体验

- 类 IM 流式对话：中途可改向、失败可重试、始终贴着最新消息
- 拖放（或粘贴）文件、图片、文件夹到输入区
- 本机 **Whisper** 语音输入——不依赖云端语音 API

### 技能、记忆、进化与定时

- 技能：目录进系统提示，全文按需（`read_skill`）；**热更新**监视技能目录，下一轮即拾取文件改动
- 重要信息跨会话记住（全局 + 每助手记忆）
- 跑后 **进化**：节流静默刷新 `SOUL.md`、技能与记忆，助手随使用演进
- **长程任务**：持久化任务清单（`manage_task_progress`）——自动拆解步骤、状态落盘、中断后恢复、未完成则自动续跑并修正进度、多任务排队推进
- **定时任务**：可让助手按日程唤醒；在产品内查看、暂停或删除任务

### 模型、安全与工具

- 自备供应商（按你配置的 Chat Completions / Responses 类接口）——OkBot 不托管推理
- 内置工具：Shell、文件系统、网页拉取 / 搜索、文生图（供应商支持时）等
- 人机审批（HITL）与可选自动审批规则；路径前缀检查与危险命令 denylist；网关 API 令牌配额 / 权限；**MCP** 可选，默认关闭

### 电脑

- 默认在 **本机** 执行工具
- 可通过 `sandbox-agent` 登记 **远程** 电脑（另一台主机或容器上的 HTTP shell / fs）——一网关、多台运行电脑

### 自托管个人网关

- `okbot serve` 以前台方式启动网关，不打开桌面窗口——跑在你自己硬件上的无界面 Personal Agent 宿主
- 可选绑定局域网并提供 Web UI，内网手机或浏览器使用同一套聊天
- 若网关已在运行，Electron 会附着上去，而不会再拉起第二个

### 可观测性

- 轻量 Token 用量统计与消息级链路 / 日志——够排查，不是完整 APM

## 安装（三步）

1. **下载** 从 **[GitHub Releases](https://github.com/shuzheng/okbot/releases/latest)** 获取对应平台最新构建：

   | 平台 | 产物 |
   | ---- | ---- |
   | macOS | `.dmg` / `.zip`（arm64 与 x64） |
   | Windows | NSIS 安装包（x64） |
   | Linux | `.AppImage`（x64） |

2. **打开** OkBot（单实例：再次启动会聚焦已有窗口）。早期构建可能**未签名**——若你信任该下载，可在系统设置中允许。

3. 在设置中 **添加模型供应商**，**创建一个助手**（像加联系人），开始聊天。工具需要审批时，可单次允许、记住规则，或拒绝。

数据目录：网关主机上的 `~/.okbot/`。网关设置：`server.json`；持久数据在 `data/`（bots、会话、记忆、日志）。进程锁：`runtime.json`。Electron **客户端**偏好都在本机 `client.json`（壳层 + 嵌套 `window` + 嵌套 `gateways`），同在 `~/.okbot`，不作为远程网关设置上传。

## 使用场景

OkBot 把 **UI**（桌面或浏览器 Web UI）与 **Personal Agent 网关**（`~/.okbot` 的所有者）分开。UI 同一时间只附着 **一个** 网关；该网关可连接 **多台** 电脑。工具可在网关本机执行，也可落到登记的远程电脑。常见组合：

### 1. 本地应用 + 本地网关

日常默认：桌面 Electron 在本机拥有或附着网关。聊天与数据落在本地 `~/.okbot`。

- 冷启动且尚无网关 → Electron 自动拉起网关
- 已有 `okbot serve`（或其它已占用的网关）→ 桌面 **附着**，不会再起第二个进程

```text
[ Desktop Electron ] ──IPC/HTTP──► [ 本机网关 ]
                                         └── ~/.okbot
```

### 2. 本地应用 / Web UI + 远程网关

UI 在你的笔记本上；网关跑在另一台可达主机（局域网 `bindLan` / `okbot serve`，或可访问的 URL）。聊天与数据在 **网关所在机器** 的 `~/.okbot`。在客户端保存远程网关地址与令牌，再 **切换** 当前网关（重启后生效）。

```text
[ Electron 附着  或  浏览器 Web UI ]
              │  HTTP + token
              ▼
[ 远程主机上的网关 ] ── ~/.okbot（在该主机上）
```

### 3. 本地应用 / Web UI + 远程网关 + 远程电脑

与（2）相同，额外通过 **`sandbox-agent`**（HTTP shell / fs）在已登记的远程机器上执行工具。Personal Agent 宿主（网关）仍在远程网关机器上；电脑是额外的执行目标。

```text
[ Electron / Web UI ] ──HTTP──► [ 远程网关 + ~/.okbot ]
                                      │
                                      ├── 本机工具（网关主机）
                                      └── remote → sandbox-agent（其它主机）
```

## 连接模型

Personal Agent 的连接拓扑是 **一个 UI ↔ 一个当前网关 ↔ 多台电脑**：

1. **Electron / Web UI → 网关** — 客户端同一时间只连接 **一个** 网关（本机或远程）。可在已保存的网关之间 **切换**；重启后生效。
2. **网关 → 电脑** — 该网关连接 **多台** 电脑（内置本机 + 远程 `sandbox-agent` 条目）。工具可按产品已有能力指定一台或批量目标。

```text
Electron / Web UI  ──(当前唯一)──►  网关（本机或远程）
                                            │
                                            ├── 本机电脑（始终可用）
                                            ├── 远程沙箱 A
                                            └── 远程沙箱 B …
```

客户端偏好只保存 **附着哪台网关**。电脑列表保存在 **网关所在主机**（该主机 `~/.okbot` 下的 `settings.computers`），不在客户端的网关列表里。

## 命令行（CLI）

`okbot` CLI 用于无界面网关与常用运维：

| 命令 | 作用 |
| ---- | ---- |
| `okbot serve` | 前台启动网关 |
| `okbot status` | 查看网关是否在运行 |
| `okbot stop` / `restart` | 停止，或停止后重启 |
| `okbot config` | 查看或修改 gatewayHttpApi 配置 |
| `okbot token` | 查看或重置访问令牌 |
| `okbot data` | 打印或打开数据目录 |
| `okbot help` / `version` | 帮助与版本 |
| `--lang zh\|en` | 界面语言（亦可用 `OKBOT_LANG` / `LANG`） |

```bash
okbot serve                 # 启动网关（打印地址与令牌各一次）
okbot status
okbot config
okbot stop
okbot help --lang zh
```

**从源码使用：** 根目录 `package.json` 的 `bin` 指向 `apps/gateway/bin/okbot.mjs`，它会加载 `apps/gateway/dist/cli.js`。请先构建 gateway：

```bash
pnpm --filter @okbot/gateway build
# 然后: pnpm exec okbot serve   （或链接 / 指向该 bin）
```

桌面安装包也可能随应用附带 CLI；若仅安装二进制，以对应平台的发版说明为准。

## 架构

网关（`Electron main` 或 `okbot serve`）是 Personal Agent 的宿主进程：同一时间只有一个进程拥有 `~/.okbot`。网关已在运行时，桌面会经 HTTP 附着；关掉窗口**只会**停掉由 Electron 自己拉起的网关。UI ↔ 网关 ↔ 电脑的拓扑见上方 **连接模型**。

```text
Renderer (React)
    │  IPC (owned window)  or  HTTP (attach / browser)
    ▼
Electron main  OR  `okbot serve`   ← one owner of ~/.okbot gateway
    │
    ├── gatewayHttpApi (gateway HTTP + optional Web UI)
    ├── packages/agent (models, tools, squads, mesh)
    │       ├── local ExecutionBackend
    │       └── remote → sandbox-agent
    └── FileStorage → ~/.okbot
```

更细的模块边界、HTTP 路由与存储布局见 **[DESIGN.md](./DESIGN.md)**。

## 仓库结构

```text
apps/desktop/          Electron 壳 + React UI
apps/gateway/          无界面网关 + `okbot` CLI（`okbot serve`、status、stop 等）
apps/sandbox-agent/    远程电脑 HTTP（shell / fs）
packages/agent/        模型、工具、小队、Mesh、压缩、执行后端
packages/shared/       类型、设置、IPC 常量、RuntimeEvent
```

## 数据与隐私

- 产品数据默认落在网关所在机器的 `~/.okbot`——无需 OkBot 云端账号
- 创建目录时收紧权限（`0700`）；`server.json`（模型 API Key、网关令牌、电脑令牌）以 `0600` 写出
- 密钥留在本地设置；产品内备份可选择不含密钥导出
- 模型请求打向**你配置的**供应商 base URL——OkBot 不托管推理

## 文档

| 文档 | 读者 |
| ---- | ---- |
| [GUIDE.md](./GUIDE.md) | 产品行为、UI、工具、设置 |
| [DESIGN.md](./DESIGN.md) | 架构、网关 HTTP、存储 |
| [AGENTS.md](./AGENTS.md) | 贡献者与编码 Agent 约定 |
| [docs/](./docs/) | 补充设计笔记 |

## 从源码开发

需要 **Node ≥ 22.13** 与 **pnpm**（见根目录 `package.json` 的 `packageManager`）。

```bash
pnpm install
pnpm approve-builds --all   # 若 pnpm 11 提示忽略了构建脚本
pnpm dev
```

常用脚本：`pnpm test`、`pnpm build`、`pnpm typecheck`。使用 gateway CLI 前需 `pnpm --filter @okbot/gateway build`，以便加载 `dist/cli.js`。

## 参与贡献

欢迎 Issue 与 Pull Request。较大改动前请阅读 [GUIDE.md](./GUIDE.md)、[DESIGN.md](./DESIGN.md) 与 [AGENTS.md](./AGENTS.md)，并保持 PR 聚焦。

## 许可证

[MIT](./LICENSE) © 2026 张恕征
