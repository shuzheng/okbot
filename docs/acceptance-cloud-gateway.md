# Acceptance: Cloud computer + Desktop gateway

Checklist for morning verification (no product version numbers).

## A. Cloud computer (`apps/sandbox-agent` / sandbox-agent)

### Run container (OrbStack / Docker)

```bash
# Ensure OrbStack is running
open -a OrbStack
# wait until: docker info

export SANDBOX_TOKEN="$(openssl rand -hex 24)"
echo "$SANDBOX_TOKEN" > /tmp/okbot-sandbox-agent.token

# from the repository root
docker build -t okbot-sandbox-agent:local apps/sandbox-agent
docker rm -f okbot-sandbox-agent 2>/dev/null || true
docker run -d --name okbot-sandbox-agent \
  -p 18790:18790 \
  -e SANDBOX_TOKEN="$(cat /tmp/okbot-sandbox-agent.token)" \
  -e SANDBOX_HOST=0.0.0.0 \
  -e SANDBOX_PORT=18790 \
  -e SANDBOX_WORKDIR=/workspace \
  okbot-sandbox-agent:local

curl -s http://127.0.0.1:18790/v1/health
curl -s -X POST http://127.0.0.1:18790/v1/shell \
  -H "Authorization: Bearer $(cat /tmp/okbot-sandbox-agent.token)" \
  -H "Content-Type: application/json" \
  -d '{"command":"uname -a && hostname && pwd"}'
```

Token file: `/tmp/okbot-sandbox-agent.token` (and acceptance notes below after overnight build).

### Register in OkBot

1. Settings → **Computers**（电脑连接）→ Add computer  
2. Name: e.g. `OrbStack sandbox`  
3. Host: `127.0.0.1` (same Mac) or LAN IP of the host  
4. Port: `18790`  
5. Token: contents of `/tmp/okbot-sandbox-agent.token`  
6. Add is blocked until a probe succeeds: `GET /v1/health` must be `okbot-sandbox-agent`, then an empty `POST /v1/shell` must return 400 `command_required` (token check only, no command). Unreachable, wrong service, or a bad token is not saved.  
7. In chat composer, select that computer → ask the bot to `run_shell` (`uname -a` / `hostname`)  
8. Tool output should show container hostname / Linux — not macOS Darwin.

### Automated smoke

```bash
pnpm --filter @okbot/sandbox-agent test
pnpm --filter @okbot/agent exec node --import tsx src/executionBackend.test.ts
```

## B. Desktop gateway (mobile via same UI)

1. Settings → Local gateway（本地网关）→ Enable  
2. Turn on **LAN gateway** (`bindLan`) and **Serve web UI** (`serveUi`)  
3. Note port (default `18765`) and access token  
4. On phone (same Wi‑Fi / intranet): open  
   `http://<Mac-LAN-IP>:<port>/`  
   (or `/gateway-login`). Unauthenticated GET shows the token form, not JSON `unauthorized`.  
5. Paste token → Open OkBot  
6. Session list + chat should load (HTTP bridge). Send a short message; SSE streams events.

Loopback-only mode (bindLan off) remains 127.0.0.1 for scripts.

## C. Protocols (locked)

| Path | Transport |
|------|-----------|
| Desktop → sandbox | HTTP POST + optional SSE shell; REST fs; Bearer |
| Mobile → gateway | REST + SSE; Bearer / `?token=`; same web UI |

## D. Known gaps (early product)

- Gateway web UI: create bot / save settings / HITL tool approval / voice / file pickers stubbed or limited  
- Squad cold-start HITL resume does not re-bind remote computer beyond stored `computerId`  
- Skills + image gen always run on desktop host (by design)  
- Security guardrails on remote sandbox are lighter (container boundary is the sandbox)

## E. Overnight build record

| Item | Value |
|------|-------|
| Package | apps/sandbox-agent (@okbot/sandbox-agent) |
| Docker image | okbot-sandbox-agent:local (running) |
| Container | okbot-sandbox-agent — 0.0.0.0:18790->18790 |
| Endpoint | http://127.0.0.1:18790 |
| Token file | /tmp/okbot-sandbox-agent.token |
| Registered computerId | computer_sandbox_agent_local in ~/.okbot/settings.json |
| LAN IP | `<your-lan-ip>` |
| Gateway URL | `http://<your-lan-ip>:18765/gateway-login` |
| Secrets note | /tmp/okbot-acceptance-secrets.txt (not in git) |
| E2E | container shell returns Linux/Debian; ExecutionBackend remote ok |
