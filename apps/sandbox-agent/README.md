# @okbot/sandbox-agent-agent — OkBot cloud computer

Remote execution API for OkBot chat tools (`run_shell`, `read_file`, `write_file`, `edit_file`).

## Protocol

- Auth: `Authorization: Bearer <token>` or `X-OkBot-Token: <token>` (except health)
- `GET /v1/health` → `{ ok, service: "okbot-sandbox-agent" }`
- `POST /v1/shell` JSON `{ command, cwd? }`
  - Default → JSON result (`formatted`, stdout/stderr, exitCode)
  - `Accept: text/event-stream` → SSE (`stdout` / `stderr` chunks, then `done`)
- `POST /v1/fs/read` `{ path }` → `{ ok, formatted }`
- `POST /v1/fs/write` `{ path, content }` → `{ ok, formatted }`
- `POST /v1/fs/edit` `{ path, old_text, new_text }` → `{ ok, formatted }`

## Run with Docker / OrbStack

```bash
# From repo root
export SANDBOX_TOKEN="$(openssl rand -hex 24)"
docker build -t okbot-sandbox-agent:local apps/sandbox-agent
docker run -d --name okbot-sandbox-agent \
  -p 18790:18790 \
  -e SANDBOX_TOKEN="$SANDBOX_TOKEN" \
  -e SANDBOX_HOST=0.0.0.0 \
  -e SANDBOX_PORT=18790 \
  -e SANDBOX_WORKDIR=/workspace \
  okbot-sandbox-agent:local

curl -s http://127.0.0.1:18790/v1/health
curl -s -X POST http://127.0.0.1:18790/v1/shell \
  -H "Authorization: Bearer $SANDBOX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command":"uname -a && hostname"}'
```

Register in OkBot **Settings → Computers**: name, host (`127.0.0.1` or LAN IP), port `18790`, token. OkBot probes before saving: health must report `okbot-sandbox-agent`, and an empty shell call must reject with `command_required` (no command runs). A failed probe is not stored.

## Dev

```bash
pnpm --filter @okbot/sandbox-agent test
pnpm --filter @okbot/sandbox-agent build
SANDBOX_TOKEN=dev pnpm --filter @okbot/sandbox-agent start
```

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `SANDBOX_HOST` | `127.0.0.1` | Bind address. Docker image sets `0.0.0.0`. |
| `SANDBOX_PORT` | `18790` | Listen port |
| `SANDBOX_TOKEN` | (generated) | Bearer token |
| `SANDBOX_WORKDIR` | `/workspace` | Default shell cwd inside container |
