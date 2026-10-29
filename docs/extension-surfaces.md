# Extension surfaces (current)

How to extend OkBot **today**, without a plugin runtime. There is no third-party plugin loader, dynamic native add-on API, or separate extension process. Contributions land as normal code / config in this monorepo (or as user data under `~/.okbot`).

For "which file first", also see AGENTS「改哪里」 and [`DESIGN.md`](../DESIGN.md).

## Surfaces at a glance

| Surface | What it is | Where it lives | How users enable it |
| --- | --- | --- | --- |
| Built-in tools | Agent tools (`run_shell`, `read_file`, ...) | `packages/shared` ids + `packages/agent` `buildTools` | Settings → tools prefs / approval |
| MCP servers | Optional external tools via MCP | `settings.mcp` + `packages/agent/src/mcp` + gateway `mcpRuntime` | Settings → MCP (off by default; every call HITL) |
| Skills | Progressive-disclosure `SKILL.md` packs | Per-owner `~/.okbot/<owner>/skills/` + `packages/agent/src/skills` | Edit / import on an assistant; catalog in prompt, body via `read_skill` |
| Model providers | BYO OpenAI-compatible endpoints | `settings.model` in `packages/shared` + `packages/agent` model wiring | Settings → model providers |
| Computers | Local + remote shell/fs backends | `settings.computers` + `computerSelection` / `executionBackend` + `apps/sandbox-agent` | Settings → computers; remote runs sandbox-agent |

## Tools (built-in)

1. Add the id to `packages/shared/src/toolIds.ts` (`TOOL_IDS`, `DEFAULT_TOOL_PREFERENCES`).
2. Implement and register in `packages/agent/src/tools.ts` (`buildTools`).
3. Wire approval / HITL behavior via existing `approval` helpers and Settings UI as needed.
4. Update GUIDE / DESIGN if the tool is user-visible behavior.

Keep schemas strict (`zod` + nullable optionals as existing tools do). Prefer extending `ExecutionBackend` / computer routing over hard-coding "local only" when the tool touches shell or files.

## MCP

- Schema: `packages/shared/src/mcp.ts` (`McpSettings` / `McpServerEntry`).
- Runtime hub: `packages/agent/src/mcp/` (and gateway `mcpRuntime` for process lifetime).
- HTTP/admin: `GET /v1/mcp/status`, `POST /v1/mcp/test` (admin token); desktop IPC via `registerExtensions`.
- Security: MCP tools are always ask-for-approval (not auto-allowed by keyword rules). Backups treat `env` / `headers` as secrets.

**Contrib path:** document a server config users can paste into Settings, or add a marketplace connector preset under desktop `marketplaceConnectors` if it is a first-party convenience — do not add a parallel plugin loader.

## Skills

- Parse / catalog: `packages/agent/src/skills/` (`catalog.ts`, `parse.ts`, hot reload).
- On disk: `~/.okbot/<botId>/skills/*/SKILL.md` (also inside assistant packages / gallery).
- Prompt: catalog only in system instructions; full body through `read_skill`.
- Host watch: `gatewayRuntime.startSkillWatch` on the gateway-owning process.

**Contrib path:** ship a skill folder or `.okbot` assistant pack; or add a gallery entry under `packages/agent` gallery sources. No separate skill daemon.

## Model providers

- Types / normalize: `packages/shared/src/settings.ts` (`ModelProvider`, `CatalogModel`, `normalizeModelSettings`, ...).
- Runtime: `packages/agent` model helpers + `@openai/agents` against `baseURL` / `apiKey` / `apiFormat` (`chat_completions` | `responses` only).
- Probe / connectivity: `apps/gateway/src/modelProbe.ts` (IPC + gateway RPC).

**Contrib path:** users add a custom provider in Settings. Code changes are for format quirks, probe safety, or catalog UX — not a new provider plugin ABI.

## Computers

- Registration: `settings.computers` (`ComputerEntry`); local is implicit `local` (`LOCAL_COMPUTER_ID`).
- Routing: `packages/agent/src/computerSelection.ts` + `executionBackend.ts`.
- Remote process: `apps/sandbox-agent` (shell/fs HTTP only — not the desktop gateway).

**Contrib path:** run or package `sandbox-agent` for a new host; register it in Settings. Gateway and model traffic stay on the OkBot host.

## Recommended contribution path

1. Prefer **user-data / Settings** (MCP server row, skill folder, provider, computer) when no code change is required.
2. For productized defaults, add **gallery / connector presets** or docs — still no plugin runtime.
3. For new built-in capability, follow the tool/skills tables above and keep public exports, IPC channels, and HTTP routes stable unless the PR intentionally versions them.
4. Run `pnpm typecheck` and relevant `pnpm test` packages (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)).

## Out of scope (intentionally deferred)

- Plugin registry / dynamic extension ABI
- Third-party native modules loaded at runtime
- SchemaVersion / error-code rewrites as a prerequisite to extend

Those may appear in later readiness work; do not introduce them casually in feature PRs.
