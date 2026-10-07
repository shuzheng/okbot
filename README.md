<h1>
  <img src="apps/desktop/src/assets/okbot-icon.png" alt="" width="48" valign="middle" />
  OkBot
</h1>

<p>
  <strong>English</strong> · <a href="./README_zh.md">中文</a>
</p>

[![GitHub release](https://img.shields.io/github/v/release/shuzheng/okbot?display_name=tag)](https://github.com/shuzheng/okbot/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](https://github.com/shuzheng/okbot/releases)
[![GitHub stars](https://img.shields.io/github/stars/shuzheng/okbot)](https://github.com/shuzheng/okbot/stargazers)
[![Downloads](https://img.shields.io/github/downloads/shuzheng/okbot/total)](https://github.com/shuzheng/okbot/releases)

Each assistant is a **person** with a name, avatar, and personality, so conversations feel continuous rather than task-based. Start chatting with almost no setup; squads can collaborate automatically. Your data stays local under `~/.okbot`, with no cloud account required.

## Features

- **Assistants** — Create an assistant as a person: name and avatar, then chat like an IM
- **Squads** — Group assistants into a team; you assign the task, they collaborate
- **Shared assistants** — Export and import assistant packs (name, avatar, persona, skills); marketplace ships starters and can import from public GitHub sources
- **Remote computers** — Connect cloud computers and run on different machines
- **Private deployment** — Run `okbot serve` without a window, or turn on the LAN gateway and open the same chat in a browser; data stays on your machine
- **Immersive chat** — Stream replies like an IM window, steer mid-turn, retry a failed send, stay on the latest message
- **Skills and memory** — Skills open only when needed; important things are remembered across chats
- **Models** — Connect the providers you already have and pick a model
- **Voice input** — On-device Whisper transcription (no cloud speech API)
- **Scheduled tasks** — Ask an assistant to wake on a schedule; review, pause, or delete jobs in Settings → Tools
- **Web tools** — Fetch public pages and search the web (search needs an API key in Settings)
- **Drag-and-drop attachments** — Drop files, images, or folders into the chat to attach them
- **Observability** — Light token stats and run logs

## Install

Download the latest build for your platform from **[GitHub Releases](https://github.com/shuzheng/okbot/releases/latest)**:

| Platform | Artifact |
| -------- | -------- |
| macOS | `.dmg` / `.zip` (arm64 & x64) |
| Windows | NSIS installer (x64) |
| Linux | `.AppImage` (x64) |

> Early builds may be **unsigned**. macOS Gatekeeper or Windows SmartScreen can warn on first open — allow the app in system settings if you trust the download. Auto-update may be limited until signed builds are available.

## Quick start

1. Install and open OkBot (single-instance: launching again focuses the existing window).
2. Add a model provider in **Settings** if prompted, then create an assistant — like adding a contact.
3. Chat. When a tool needs approval, allow it once, remember the rule, or deny it.
4. Open advanced settings only when you want them (tools, security, memory, updates, and more).

Data directory: `~/.okbot/` (settings, bots, sessions, memories, logs).

## Documentation

Product behavior, UI details, and developer notes: **[GUIDE.md](./GUIDE.md)**.

## Contributing

Issues and pull requests are welcome. For architecture, storage layout, IPC, and contribution-oriented detail, start with [GUIDE.md](./GUIDE.md).

To run from source (Node ≥ 22.13, pnpm):

```bash
pnpm install
pnpm approve-builds --all   # if pnpm 11 prompts about ignored build scripts
pnpm dev
```

## License

[MIT](./LICENSE) © 2026 张恕征
