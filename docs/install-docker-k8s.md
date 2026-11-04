# Self-host OkBot gateway — Docker & Kubernetes

Bilingual / 中英对照.

OkBot is **desktop + headless gateway**. This guide covers running the **gateway** (`okbot serve`) in Docker or Kubernetes so a native desktop / attach client can use a remote data root.

- Electron **does not** run inside the container or the Helm chart.
- Existing `apps/sandbox-agent/Dockerfile` remains the **remote computer** image (shell / fs), optional beside the gateway.

Default HTTP port: **18765** (`DEFAULT_GATEWAY_HTTP_API_PORT`).  
Unauthenticated health: **`GET /v1/health`** → `{ "ok": true, "service": "okbot-local-http-api" }`.

---

## English

### Build the gateway image

From the repository root (Docker / OrbStack):

```bash
docker build -f deploy/docker/Dockerfile.gateway -t okbot-gateway:0.14.1 .
```

The image is a multi-stage Debian bookworm build: pnpm workspace builds `@okbot/shared` → `@okbot/agent` → `@okbot/gateway`, then `pnpm deploy --prod --legacy` for a portable runtime. No Electron binary is required at runtime.

### Docker Compose

```bash
# Gateway only
docker compose -f deploy/docker/docker-compose.yml up -d --build

# Gateway + optional sandbox-agent (remote computer demo)
export SANDBOX_TOKEN="$(openssl rand -hex 24)"
docker compose -f deploy/docker/docker-compose.yml --profile sandbox up -d --build
```

Data volume: Docker volume `okbot-data` → `/home/okbot/.okbot` (non-root user `okbot`, uid 10001).

Published port: host `OKBOT_PUBLISH_PORT` (default `18765`) → container `OKBOT_PORT` (default `18765`). Change both together when remapping, e.g. `OKBOT_PORT=19001 OKBOT_PUBLISH_PORT=19001`.

Image `HEALTHCHECK` uses shell form `curl …:${OKBOT_PORT:-18765}/v1/health` so it follows the same env. Compose healthcheck does likewise.

Entrypoint sets `gatewayHttpApi.bindLan=true` (listen `0.0.0.0`) and keeps `serveUi=false` unless `OKBOT_SERVE_UI=true`. Browser UI assets (`apps/desktop/out/renderer`) are **not** shipped in this image.

Optional `OKBOT_DATA_DIR`: the CLI requires `--port` and `--data-dir` as a pair for `okbot serve`, so the entrypoint always passes `--port "${OKBOT_PORT:-18765}"` together with `--data-dir` when that env is set.

### Retrieve tokens

On first start the process mints user + admin tokens and prints them:

```bash
docker compose -f deploy/docker/docker-compose.yml logs gateway | head -40
docker compose -f deploy/docker/docker-compose.yml exec gateway okbot token show
```

Use the **user** token in the desktop “add gateway” / attach flow; admin is required for backup restore and some MCP ops.

### Attach desktop / Web UI

1. Install the native OkBot desktop build for your OS.
2. Point the client at `http://<host>:18765` with the user token (see in-app gateway list / attach).
3. Model API keys and assistants live on the **gateway host** under `~/.okbot` (the volume).

### Helm

```bash
# Image must be pullable by the cluster (load into kind/OrbStack or push to a registry).
helm lint deploy/helm/okbot
helm upgrade --install okbot ./deploy/helm/okbot \
  --set image.repository=okbot-gateway \
  --set image.tag=0.14.1
```

Chart notes:

- `replicaCount: 1` + RWO PVC (not multi-writer safe).
- Deployment strategy `Recreate`.
- Probes: `GET /v1/health` on named port `http` → `service.targetPort`.
- `OKBOT_PORT` is injected from `service.targetPort` (keep Service + container listen in sync; do not set a conflicting `OKBOT_PORT` under `env`).
- Optional `OKBOT_DATA_DIR` under `env`: entrypoint pairs it with `--port` for `serve`.
- Optional Ingress via `ingress.enabled`.

```bash
kubectl logs deploy/okbot | head -40
kubectl exec deploy/okbot -- okbot token show
```

### Backup

- Stop or quiesce writers, then back up the volume / PVC contents (`server.json`, `data/`, …).
- Or use the product admin HTTP backup (`POST /v1/backup/export`) with an admin token.

### Limitations

| Topic | Note |
| --- | --- |
| Electron desktop | Native install only — not packaged for k8s |
| `serveUi` / browser UI | Needs built `apps/desktop/out/renderer`; image defaults UI off |
| MCP stdio servers | Run **inside** the gateway container; paths/binaries must exist there. Prefer remote/HTTP MCP when the gateway is containerized |
| GPU | Not configured; add device requests yourself if a tool needs it |
| Multi-replica | Unsupported with shared RWO data |
| sandbox-agent | Separate process/image; register as a Computer in settings |

---

## 中文

### 构建网关镜像

在仓库根目录：

```bash
docker build -f deploy/docker/Dockerfile.gateway -t okbot-gateway:0.14.1 .
```

多阶段 Debian bookworm：用 pnpm 构建 `@okbot/shared` → `@okbot/agent` → `@okbot/gateway`，再 `pnpm deploy --prod --legacy` 产出运行树。镜像**不含** Electron。

### Docker Compose

```bash
docker compose -f deploy/docker/docker-compose.yml up -d --build

export SANDBOX_TOKEN="$(openssl rand -hex 24)"
docker compose -f deploy/docker/docker-compose.yml --profile sandbox up -d --build
```

数据卷：`okbot-data` → `/home/okbot/.okbot`（非 root 用户 `okbot`）。  
默认端口 **18765**（容器内 `OKBOT_PORT`，宿主机映射 `OKBOT_PUBLISH_PORT`；改端口时两者一起改）。镜像 / Compose 的 healthcheck 都读 `OKBOT_PORT`。入口脚本会把 `bindLan` 设为 `true`（监听 `0.0.0.0`）；默认关闭 `serveUi`（镜像未带桌面 renderer）。若设置 `OKBOT_DATA_DIR`，入口会按 CLI 约定同时传 `--port` 与 `--data-dir`。

### 取令牌

首次启动会在日志打印 user / admin 令牌：

```bash
docker compose -f deploy/docker/docker-compose.yml logs gateway | head -40
docker compose -f deploy/docker/docker-compose.yml exec gateway okbot token show
```

桌面附着用 **用户令牌**；备份恢复等需 **超管令牌**。

### 附着桌面客户端

1. 本机安装原生 OkBot 桌面版。  
2. 将网关地址设为 `http://<主机>:18765` 并填入用户令牌。  
3. 模型密钥与助手数据在网关侧 `~/.okbot`（即容器卷）。

### Helm

```bash
helm lint deploy/helm/okbot
helm upgrade --install okbot ./deploy/helm/okbot \
  --set image.repository=okbot-gateway \
  --set image.tag=0.14.1
```

单副本 + RWO PVC；探针走 `/v1/health`（named port → `service.targetPort`）。Chart 会用 `service.targetPort` 注入 `OKBOT_PORT`，与容器监听端口对齐。令牌同样从 `kubectl logs` / `okbot token show` 获取。

### 备份与限制

备份卷内 `~/.okbot`，或用超管 HTTP 导出。  
限制：桌面不进 k8s；容器内 MCP stdio 依赖镜像内二进制；不要多副本共享同一数据目录；`sandbox-agent` 仍是独立「远程电脑」镜像。

---

## Layout

```text
deploy/docker/Dockerfile.gateway
deploy/docker/docker-compose.yml
deploy/docker/entrypoint.sh
deploy/docker/.dockerignore
deploy/helm/okbot/          # Chart.yaml, values.yaml, templates/
docs/install-docker-k8s.md  # this file
```
