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

每个助手都是一个**人**，有名字、头像和性格，让对话可以持续进行，而不是每次从一次性任务开始。打开就能聊，几乎不用设置；可小队自动协作。数据全部留在本机 `~/.okbot`，无需云端账号。

## 功能特性

- **助手** — 把助手当人来建：名称、头像；当IM来聊天
- **小队** — 把几位助手组成团队，你分配任务，他们自动协作完成
- **共享助手** — 可导出/导入助手包（名称、头像、人设、技能）
- **远程电脑** — 连接云电脑，可在不同电脑上执行
- **私有化部署** — 可用 `okbot serve` 只开服务、不打开窗口，或启用局域网网关，在浏览器打开同一套聊天界面；数据始终留在本地
- **沉浸式对话** — 像 IM 微窗口一样流式回复，中途可改向，发送失败可重试，始终贴着最新消息看
- **技能与记忆** — 需要时才展开技能；跨会话记住重要的事
- **模型支持** — 接入你已有的模型供应商，选好模型就能聊
- **语音输入** — 本机 Whisper 转写（不依赖云端语音 API）
- **定时任务** — 让助手按日程唤醒；设置 → 工具可查看、暂停或删除
- **网页工具** — 拉取公开网页与联网搜索（搜索需在设置中配置 API Key）
- **拖放附件** — 把文件、图片或文件夹拖进聊天区即可附加
- **可观测性** — 轻量 Token 统计和运行日志

## 安装

请从 **[GitHub Releases](https://github.com/shuzheng/okbot/releases/latest)** 下载对应平台的最新构建：

| 平台 | 产物 |
| ---- | ---- |
| macOS | `.dmg` / `.zip`（arm64 与 x64） |
| Windows | NSIS 安装包（x64） |
| Linux | `.AppImage`（x64） |

> 早期构建可能**未签名**。macOS Gatekeeper 或 Windows SmartScreen 首次打开时可能提示拦截——若你信任该下载，可在系统设置中允许。在正式签名发版之前，自动更新也可能受限。

## 快速开始

1. 安装并打开 OkBot（单实例：再次启动会聚焦已有窗口）。
2. 如有提示，在 **设置** 中添加模型供应商，然后创建一个助手——就像加一位联系人。
3. 开始聊天。工具需要审批时，可单次允许、记住规则，或拒绝。
4. 需要时再打开进阶设置（工具、安全、记忆、更新等）。

数据目录：`~/.okbot/`（设置、助手、会话、记忆、日志等）。

## 文档

产品能力、UI 细节与开发说明见 **[GUIDE.md](./GUIDE.md)**。

## 参与贡献

欢迎 Issue 与 Pull Request。架构、存储布局、IPC 等细节请先阅读 [GUIDE.md](./GUIDE.md)。

从源码运行（Node ≥ 22.13，pnpm）：

```bash
pnpm install
pnpm approve-builds --all   # 若 pnpm 11 提示忽略了构建脚本
pnpm dev
```

## 许可证

[MIT](./LICENSE) © 2026 张恕征
