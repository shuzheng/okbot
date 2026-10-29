# Contributing to OkBot

Thanks for helping. Day-to-day coding conventions for humans and agents live in [`AGENTS.md`](./AGENTS.md). Product behavior is [`GUIDE.md`](./GUIDE.md); architecture boundaries are [`DESIGN.md`](./DESIGN.md).

## Environment

- Node `>=22.13`
- Package manager: `pnpm@11.15.1` (see root `package.json` `packageManager`)
- Work from the repository root

```bash
pnpm install
pnpm typecheck
pnpm test
```

Gateway CLI (`okbot serve`) needs a gateway build before the bin can load `dist/cli.js`:

```bash
pnpm --filter @okbot/gateway build
```

## Where to change what

Use the **「改哪里」** table in [`AGENTS.md`](./AGENTS.md#改哪里) before opening files. Layout summary:

| Area | Package / path |
| --- | --- |
| UI / Electron shell | `apps/desktop/` |
| Gateway HTTP, `okbot serve`, `FileStorage` | `apps/gateway/` |
| Models, tools, squads, execution backends | `packages/agent/` |
| Shared types / settings / IPC constants | `packages/shared/` |
| Remote computer HTTP | `apps/sandbox-agent/` |

Extension points (tools, MCP, skills, providers, computers): [`docs/extension-surfaces.md`](./docs/extension-surfaces.md).

## Tests

Root scripts (see `package.json`):

| Command | Scope |
| --- | --- |
| `pnpm test` | `@okbot/shared`, `@okbot/agent`, `@okbot/gateway`, `@okbot/desktop` |
| `pnpm test:agent` | agent smoke only |
| `pnpm test:sandbox` / `pnpm test:sandbox-agent` | sandbox-agent (also in CI) |
| `pnpm typecheck` | shared build + agent/gateway/desktop typecheck |
| `pnpm lint` | root ESLint |

Each package `test` discovers `*.test.ts` / `*.test.mjs` via `scripts/run-node-tests.mjs`. New tests matching that glob are picked up automatically.

After behavior-related edits, run at least `pnpm typecheck` and the affected package tests (or full `pnpm test`) before opening a PR.

## Pull request checklist

- [ ] Change is focused; unrelated refactors left out
- [ ] Read the matching rows in AGENTS「改哪里」; updated `GUIDE.md` / `DESIGN.md` / `AGENTS.md` when behavior or boundaries changed
- [ ] `pnpm typecheck` passes
- [ ] Relevant `pnpm test` packages pass (full `pnpm test` preferred for shared/gateway/desktop touches)
- [ ] No secrets, real tokens, or local absolute paths committed
- [ ] Public exports / IPC / HTTP shapes stay stable unless the PR intentionally changes them

## Security

Report vulnerabilities via [`SECURITY.md`](./SECURITY.md) — do not open a public issue for undisclosed security bugs.
