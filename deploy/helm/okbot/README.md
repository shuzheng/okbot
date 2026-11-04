# OkBot Helm chart

Deploys the **headless gateway** (`okbot serve`) as a single-replica Deployment with a RWO PVC for `~/.okbot`.

The Electron desktop app is **not** run in Kubernetes — install it natively and attach to this Service / Ingress.

## Prerequisites

- Built image `okbot-gateway:<tag>` available to the cluster (see `deploy/docker/Dockerfile.gateway`).
- Kubernetes 1.23+ and Helm 3.

## Install

```bash
# From repository root, after building/pushing the image:
helm upgrade --install okbot ./deploy/helm/okbot \
  --set image.repository=okbot-gateway \
  --set image.tag=0.14.1
```

## Tokens

On first start the gateway mints user + admin tokens and prints them to stdout.

```bash
kubectl logs deploy/okbot -n <ns> | head -40
kubectl exec deploy/okbot -n <ns> -- okbot token show
```

Do not put live tokens in `values.yaml`. Optional `extraEnvFrom` is reserved for future/operator secrets; auth remains the product token model.

## Values of note

| Key | Default | Notes |
| --- | --- | --- |
| `replicaCount` | `1` | Keep at 1 with RWO PVC |
| `service.port` | `18765` | Service port (clients) |
| `service.targetPort` | `18765` | Container listen port; chart sets `OKBOT_PORT` from this |
| `env.OKBOT_BIND_LAN` | `"true"` | Required so the process binds `0.0.0.0` |
| `env.OKBOT_DATA_DIR` | _(unset)_ | Optional; entrypoint pairs it with `--port` for `serve` |
| `persistence.size` | `10Gi` | Backs `/home/okbot/.okbot` |
| `ingress.enabled` | `false` | Optional |

## Health

Probes use `GET /v1/health` (no auth).

## Uninstall

```bash
helm uninstall okbot
# PVC may be retained depending on reclaim policy — delete manually if desired.
```
