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
把 AI 当成永久联系人（人设 + 记忆），真正可执行的工具（经人机审批），定时唤醒，Squad + Mesh 多智能体，个人网关（`okbot serve`），以及多机执行。自备模型。MIT 开源。隐私与 `~/.okbot` 是支撑能力，不是唯一卖点。

<!-- ![OkBot 桌面](docs/assets/okbot-hero.gif) -->
<p align="center">
  <em>【截图 / GIF 占位 — 桌面花名册 + 对话】</em>
</p>

## 什么是 Personal Agent？

| | 聊天标签页 / 网页 Chatbot | 编程 Harness / CLI 插件 | **OkBot（Personal Agent）** |
| --- | --- | --- | --- |
| **形态** | 对话框里回答；会话淡去 | 终端 / IDE，面向软件工程 | 桌面应用 + 可选无界面网关 |
| **身份** | 通用聊天 | 仓库 / 任务范围 | 有名字的助手：头像、`SOUL.md`、记忆 |
| **行动** | 主要是文本 | 仓库工具 / 补丁 | Shell、文件系统、网页——配合 **HITL** 审批 |
| **多智能体** | 少见 | 编程循环里的 Agent 团队 | **小队（Squad）** + **Mesh**（1:1 互聊求助） |
| **常驻** | 标签页要开着 | 按任务调用 | 定时任务 + `okbot serve` |
| **模型** | 厂商锁定或自备 | 通常自备 | **自备**——OkBot 不托管推理 |

## 功能特性

- **助手即联系人** — 名字、头像、人设（`SOUL.md`）；像 IM 一样聊
- **Squad + Mesh** — 小队协作；1:1 助手可向同伴求助
- **共享助手包** — 导出 / 导入 `.okbot`；助手库入门包；公开 GitHub 导入
- **HITL 工具** — Shell、文件系统、网页等，配合审批
- **技能与记忆** — 渐进目录、热更新、跨会话记忆
- **定时任务** — 按日程唤醒；在产品内管理
- **个人网关** — `okbot serve` 无界面运行，可选局域网 Web UI
- **远程电脑** — `sandbox-agent` 在其它主机上提供 HTTP shell / fs
- **自备模型** — 接入你已有的供应商
- **语音与可观测** — 本机 Whisper；轻量 Token 统计与运行日志

## 安装（三步）

1. **下载** 从 **[GitHub Releases](https://github.com/shuzheng/okbot/releases/latest)** 获取：

   | 平台 | 产物 |
   | ---- | ---- |
   | macOS | `.dmg` / `.zip`（arm64 与 x64） |
   | Windows | NSIS 安装包（x64） |
   | Linux | `.AppImage`（x64） |

2. **打开** OkBot（单实例）。早期构建可能**未签名**——若你信任该下载，可在系统设置中允许。

3. **添加模型供应商**，**创建一个助手**，开始聊天。工具需要审批时，可允许、记住规则，或拒绝。

数据目录：网关主机上的 `~/.okbot/`。

## 文档

产品行为与开发说明见 **[GUIDE.md](./GUIDE.md)**。架构见 **[DESIGN.md](./DESIGN.md)**（若本发版树中包含）。

## 从源码开发

需要 **Node ≥ 22.13** 与 **pnpm**：

```bash
pnpm install
pnpm approve-builds --all   # 若 pnpm 11 提示忽略了构建脚本
pnpm dev
```

## 许可证

[MIT](./LICENSE) © 2026 张恕征
