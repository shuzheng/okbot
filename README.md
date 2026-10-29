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

**OkBot is a local-first desktop Personal Agent.**  
AI as permanent contacts (persona + memory & evolution), real tools with human-in-the-loop, durable long-running tasks, schedules, Squad + Mesh collaboration, a self-hosted personal gateway (`okbot serve`), multi-computer execution, and a marketplace with `.okbot` packs. Bring your own models; security and observability built in. MIT.

## What is a Personal Agent?

In 2026 discourse, **Personal Agents** sit apart from chatbots and coding agents:

| | Chat tab / web chatbot | Coding harness / CLI plugin | **OkBot (Personal Agent)** |
| --- | --- | --- | --- |
| **Shape** | Answers in a box; session fades | Lives in terminal or IDE for software work | Desktop app + optional headless gateway |
| **Identity** | Generic chat | Repo / task scoped | Named assistants with avatar, `SOUL.md`, memory |
| **Action** | Mostly text | Repo tools / patches | Shell, fs, web, more — with **HITL** approvals |
| **Multi-agent** | Rare | Agent teams in a coding loop | **Squads** (captain) + **Mesh** (1:1 peer ask) |
| **Always-on** | Tab must be open | Invoke per task | Schedules + `okbot serve` on your hardware |
| **Models** | Vendor locked or BYO | Usually BYO | **BYO** cloud API or local URL — OkBot hosts no inference |
| **Data** | Often cloud | Local repo + vendor | Gateway-host `~/.okbot` |

OkBot is that third category: a desktop-native Personal Agent with an IM-style people UX, real tools, and an open MIT gateway you can run headless.

## Why OkBot

- **Long-running tasks** — auto-decompose into steps, persist progress, resume after interrupts, auto-correct and keep going, manage multiple open tasks
- **Self-hosted personal gateway** — `okbot serve` (+ Electron attach) on your machine or LAN, optional Web UI; no OkBot cloud account
- **Multiple run computers** — local by default; register remote hosts via `sandbox-agent` so one gateway reaches many machines
- **Member auto-collaboration** — **Squads** (captain orchestration) on tasks you assign; **Mesh** so 1:1 assistants can ask roster peers
- **Cross-session memory & evolution** — facts persist across chats; silent post-turn refresh of `SOUL.md` / skills / memory so assistants evolve with use
- **BYO models · security · observability** — providers you already use (OkBot hosts no inference); HITL, path & command guards, token permissions; light token stats and run traces
- **Marketplace & assistant packs** — in-app marketplace for starter assistants and connectors; export / import `.okbot` packs, or import from public GitHub sources

## Features

### Assistants, Squad & Mesh

- Create assistants as people: name, avatar, persona (`SOUL.md`), then chat like adding a contact
- Group assistants into **squads** (captain orchestration) that collaborate on a task you assign
- **Mesh**: in 1:1 chats, assistants can ask other roster peers for help (status lines + read-only exchange UI)

### Marketplace & assistant packs

- In-app **marketplace** installs starter assistants and recommended MCP connectors
- Export / import assistant packs (`.okbot`); import from public GitHub sources (repo, directory, or `.okbot` URL)

### Chat experience

- Streaming, IM-like transcript with mid-turn steer, retry, and stay-on-latest reading
- Drag-and-drop (or paste) files, images, and folders into the composer
- On-device **Whisper** voice input — no cloud speech API

### Skills, memory, evolution & schedules

- Skills: catalog in the system prompt; full text on demand (`read_skill`); **hot-reload** watches skill dirs so the next turn picks up file edits
- Important facts persist across chats (global + per-assistant memory)
- Post-turn **evolution**: throttled silent refresh of `SOUL.md`, skills, and memory so the assistant improves over time
- **Long-running tasks**: durable checklists (`manage_task_progress`) — decompose into steps, persist state, resume after interruption, auto-continue / correct until done or blocked, multi-task queue
- **Schedules**: ask an assistant to wake on a schedule; review, pause, or delete jobs in the product UI

### Models, security & tools

- Bring-your-own providers (Chat Completions / Responses-style APIs you configure) — OkBot does not host inference
- Built-in tools: shell, filesystem, web fetch / search, image generation (when the provider supports it), and more
- Human-in-the-loop approvals and optional auto-approval rules; path-prefix checks and dangerous-command denylist; gateway API tokens with quotas / permissions; **MCP** optional and off by default

### Computers

- Run tools on the **local** machine by default
- Register **remote** computers via `sandbox-agent` (HTTP shell / fs on another host or container) — one gateway, many run computers

### Self-hosted personal gateway

- `okbot serve` runs the gateway in the foreground without a desktop window — a headless Personal Agent host on your hardware
- Optional LAN bind and Web UI so phones or browsers on your network use the same chat
- Electron attaches to an already-running gateway instead of starting a second one

### Observability

- Light token usage stats and per-message run traces / logs — enough to debug, not a full APM suite

## Install (3 steps)

1. **Download** the latest build from **[GitHub Releases](https://github.com/shuzheng/okbot/releases/latest)** for your platform:

   | Platform | Artifact |
   | -------- | -------- |
   | macOS | `.dmg` / `.zip` (arm64 & x64) |
   | Windows | NSIS installer (x64) |
   | Linux | `.AppImage` (x64) |

2. **Open** OkBot (single-instance: launching again focuses the existing window). Early builds may be **unsigned** — allow the app in system settings if you trust the download.

3. **Add a model provider** in Settings, **create an assistant** (like adding a contact), and chat. When a tool needs approval, allow once, remember a rule, or deny.

Data directory: `~/.okbot/` on the **gateway host**. Gateway settings: `server.json`; durable data under `data/` (bots, sessions, memories, logs). Process lock: `runtime.json`. Electron **client** prefs live in `client.json` (chrome + nested `window` + nested `gateways`) under the same machine-local `~/.okbot` — not uploaded as remote gateway settings.

## Usage scenarios

OkBot separates the **UI** (desktop or browser Web UI) from the **Personal Agent gateway** (owner of `~/.okbot`). The UI attaches to **exactly one** gateway at a time; that gateway can reach **many** computers. Tools can run on the gateway host or on registered remote computers. Common setups:

### 1. Local app + local gateway

Everyday default: Desktop Electron owns or attaches to a gateway on the same machine. Chat and data live under local `~/.okbot`.

- Cold start with no gateway → Electron starts one automatically
- An existing `okbot serve` (or another Electron-owned gateway) → desktop **attaches** instead of starting a second process

```text
[ Desktop Electron ] ──IPC/HTTP──► [ Gateway on this Mac/PC ]
                                         └── ~/.okbot
```

### 2. Local app / Web UI + remote gateway

UI on your laptop; gateway on another host you can reach (LAN `bindLan` / `okbot serve`, or a reachable URL). Chat and data live on the **gateway host’s** `~/.okbot`. Save remote gateway prefs and token on the client, then **switch** the active gateway (restart applies).

```text
[ Electron attach  or  browser Web UI ]
              │  HTTP + token
              ▼
[ Gateway on remote host ] ── ~/.okbot (on that host)
```

### 3. Local app / Web UI + remote gateway + remote computers

Same as (2), plus tools execute on registered remote machines via **`sandbox-agent`** (HTTP shell / fs). The Personal Agent host (gateway) stays on the remote gateway machine; computers are additional execution targets.

```text
[ Electron / Web UI ] ──HTTP──► [ Remote gateway + ~/.okbot ]
                                      │
                                      ├── local tools (gateway host)
                                      └── remote → sandbox-agent (other hosts)
```

## Connection model

The Personal Agent connection topology is **one UI ↔ one active gateway ↔ many computers**:

1. **Electron / Web UI → Gateway** — the client connects to **exactly one** gateway at a time (local or remote). You can **switch** among saved gateways; a restart applies the change.
2. **Gateway → Computers** — that gateway connects to **many** computers (built-in local + remote `sandbox-agent` entries). Tools can target one computer or batch/specify as the product already allows.

```text
Electron / Web UI  ──(one active)──►  Gateway (local or remote)
                                            │
                                            ├── Local computer (always)
                                            ├── Remote sandbox A
                                            └── Remote sandbox B …
```

Client prefs store **which gateway to attach**. Computer lists live on the **gateway host** (`settings.computers` under that host’s `~/.okbot`), not in the client’s gateway list.

## CLI

The `okbot` CLI drives the headless gateway and common ops:

| Command | Purpose |
| ------- | ------- |
| `okbot serve` | Start the gateway in the foreground |
| `okbot status` | Show whether the gateway is running |
| `okbot stop` / `restart` | Stop, or stop then start |
| `okbot config` | Show or change gatewayHttpApi settings |
| `okbot token` | Show or reset the access token |
| `okbot data` | Print or open the data directory |
| `okbot help` / `version` | Help and version |
| `--lang zh\|en` | UI language (also `OKBOT_LANG` / `LANG`) |

```bash
okbot serve                 # start gateway (prints URL + token once)
okbot status
okbot config
okbot stop
okbot help --lang zh
```

**From source:** the root `package.json` `bin` points at `apps/gateway/bin/okbot.mjs`, which loads `apps/gateway/dist/cli.js`. Build the gateway first:

```bash
pnpm --filter @okbot/gateway build
# then: pnpm exec okbot serve   (or link / path to the bin)
```

Desktop app packages may ship the CLI alongside the app; use the release notes for your platform if you install from binaries only.

## Architecture

The gateway (`Electron main` or `okbot serve`) is the Personal Agent host process: one owner of `~/.okbot` at a time. The desktop attaches over HTTP when a gateway is already running; quitting the window only stops a gateway that Electron itself started. See **Connection model** above for UI ↔ gateway ↔ computers topology.

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

Deeper module boundaries, HTTP routes, and storage layout: **[DESIGN.md](./DESIGN.md)**.

## Repository layout

```text
apps/desktop/          Electron shell + React UI
apps/gateway/          Headless gateway + `okbot` CLI (`okbot serve`, status, stop, …)
apps/sandbox-agent/    Remote computer HTTP (shell / fs)
packages/agent/        Models, tools, squads, mesh, compression, execution backends
packages/shared/       Types, settings, IPC constants, RuntimeEvent
```

## Data & privacy

- All product data defaults to `~/.okbot` on the gateway host — no OkBot cloud account
- Directory permissions are tightened on create (`0700`); `server.json` (API keys, gateway token, computer tokens) is written `0600`
- Secrets stay in local settings; optional product backup can export without secrets
- Model calls go to **your** configured provider base URLs — OkBot does not host inference

## Documentation

| Doc | Audience |
| --- | -------- |
| [GUIDE.md](./GUIDE.md) | Product behavior, UI, tools, settings |
| [DESIGN.md](./DESIGN.md) | Architecture, gateway HTTP, storage |
| [AGENTS.md](./AGENTS.md) | Conventions for contributors and coding agents |
| [docs/](./docs/) | Extra design notes |

## Develop from source

Requires **Node ≥ 22.13** and **pnpm** (see `packageManager` in root `package.json`).

```bash
pnpm install
pnpm approve-builds --all   # if pnpm 11 prompts about ignored build scripts
pnpm dev
```

Useful scripts: `pnpm test`, `pnpm build`, `pnpm typecheck`. Gateway CLI needs `pnpm --filter @okbot/gateway build` before `okbot` loads `dist/cli.js`.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md). Please also read [GUIDE.md](./GUIDE.md), [DESIGN.md](./DESIGN.md), and [AGENTS.md](./AGENTS.md) before large changes, and keep PRs focused. Security reports: [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © 2026 张恕征
